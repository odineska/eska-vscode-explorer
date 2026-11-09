import { checkboxField } from './checkbox-layout.js';
import { allocateFieldCaption, inputCaptionInset } from './field-caption-layout.js';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateLaneSizes, groupCanShrink } from './layout-model.mjs';
import { availableTrackWidth, borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { inputPaintedOutset, scalar } from './model.mjs';

function fixedDateField(node, { targets, os, scale }) {
  if (!['InputField', 'LabelField'].includes(node.kind) || node.presentation.valueType.kind !== 'date') return;
  const element = targets.elements.get(node.key);
  if (element.dataset.stretchX === 'true') return;
  const row = element.querySelector(':scope > .taxi-field-row[data-title-location=Left]');
  const label = row?.querySelector(':scope > .taxi-field-label');
  const control = row?.querySelector(':scope > .taxi-field-control:not([data-tooltip-button]) > :is(.taxi-input,.taxi-label-field)');
  if (!label || !control) return;
  const caption = fieldCaptionProfile(label.getAttribute('aria-label') ?? '', node.presentation.titleFont);
  if (!caption?.preferred) return;
  const value = borderBoxSize(control, scale).width + inputPaintedOutset(node, os);
  return { element, key: node.key, caption, value, lineHeight: pixels(getComputedStyle(label).lineHeight), gap: pixels(getComputedStyle(row).columnGap),
    automatic: scalar(node, 'TitleLocation', 'Auto') === 'Auto' };
}

function captionWidths(space, date, checkbox) {
  if (space >= date.preferred + checkbox.preferred) return [date.preferred, checkbox.preferred];
  if (space >= date.shortest + checkbox.preferred) return [space - checkbox.preferred, checkbox.preferred];
  if (space >= date.preferred + checkbox.compact) return [date.preferred, space - date.preferred];
  const widths = allocateLaneSizes(space, [date, checkbox]);
  if (widths[1] >= checkbox.compact) return widths;
  // Before the checkbox can lose a line, use the extra width for the shared date captions.
  const first = Math.min(date.preferred, space - checkbox.minimum);
  return [first, space - first];
}

/** A non-united row exposes its leading date to the vertical block's shared caption column. */
export function dateBlockLayout(model, context) {
  const { targets, alignment, os, scale } = context;
  const minimumRows = new Map(), minimumCaptions = new Map(), blocks = [];

  function visit(node) {
    const items = targets.containers.get(node.key);
    if (items && node.presentation.grouping === 'Vertical' && groupCanShrink(node, os)
      && targets.elements.get(node.key)?.dataset.stretchX === 'false') register(node, items);
    for (const child of node.children) visit(child);
  }

  function register(node, items) {
    const group = items.parentElement, owner = group.parentElement;
    if (group.querySelector(':scope > .taxi-group-title')) return;
    const children = targets.children(node);
    const rows = children.filter(child => child.presentation.grouping === 'Horizontal'
      && child.presentation.united === false && groupCanShrink(child, os));
    if (rows.length !== 1 || children.length < 2) return;
    const [rowNode] = rows;
    const row = targets.containers.get(rowNode.key);
    if (!row || row.parentElement.querySelector(':scope > .taxi-group-title') || boxInsets(getComputedStyle(row.parentElement)).width) return;
    const [first, ...rest] = targets.children(rowNode);
    if (!first || !rest.length) return;
    const leading = fixedDateField(first, context), checkbox = checkboxField(rest.at(-1), context);
    if (!leading || !checkbox || checkbox.caption.minimum === checkbox.caption.preferred) return;
    const middle = rest.slice(0, -1).map(child => targets.elements.get(child.key));
    if (middle.some(element => !['Button', 'PictureField'].includes(element.dataset.kind) || element.dataset.stretchX === 'true')) return;
    const fields = children.map(child => child === rowNode ? leading : fixedDateField(child, context));
    if (fields.some(field => !field)) return;

    alignment.mark(row, 'data-checkbox-row');
    alignment.mark(row, 'data-fixed-date-row');
    const spacing = (middle.length + 1) * pixels(getComputedStyle(row).columnGap);
    const middleWidths = middle.map(element => borderBoxSize(element, scale).width);
    const fixed = middleWidths.reduce((sum, width) => sum + width, checkbox.reserve);
    const sideValue = leading.value + leading.gap + inputCaptionInset;
    const topValue = Math.max(leading.value, leading.caption.minimum);
    const date = {
      minimum: Math.max(...fields.map(field => field.caption.minimum)),
      preferred: Math.max(...fields.map(field => field.caption.preferred)),
      shortest: Math.min(...fields.map(field => field.caption.preferred)),
    };
    const canMove = fields.every(field => field.automatic);
    const sideMinimum = fixed + sideValue + date.minimum + checkbox.caption.minimum;
    const preferred = fixed + sideValue + date.preferred + checkbox.caption.preferred;
    const topMinimum = fixed + topValue + checkbox.caption.minimum;
    minimumRows.set(row, spacing + (canMove ? topMinimum : sideMinimum));

    for (const [container, mode] of [[items, 'all'], [row, 'leading']]) {
      alignment.mark(container, 'data-through-labels', mode);
      alignment.style(container, '--taxi-through-label-width', `${date.preferred + inputCaptionInset}px`);
      alignment.style(container, '--taxi-through-allocated-label-width', '');
    }
    for (const field of fields) {
      minimumCaptions.set(field.key, canMove ? 0 : date.minimum + inputCaptionInset);
      alignment.style(field.element, '--taxi-field-caption-width', '');
    }
    const elements = [leading.element, ...middle, checkbox.element];
    const heights = elements.map(element => borderBoxSize(element, scale).height);
    const rowHeight = Math.max(...heights);
    const slots = elements.map((element, index) => ({ element, offset: (rowHeight - heights[index]) / 2 }));
    for (const element of elements) {
      alignment.style(element, '--taxi-field-track', '');
      alignment.style(element, '--taxi-fixed-date-top', '');
    }
    alignment.style(checkbox.element, '--taxi-field-caption-width', '');
    alignment.mark(owner, 'data-fixed-date-block');
    alignment.style(owner, '--taxi-fixed-date-width', '');
    for (const [index, element] of middle.entries()) updateStyle(element, '--taxi-field-track', `${middleWidths[index]}px`);
    blocks.push({ items, row, owner, fields, leading, checkbox, date, fixed, sideValue, topValue, canMove, sideMinimum, preferred,
      slots, outer: spacing + boxInsets(getComputedStyle(group)).width });
  }

  if (os === 'linux') visit(model);
  return {
    minimumRows, minimumCaptions,
    allocate(captions, above, columnFraction) {
      for (const block of blocks) {
        const { items, row, owner, fields, leading, checkbox, date, fixed, sideValue, topValue,
          canMove, sideMinimum, preferred, slots, outer } = block;
        const width = sideMinimum + (preferred - sideMinimum) * columnFraction(owner);
        updateStyle(owner, '--taxi-fixed-date-width', `${Math.round(width + outer)}px`);
        const available = availableTrackWidth(row, slots.length, scale);
        const move = canMove && available < sideMinimum;
        const space = available - fixed - sideValue;
        const [title, check] = move
          ? [0, Math.min(checkbox.caption.preferred, Math.max(checkbox.caption.minimum, available - fixed - topValue))]
          : captionWidths(Math.max(space, date.minimum + checkbox.caption.minimum), date, checkbox.caption);
        const track = move ? topValue : sideValue + title;
        const shared = move ? '' : `${title + inputCaptionInset}px`;
        for (const container of [items, row]) updateStyle(container, '--taxi-through-allocated-label-width', shared);
        updateStyle(leading.element, '--taxi-field-track', `${track}px`);
        updateStyle(checkbox.element, '--taxi-field-track', `${checkbox.reserve + check}px`);
        allocateFieldCaption(captions, checkbox, check);
        for (const field of fields) {
          if (move) above.add(field.key);
          allocateFieldCaption(captions, field, move ? (field === leading ? track : available) : title, move ? 0 : inputCaptionInset);
        }
        const titleLines = captions.get(leading.key)?.split('\n').length ?? leading.caption.paragraphs.length;
        const raisedTitle = move ? titleLines * leading.lineHeight : 0;
        // Keep the preferred baselines as the row grows, allowing room for a title above the date.
        for (const { element, offset } of slots) {
          const top = move && element === leading.element ? 0 : offset + raisedTitle;
          updateStyle(element, '--taxi-fixed-date-top', top ? `${top}px` : '');
        }
      }
    },
  };
}
