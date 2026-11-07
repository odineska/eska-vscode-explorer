import { checkboxMode } from './checkbox-model.mjs';
import { allocateFieldCaption } from './field-caption-layout.js';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { availableTrackWidth, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { groupCanShrink, horizontalLaneWidths } from './layout-model.mjs';
import { number } from './model.mjs';

function checkboxField(node, { targets, scale }) {
  if (node.kind !== 'CheckBoxField' || checkboxMode(node) !== 'CheckBox' || number(node, 'Width') > 0) return;
  const element = targets.elements.get(node.key);
  if (element.dataset.stretchX === 'true') return;
  const row = element.querySelector(':scope > .taxi-field-row[data-title-location=Right]');
  const label = row?.querySelector(':scope > .taxi-field-label');
  const text = label?.getAttribute('aria-label');
  if (!text) return;
  const caption = fieldCaptionProfile(text, node.presentation.titleFont);
  if (!caption || caption.paragraphs.length !== 1) return;
  const reserve = Math.round((label.getBoundingClientRect().left - row.getBoundingClientRect().left) / scale);
  return { element, key: node.key, caption, reserve };
}

function checkboxColumn(node, context) {
  const { targets, os } = context;
  const element = targets.elements.get(node.key);
  const items = targets.containers.get(node.key);
  const group = items?.parentElement;
  const stack = group && groupCanShrink(node, os) && node.presentation.grouping === 'Vertical'
    && !group.querySelector(':scope > .taxi-group-title') && boxInsets(getComputedStyle(group)).width === 0;
  const fields = (stack ? targets.children(node) : [node]).map(child => checkboxField(child, context));
  if (!fields.length || fields.some(field => !field) || element.dataset.stretchX === 'true') return;
  const width = bound => Math.max(...fields.map(field => field.reserve + field.caption[bound]));
  const preferred = width('preferred');
  return { element, fields, minimum: width('minimum'), preferred, maximum: preferred, reserve: 0 };
}

/** Allocate caption space in a horizontal group of ordinary checkboxes. */
export function checkboxLayout(model, context) {
  const { targets, alignment, os, scale } = context;
  const minimumRows = new Map(), rows = [];

  function visit(node) {
    const items = targets.containers.get(node.key);
    if (items && groupCanShrink(node, os) && node.presentation.grouping === 'Horizontal'
        && !items.hasAttribute('data-united-columns') && !items.hasAttribute('data-united-horizontal-lane')
        && !items.parentElement.querySelector(':scope > .taxi-group-title')) {
      const columns = targets.children(node).map(child => checkboxColumn(child, context));
      if (columns.length > 1 && columns.every(Boolean)) register(items, columns);
    }
    for (const child of node.children) visit(child);
  }

  function register(items, columns) {
    // Designer reserves the widest caption column before distributing space to the others.
    const widest = columns.reduce((max, column) => column.preferred > max.preferred ? column : max);
    widest.minimum = widest.preferred;
    alignment.mark(items, 'data-checkbox-row');
    const spacing = pixels(getComputedStyle(items).columnGap) * (columns.length - 1);
    minimumRows.set(items, columns.reduce((width, column) => width + column.minimum, spacing));
    for (const column of columns) {
      alignment.style(column.element, '--taxi-field-track', `${column.preferred}px`);
      for (const field of column.fields) {
        alignment.style(field.element, '--taxi-field-caption-width', `${field.caption.preferred}px`);
      }
    }
    rows.push({items, columns});
  }

  if (os === 'linux') visit(model);
  return {
    minimumRows,
    allocate(captions) {
      for (const {items, columns} of rows) {
        const available = availableTrackWidth(items, columns.length, scale);
        const widths = horizontalLaneWidths(available, columns);
        for (const [index, { element, fields }] of columns.entries()) {
          const width = widths[index];
          updateStyle(element, '--taxi-field-track', `${width}px`);
          for (const field of fields) {
            allocateFieldCaption(captions, field, Math.min(width - field.reserve, field.caption.preferred));
          }
        }
      }
    },
  };
}
