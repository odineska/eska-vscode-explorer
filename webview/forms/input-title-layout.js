import { fieldWidth, inputRows, number, scalar } from './model.mjs';
import { automaticHorizontalSpacing, horizontalInputMaximum, allocateLaneSizes, laneInputBounds, ordinaryGroup } from './layout-model.mjs';
import { borderBoxSize, boundingScale, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, inputCaptionInset } from './field-caption-layout.js';
import { inputLaneFields } from './input-lane-layout.js';

const total = widths => widths.reduce((sum, width) => sum + width, 0);
const kinds = new Set(['number', 'date', 'reference']);

function inputTitleField(node, { targets, scale, os }, minimumCaptions) {
  const element = targets.elements.get(node.key);
  const kind = node.presentation.valueType.kind;
  const location = node.presentation.titleLocation;
  if (!kinds.has(kind) || inputRows(node) > 1 || !['Left', 'Top', 'None'].includes(location)
      || minimumCaptions.has(node.key)) return;
  const flexible = element.dataset.stretchX === 'true';
  const cap = flexible ? horizontalInputMaximum(node, os) : undefined;
  const bounds = flexible ? laneInputBounds(node, os) : undefined;
  if (flexible && (kind !== 'reference' || cap === undefined || !bounds)) return;
  const row = element.querySelector(':scope > .taxi-field-row');
  const control = row?.querySelector(':scope > .taxi-field-control > .taxi-input');
  if (!control) return;
  const label = row.querySelector(':scope > .taxi-field-label');
  const title = label?.getAttribute('aria-label') ?? '';
  const caption = fieldCaptionProfile(title, node.presentation.titleFont);
  if (!caption) return;
  const preferred = flexible ? Math.min(fieldWidth(node, os), cap)
    : borderBoxSize(control, scale).width;
  const minimum = bounds?.narrowMinimum ?? preferred;
  const sideValue = bounds?.preferred ?? preferred;
  const side = location === 'Left' && !!title;
  const gap = side ? pixels(getComputedStyle(row).columnGap) : 0;
  const sideMinimum = side ? caption.minimum + inputCaptionInset + gap : 0;
  const automatic = side && scalar(node, 'TitleLocation', 'Auto') === 'Auto';
  return { key: node.key, kind, element, row, control, caption, location, side, automatic, gap, sideMinimum, minimum, preferred, sideValue, flexible };
}

function sideWidth(fields, above) {
  return Math.max(0, ...fields.filter(field => field.side && !above.has(field.key)).map(field => field.caption.minimum));
}

function widthFor(field, value, above, captionWidth) {
  if (field.side && !above.has(field.key)) return value + captionWidth + inputCaptionInset + field.gap;
  return Math.max(value, field.caption.minimum);
}

function placements(columns) {
  const candidates = columns.map(({fields}) => fields.filter(field => field.automatic)
    .sort((a, b) => b.preferred + b.sideMinimum - a.preferred - a.sideMinimum));
  const plans = [];
  let above = new Set();
  const steps = Math.max(0, ...candidates.map(fields => fields.length));
  for (let step = 0; step <= steps; step++) {
    // Each column can release its widest side title before trying a smaller one.
    const captionWidths = columns.map(({fields}) => sideWidth(fields, above));
    const width = total(columns.map(({fields}, index) => Math.max(...fields.map(field =>
      widthFor(field, field.side && !above.has(field.key) ? field.sideValue : field.minimum, above, captionWidths[index])))));
    plans.push({above, width, captionWidths});
    above = new Set(above);
    for (const fields of candidates) if (fields[step]) above.add(fields[step].key);
  }
  return plans;
}

function alignFirstControls(items, fields, top) {
  // The caption may have changed height independently of its input.
  const scale = top ? boundingScale(items) : 1;
  const positions = fields.map(({element, row, control}) => {
    if (!top) return 0;
    const padding = pixels(element.style.getPropertyValue('--taxi-input-title-offset'));
    return Math.round((control.getBoundingClientRect().top - row.getBoundingClientRect().top) / scale - padding);
  });
  const baseline = Math.max(...positions);
  let changed = false;
  for (const [index, {element}] of fields.entries()) {
    const offset = baseline - positions[index], value = offset > 0 ? `${offset}px` : '';
    if (element.style.getPropertyValue('--taxi-input-title-offset') === value) continue;
    updateStyle(element, '--taxi-input-title-offset', value);
    changed = true;
  }
  return changed;
}

