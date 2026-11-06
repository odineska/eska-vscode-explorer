import { fieldWidth, number, scalar } from './model.mjs';
import { horizontalLaneWidths, laneInputBounds, stretches } from './layout-model.mjs';
import { borderBoxSize } from './layout-box.mjs';

function ordinaryVerticalGroup(node) {
  return node.kind === 'UsualGroup' && node.presentation.grouping === 'Vertical'
    && typeof node.presentation.united === 'boolean'
    && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'));
}

/** Share row tracks between side-by-side vertical groups. A united child uses one track. */
export function alignUnitedRows(model, elements, containers, wrapped, collapsed, os, scale) {
  const undo = [], owners = new Set(), allocations = [];
  const mark = (element, attribute) => {
    element.setAttribute(attribute, '');
    undo.push(() => element.removeAttribute(attribute));
  };
  const style = (element, name, value) => {
    element.style.setProperty(name, value);
    undo.push(() => element.style.removeProperty(name));
  };

  function lane(node) {
    const element = elements.get(node.key);
    const items = containers.get(node.key);
    const group = items?.parentElement;
    if (!element || !items || !ordinaryVerticalGroup(node) || node.presentation.united) return { node, element, rows: 1 };
    const title = group.querySelector(':scope > .taxi-group-title');
    const children = node.children.filter(child => elements.has(child.key)).map(lane);
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
    const children = node.children.filter(child => elements.has(child.key));
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
    const fields = inputs.map((row, index) => row.map(node => ({
      element: elements.get(node.key), preferred: fieldWidth(node, os),
      flexible: stretches(children[index], 'x', collapsed) && stretches(node, 'x', collapsed),
      bounds: laneInputBounds(node, os),
    })));
    if (fields.some(row => row.some(field => field.flexible && !field.bounds))) return;
    const tracks = fields.map((row, index) => {
      const preferred = borderBoxSize(elements.get(children[index].key), scale).width;
      const reserve = Math.max(0, preferred - Math.max(...row.map(field => field.preferred)));
      const minimum = reserve + Math.max(...row.map(field => field.flexible ? field.bounds.minimum : field.preferred));
      const maximum = reserve + Math.max(...row.map(field => field.flexible ? field.bounds.maximum : field.preferred));
      return { reserve, preferred, minimum: Math.min(preferred, minimum), maximum: Math.max(preferred, maximum) };
    });
    for (const field of fields.flat().filter(field => field.flexible)) {
      style(field.element, '--taxi-lane-input-min-width', `${field.bounds.minimum}px`);
      if (Number.isFinite(field.bounds.maximum)) style(field.element, '--taxi-lane-input-max-width', `${field.bounds.maximum}px`);
    }
    allocations.push({items, tracks});
    undo.push(() => items.style.removeProperty('--taxi-united-allocated-columns'));
  }

  function visit(node) {
    const children = node.children.filter(child => elements.has(child.key));
    const items = containers.get(node.key);
    if (items && ['Horizontal', 'HorizontalIfPossible'].includes(node.presentation.grouping)
      && children.length > 1 && children.every(ordinaryVerticalGroup)) {
      owners.add(node.key);
      if (scalar(node, 'HorizontalSpacing', 'Auto') === 'Auto') mark(items, 'data-united-auto-spacing');
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
        const css = getComputedStyle(items);
        const insets = ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + parseFloat(css[key]), 0);
        const available = Math.round(borderBoxSize(items, scale).width - insets - parseFloat(css.columnGap) * (tracks.length - 1));
        return horizontalLaneWidths(available, tracks).map(value => `${value}px`).join(' ');
      });
      for (const [index, {items}] of allocations.entries()) {
        if (items.style.getPropertyValue('--taxi-united-allocated-columns') !== widths[index]) {
          items.style.setProperty('--taxi-united-allocated-columns', widths[index]);
        }
      }
    },
    clear: () => { for (const restore of undo) restore(); },
  };
}
