import { fieldWidth, inputRows, number, scalar, textInputWidthBounds } from './model.mjs';
import { authoredTopPageInputs, automaticHorizontalSpacing, horizontalInputMaximum, allocateLaneSizes, laneInputBounds, ordinaryGroup } from './layout-model.mjs';
import { borderBoxSize, boundingScale, pixels, updateStyle } from './layout-box.mjs';
import { fieldCaptionOccupiedWidth, fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, inputCaptionInset, isolatedInputCaptionWidth } from './field-caption-layout.js';
import { inputLaneFields } from './input-lane-layout.js';
import { rowFitWidth, sideTabWidths } from './page-fit-layout.js';
import { preparePageScrollbarPaint } from './page-scrollbar.js';

const total = widths => widths.reduce((sum, width) => sum + width, 0);
const kinds = new Set(['number', 'date', 'reference']);

function inputTitleField(node, { targets, scale, os }, minimumCaptions, page, authoredTop) {
  const element = targets.elements.get(node.key);
  const kind = node.presentation.valueType.kind;
  const location = node.presentation.titleLocation;
  const pageText = page && textInputWidthBounds(node, os);
  if ((!kinds.has(kind) && !pageText) || inputRows(node) > 1 || !['Left', 'Top', 'None'].includes(location)
      || minimumCaptions.has(node.key)) return;
  const flexible = element.dataset.stretchX === 'true';
  const cap = flexible ? horizontalInputMaximum(node, os) : undefined;
  const bounds = flexible ? laneInputBounds(node, os) : undefined;
  if (flexible && (!bounds || !pageText && (kind !== 'reference' || cap === undefined))) return;
  const row = element.querySelector(':scope > .taxi-field-row');
  const control = row?.querySelector(':scope > .taxi-field-control > .taxi-input');
  if (!control) return;
  const label = row.querySelector(':scope > .taxi-field-label');
  const title = label?.getAttribute('aria-label') ?? '';
  const caption = fieldCaptionProfile(title, node.presentation.titleFont, {
    wordRuns: authoredTop, splitTerminalColon: authoredTop,
  });
  if (!caption) return;
  const preferred = flexible || page ? Math.min(fieldWidth(node, os), cap ?? Infinity) : borderBoxSize(control, scale).width;
  const minimum = bounds?.narrowMinimum ?? preferred;
  const maximum = pageText && flexible ? bounds.maximum : preferred;
  // A text field in a forced page row can shrink beside its side title.
  const sideValue = pageText ? minimum : bounds?.preferred ?? preferred;
  const side = location === 'Left' && !!title;
  const gap = side ? pixels(getComputedStyle(row).columnGap) : 0;
  const sideMinimum = side ? caption.minimum + inputCaptionInset + gap : 0;
  const automatic = side && scalar(node, 'TitleLocation', 'Auto') === 'Auto';
  return { key: node.key, kind, element, row, control, caption, location, side, automatic, gap, sideMinimum, minimum, preferred, maximum, sideValue, flexible };
}

function sideWidth(fields, above) {
  return Math.max(0, ...fields.filter(field => field.side && !above.has(field.key)).map(field => field.caption.minimum));
}

function widthFor(field, value, above, captionWidth, topWidth = field.caption.minimum) {
  if (field.side && !above.has(field.key)) return value + captionWidth + inputCaptionInset + field.gap;
  return Math.max(value, topWidth);
}

function pageSideCaption(field, width) {
  const { caption, gap, minimum, preferred } = field;
  if (caption.minimum === caption.preferred) return caption.preferred;
  if (field.flexible) return isolatedInputCaptionWidth(caption, width, gap, minimum, preferred) ?? caption.preferred;
  const available = width - preferred - gap - inputCaptionInset;
  return Math.min(caption.preferred, Math.max(caption.minimum, available));
}