/** Keep the minimum width independent of the active caption position. */
export function inputTitleLayout(model, context, minimumCaptions) {
  const { targets, alignment, os, scale } = context;
  const minimumRows = new Map(), rows = [];
  function visit(node) {
    const items = targets.containers.get(node.key);
    const children = targets.children(node);
    if (items && ordinaryGroup(node) && node.presentation.grouping === 'Horizontal' && children.length > 1
        && number(node, 'Width') <= 0 && !items.parentElement.querySelector(':scope > .taxi-group-title')
        && !items.hasAttribute('data-united-horizontal-lane')) register(node, items, children);
    for (const child of node.children) visit(child);
  }

  function register(node, items, children) {
    const columns = children.map(child => {
      const nodes = inputLaneFields(child, targets);
      if (!nodes?.length) return;
      const fields = nodes.map(field => inputTitleField(field, context, minimumCaptions));
      if (fields.some(field => !field)) return;
      return { element: targets.elements.get(child.key), fields };
    });
    if (columns.some(column => !column)) return;
    const fields = columns.flatMap(column => column.fields);
    if (!fields.some(field => field.side && ['number', 'date'].includes(field.kind))) return;

    const gap = automaticHorizontalSpacing(node) ? 11 : pixels(getComputedStyle(items).columnGap);
    const spacing = gap * (columns.length - 1);
    const plans = placements(columns);
    const preferred = total(columns.map(({fields}) => Math.max(...fields.map(field => field.side
      ? field.preferred + field.caption.preferred + inputCaptionInset + field.gap
      : Math.max(field.preferred, field.caption.preferred))))) + spacing;
    minimumRows.set(items, plans.at(-1).width + spacing);
    for (const name of ['--taxi-input-title-columns', '--taxi-input-title-gap']) alignment.style(items, name, '');
    alignment.mark(items, 'data-input-title-reflow', 'false');
    for (const column of columns) {
      alignment.style(column.element, '--taxi-field-track', '');
      for (const field of column.fields) {
        for (const name of ['--taxi-field-columns', '--taxi-field-caption-width', '--taxi-input-title-value-min', '--taxi-input-title-value-max']) {
          alignment.style(field.element, name, '');
        }
      }
    }
    const first = columns.map(({fields}) => fields[0]);
    const align = children.every(child => scalar(child, 'GroupVerticalAlign', 'Auto') === 'Auto')
      && first.every(field => !field.element.dataset.groupVerticalAlign || field.element.dataset.groupVerticalAlign === 'Auto');
    if (align) for (const field of first) alignment.style(field.element, '--taxi-input-title-offset', '');
    rows.push({ items, columns, gap, spacing, preferred, plans, first: align ? first : [] });
  }

  if (os === 'linux') visit(model);
  return {
    minimumRows,
    allocate(captions) {
      const above = new Set();
      let heightChanged = false;
      for (const {items, columns, gap, spacing, preferred, plans, first} of rows) {
        const css = getComputedStyle(items);
        const available = borderBoxSize(items, scale).width - boxInsets(css).width;
        const fit = plans.find(plan => plan.width + spacing <= available + .5) ?? plans.at(-1);
        const plan = fit.above.size || available + .5 < preferred ? fit : undefined;
        const sizes = plan && allocateLaneSizes(available - spacing, columns.map(({fields}, index) => {
          const width = bound => Math.max(...fields.map(field => widthFor(field, field[bound], plan.above, plan.captionWidths[index])));
          const preferred = width('preferred');
          return { reserve: 0, minimum: width('minimum'), preferred, maximum: preferred };
        }));
        if (items.dataset.inputTitleReflow !== String(!!plan)) items.dataset.inputTitleReflow = String(!!plan);
        updateStyle(items, '--taxi-input-title-columns', sizes ? sizes.map(width => `${width}px`).join(' ') : '');
        updateStyle(items, '--taxi-input-title-gap', plan ? `${gap}px` : '');
        for (const [index, {element, fields}] of columns.entries()) {
          const width = sizes?.[index];
          updateStyle(element, '--taxi-field-track', width === undefined ? '' : `${width}px`);
          for (const field of fields) {
            const moves = plan?.above.has(field.key);
            if (moves) above.add(field.key);
            const side = plan && field.side && !moves;
            const captionWidth = side ? plan.captionWidths[index] : plan && (moves || field.location === 'Top') ? width : undefined;
            if (plan) allocateFieldCaption(captions, field, captionWidth, side ? inputCaptionInset : 0);
            else updateStyle(field.element, '--taxi-field-caption-width', '');
            updateStyle(field.element, '--taxi-field-columns', side ? 'var(--taxi-field-caption-width) minmax(0, 1fr)' : '');
            updateStyle(field.element, '--taxi-input-title-value-min', plan && field.flexible ? `${field.minimum}px` : '');
            updateStyle(field.element, '--taxi-input-title-value-max', plan && field.flexible ? `${field.preferred}px` : '');
          }
        }
        if (first.length) {
          const top = plan && first.some(field => field.location === 'Top' || plan.above.has(field.key));
          heightChanged = alignFirstControls(items, first, top) || heightChanged;
        }
      }
      return { above, heightChanged };
    },
  };
}
