import { fieldWidth, number } from './model.mjs';
import { horizontalLaneWidths, laneInputBounds, stretches, ordinaryGroup, horizontalGrouping, automaticHorizontalSpacing } from './layout-model.mjs';
import { availableTrackWidth, borderBoxSize, updateStyle } from './layout-box.mjs';
import { designCaptionWidth } from './font-metrics.mjs';

function ordinaryVerticalGroup(node) {
  return ordinaryGroup(node) && node.presentation.grouping === 'Vertical' && typeof node.presentation.united === 'boolean';
}

/** The 10 pt profiles add half of a reflowable title's text width to their value weight. */
function automaticFieldWeight({node, element}) {
  if (number(node, 'Width') > 0) return;
  const location = node.presentation.titleLocation;
  if (!['Left', 'None'].includes(location)) return;
  const base = node.presentation.valueType.kind === 'reference' ? 98 : 78;
  if (location === 'None') return base;
  const title = element.querySelector('.taxi-field-label')?.getAttribute('aria-label')?.replace(/:$/, '') ?? '';
  if (/[\r\n]/u.test(title)) return;
  if (!/\S +\S/u.test(title)) return base;
  const width = designCaptionWidth(title, node.presentation.titleFont);
  if (width !== undefined) return base + Math.floor(width / 2);
}

function automaticLaneWeight(row) {
  const weights = row.filter(field => field.flexible).map(automaticFieldWeight);
  if (weights.every(weight => weight !== undefined)) return Math.max(0, ...weights);
}

/** Share row tracks between side-by-side vertical groups. A united child uses one track. */
export function alignUnitedRows(model, { targets, alignment, collapsed, os, scale }, wrapped) {
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const owners = new Set(), allocations = [];

  function lane(node) {
    const element = elements.get(node.key);
    const items = containers.get(node.key);
    const group = items?.parentElement;
    if (!element || !items || !ordinaryVerticalGroup(node) || node.presentation.united) return { node, element, rows: 1 };
    const title = group.querySelector(':scope > .taxi-group-title');
    const children = mountedChildren(node).map(lane);
    const rows = children.reduce((total, child) => total + child.rows, title ? 1 : 0);
    if (!rows) return { node, element, rows: 1 };
    return { node, element, rows, items, group, title, children };
  }

  function place(entry, first, track, flexible) {
    const { node, element, rows, items, group, title, children } = entry;
    mark(element, 'data-united-cell');
    style(element, '--taxi-united-row', `${first} / span ${rows}`);
    if (!children?.length) {
      if (!items && stretches(node, 'y', collapsed)) flexible.add(track);
      return;
    }
    mark(element, 'data-united-branch');
    mark(group, 'data-united-group');
    mark(items, 'data-united-items');
    let childRow = 1;
    style(items, '--taxi-united-start', title ? '2' : '1');
    let childTrack = track + (title ? 1 : 0);
    for (const child of children) {
      place(child, childRow, childTrack, flexible);
      childRow += child.rows;
      childTrack += child.rows;
    }
  }

  function laneInputs(node) {
    if (node.kind === 'InputField') return [node];
    const items = containers.get(node.key);
    const children = mountedChildren(node);
    if (node.kind !== 'UsualGroup' || !items || number(node, 'Width') > 0
        || items.parentElement.querySelector(':scope > .taxi-group-title')
        || node.presentation.grouping !== 'Vertical' && children.length !== 1) return;
    const inputs = children.map(laneInputs);
    if (inputs.every(Boolean)) return inputs.flat();
  }

  function trackWidths(items, children) {
    if (os !== 'linux') return;
    const inputs = children.map(laneInputs);
    if (inputs.some(row => !row?.length)) return;
    const fields = inputs.map((row, index) => {
      const flexible = stretches(children[index], 'x', collapsed);
      return row.map(node => {
        const bounds = laneInputBounds(node, os), intrinsic = fieldWidth(node, os);
        const stretch = flexible && stretches(node, 'x', collapsed);
        return { node, element: elements.get(node.key), preferred: stretch ? bounds?.preferred ?? intrinsic : intrinsic,
          flexible: stretch, bounds };
      });
    });
    if (fields.some(row => row.some(field => field.flexible && !field.bounds))) return;
    for (const field of fields.flat().filter(field => field.flexible)) {
      style(field.element, '--taxi-lane-input-min-width', `${field.bounds.minimum}px`);
      if (Number.isFinite(field.bounds.maximum)) {
        mark(field.element, 'data-lane-input-maximum');
        style(field.element, '--taxi-lane-input-max-width', `${field.bounds.maximum}px`);
      }
    }
    const tracks = fields.map((row, index) => {
      const preferred = borderBoxSize(elements.get(children[index].key), scale).width;
      const reserve = Math.max(0, preferred - Math.max(...row.map(field => field.preferred)));
      const minimum = reserve + Math.max(...row.map(field => field.flexible ? field.bounds.minimum : field.preferred));
      const maximum = reserve + Math.max(...row.map(field => field.flexible ? field.bounds.maximum : field.preferred));
      return { reserve, preferred, minimum: Math.min(preferred, minimum), maximum: Math.max(preferred, maximum),
        growthWeight: automaticLaneWeight(row) };
    });
    allocations.push({items, tracks});
    style(items, '--taxi-united-allocated-columns', '');
  }

  function visit(node) {
    const children = mountedChildren(node);
    const items = containers.get(node.key);
    if (items && horizontalGrouping(node)
      && children.length > 1 && children.every(ordinaryVerticalGroup)) {
      owners.add(node.key);
      if (automaticHorizontalSpacing(node)) mark(items, 'data-united-auto-spacing');
      if (!wrapped.has(node.key)) shareRows(items, children);
    }
    for (const child of node.children) visit(child);
  }

  function shareRows(items, children) {
    const lanes = children.map(lane);
    const tracks = Math.max(...lanes.map(entry => entry.rows));
    mark(items, 'data-united-columns');
    style(items, '--taxi-united-column-count', String(lanes.length));
    style(items, '--taxi-united-row-count', String(tracks));
    const flexible = new Set();
    for (const [index, entry] of lanes.entries()) {
      place(entry, 1, 0, flexible);
      style(entry.element, '--taxi-united-column', String(index + 1));
    }
    style(items, '--taxi-united-tracks', Array.from({length: tracks}, (_, index) =>
      flexible.has(index) ? 'minmax(max-content, 1fr)' : 'max-content').join(' '));
    trackWidths(items, children);
  }

  visit(model);
  for (const owner of owners) {
    const items = containers.get(owner);
    if (items.hasAttribute('data-united-columns')) {
      style(items, '--taxi-united-preferred-columns', getComputedStyle(items).gridTemplateColumns);
    }
  }
  return {
    owners,
    allocateWidths() {
      const widths = allocations.map(({items, tracks}) => {
        const available = availableTrackWidth(items, tracks.length, scale);
        return horizontalLaneWidths(available, tracks).map(value => `${value}px`).join(' ');
      });
      for (const [index, {items}] of allocations.entries()) {
        updateStyle(items, '--taxi-united-allocated-columns', widths[index]);
      }
    },
  };
}