function allocateAuthoredPageTitles(width, fitWidth, fields, lanes, rail) {
  const flexible = fields[0].flexible ? 0 : 1;
  const input = fields[flexible], fixed = fields[1 - flexible];
  const inputLane = lanes[flexible], fixedLane = lanes[1 - flexible];
  const compact = Math.max(input.preferred, input.caption.compact);
  const full = fixedLane.maximum;
  const ordered = sizes => flexible === 0 ? sizes : sizes.reverse();
  // The side-page fit tolerates three pixels before allocating a wrapped row.
  const tolerance = rail ? 3 : 0;
  if (fitWidth >= compact + full - tolerance) {
    const scroll = rail && rail.painted - rail.nominal > 1 && width < compact + full;
    const target = scroll ? Math.min(compact, width - full + tolerance) : width - full;
    const value = Math.max(inputLane.minimum, Math.min(target, inputLane.maximum));
    return { sizes: ordered([value, scroll ? width - value : full]), scroll };
  }

  // Fit whole words in the fixed column before sharing the width that wrapping releases.
  const preferred = input.preferred <= inputLane.minimum ? inputLane.minimum
    : Math.min(fitWidth, Math.max(input.preferred, input.caption.preferred));
  const [provisional, budget] = allocateLaneSizes(fitWidth, [
    { minimum: inputLane.minimum, preferred },
    { minimum: fixedLane.minimum, preferred: full },
  ]);
  const fixedWidth = Math.max(fixedLane.minimum, fieldCaptionOccupiedWidth(fixed.caption, budget));
  const leadingWrap = flexible === 0 && input.caption.minimum < input.caption.preferred;
  const fitsCompact = width >= compact + fixedWidth && input.preferred <= input.caption.compact;
  const target = leadingWrap && !fitsCompact ? provisional : compact;
  const inputWidth = Math.max(inputLane.minimum, Math.min(target, width - fixedWidth));
  const bounds = [inputLane.maximum, full];
  const sizes = ordered(allocateLaneSizes(width, [inputWidth, fixedWidth].map((preferred, index) => ({
    minimum: preferred, preferred, maximum: bounds[index], growthWeight: preferred - 1,
  }))));
  // A wrapped leading title needs room for both tracks to change after packing.
  const canSplit = leadingWrap ? width - inputWidth - fixedWidth > 2 : sizes[0] > lanes[0].minimum;
  return { sizes, divider: canSplit && full > fixedLane.minimum };
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
  const minimumRows = new Map(), captionFields = new Set(), rows = [];
  function visit(node) {
    const items = targets.containers.get(node.key);
    const children = targets.children(node);
    const page = node.kind === 'Page' && children.every(child => child.kind === 'InputField')
      && children.some(child => child.presentation.valueType.kind === 'string');
    const grouping = node.presentation.grouping;
    const authoredTop = page && authoredTopPageInputs(children);
    const conditionalTop = authoredTop && grouping === 'HorizontalIfPossible'
      && items?.classList.contains('taxi-items--horizontal');
    if (items && (page || ordinaryGroup(node)) && (grouping === 'Horizontal' || conditionalTop) && children.length > 1
        && number(node, 'Width') <= 0 && !items.parentElement.querySelector(':scope > .taxi-group-title')
        && !items.hasAttribute('data-united-horizontal-lane')) register(node, items, children, page, authoredTop);
    for (const child of node.children) visit(child);
  }

  function register(node, items, children, page, authoredTop) {
    const columns = children.map(child => {
      const nodes = inputLaneFields(child, targets);
      if (!nodes?.length) return;
      const fields = nodes.map(field => inputTitleField(field, context, minimumCaptions, page, authoredTop));
      if (fields.some(field => !field)) return;
      return { element: targets.elements.get(child.key), fields };
    });
    if (columns.some(column => !column)) return;
    const fields = columns.flatMap(column => column.fields);
    if (!fields.some(field => (page || field.side) && ['number', 'date'].includes(field.kind))) return;
    const top = authoredTop && fields.some(field => field.flexible && field.kind === 'string') && fields.some(field => !field.flexible)
      ? fields : undefined;
    if (top) alignment.mark(items, 'data-authored-top-row');

    const gap = !page && automaticHorizontalSpacing(node) ? 11 : pixels(getComputedStyle(items).columnGap);
    const spacing = gap * (columns.length - 1);
    const plans = placements(columns);
    const preferred = total(columns.map(({fields}) => Math.max(...fields.map(field => field.side
      ? field.preferred + field.caption.preferred + inputCaptionInset + field.gap
      : Math.max(field.preferred, field.caption.preferred))))) + spacing;
    minimumRows.set(items, plans.at(-1).width + spacing);
    for (const name of ['--taxi-input-title-columns', '--taxi-input-title-gap']) alignment.style(items, name, '');
    alignment.mark(items, 'data-input-title-reflow', 'false');
    for (const column of columns) {
      const field = column.fields[0];
      alignment.style(column.element, '--taxi-field-track', top ? `${Math.max(field.preferred, field.caption.preferred)}px` : '');
      for (const field of column.fields) {
        captionFields.add(field.key);
        for (const name of ['--taxi-field-columns', '--taxi-field-caption-width', '--taxi-input-title-value-min', '--taxi-input-title-value-max']) {
          alignment.style(field.element, name, '');
        }
      }
    }
    const first = columns.map(({fields}) => fields[0]);
    const align = children.every(child => scalar(child, 'GroupVerticalAlign', 'Auto') === 'Auto')
      && first.every(field => !field.element.dataset.groupVerticalAlign || field.element.dataset.groupVerticalAlign === 'Auto');
    if (align) for (const field of first) alignment.style(field.element, '--taxi-input-title-offset', '');
    const pair = page && columns.length === 2 ? { items, left: first[0].key, right: first[1].key } : undefined;
    const tabs = page ? items.closest('.taxi-pages')?.querySelector(':scope > .taxi-tabs[data-side-fit-minimum]') : undefined;
    if (top && tabs) {
      alignment.mark(items, 'data-native-page-scroll', 'false');
      const height = Math.max(...top.map(field => borderBoxSize(field.element, scale).height));
      alignment.style(items.parentElement, '--taxi-page-row-height', `${height}px`);
    }
    rows.push({ owner: node.key, items, columns, gap, spacing, preferred, plans, page, pair, tabs, top, first: align ? first : [] });
  }

  if (os === 'linux') visit(model);
  return {
    minimumRows, captionFields,
    allocate(captions, resolveDivider) {
      const above = new Set();
      let heightChanged = false;
      for (const {owner, items, columns, gap, spacing, preferred, plans, page, pair, tabs, top, first} of rows) {
        const available = rowFitWidth(items, scale);
        const rail = sideTabWidths(tabs, scale);
        // As for conditional rows, Designer tests the title fit against the nominal tab width.
        const fitWidth = available + (rail ? rail.painted - rail.nominal : 0);
        const fit = plans.find(plan => plan.width + spacing <= fitWidth + .5) ?? plans.at(-1);
        const plan = top || fit.above.size || available + .5 < preferred ? fit : undefined;
        const abovePage = page && plan && columns.some(({fields}) => fields.some(field =>
          field.location === 'Top' || plan.above.has(field.key)));
        const lanes = plan && columns.map(({fields}, index) => {
          const width = (bound, captionMetric) => Math.max(...fields.map(field => widthFor(field, field[bound], plan.above,
            page ? field.caption[captionMetric] : plan.captionWidths[index],
            page ? field.caption[captionMetric] : field.caption.minimum)));
          const minimum = width('minimum', 'minimum'), preferred = width('preferred', 'preferred');
          // Once a page moves its titles above, distribute space from the compact column widths.
          return abovePage ? { reserve: 0, minimum, preferred: minimum, maximum: width('maximum', 'preferred'), growthWeight: minimum }
            : { reserve: 0, minimum, preferred, maximum: preferred };
        });
        const width = Math.round(available - spacing);
        const authored = top && allocateAuthoredPageTitles(width, fitWidth - spacing, top, lanes, rail);
        if (top && tabs) {
          const scroll = String(!!authored.scroll);
          if (items.dataset.nativePageScroll !== scroll) {
            items.dataset.nativePageScroll = scroll;
            if (authored.scroll) preparePageScrollbarPaint(items);
            else {
              delete items.dataset.pageScrollX;
              delete items.dataset.pageScrollY;
            }
            heightChanged = true;
          }
        }
        let sizes = authored?.sizes ?? (lanes && allocateLaneSizes(available - spacing, lanes));
        if (pair && (authored?.divider || plan?.above.size === 2) && resolveDivider) {
          const [left, right] = lanes;
          const minimum = Math.max(left.minimum, width - right.maximum);
          const maximum = Math.min(left.maximum, width - right.minimum);
          const divider = resolveDivider(owner, pair, width, minimum, maximum, () => sizes[0]);
          if (divider?.tracks) sizes = [divider.value, width - divider.value];
        }
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
            let captionWidth;
            if (side) captionWidth = page ? pageSideCaption(field, width) : plan.captionWidths[index];
            else if (plan && (moves || field.location === 'Top')) captionWidth = width;
            if (plan) allocateFieldCaption(captions, field, captionWidth, side ? inputCaptionInset : 0);
            else updateStyle(field.element, '--taxi-field-caption-width', '');
            updateStyle(field.element, '--taxi-field-columns', side ? 'var(--taxi-field-caption-width) minmax(0, 1fr)' : '');
            updateStyle(field.element, '--taxi-input-title-value-min', plan && field.flexible ? `${field.minimum}px` : '');
            updateStyle(field.element, '--taxi-input-title-value-max', plan && field.flexible && Number.isFinite(field.maximum) ? `${field.maximum}px` : '');
          }
        }
        if (first.length) {
          const alignTop = plan && first.some(field => field.location === 'Top' || plan.above.has(field.key));
          heightChanged = alignFirstControls(items, first, alignTop) || heightChanged;
        }
      }
      return { above, heightChanged };
    },
  };
}
