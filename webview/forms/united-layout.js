import { scalar } from './model.mjs';
import { stretches } from './layout-model.mjs';

function ordinaryVerticalGroup(node) {
  return node.kind === 'UsualGroup' && node.presentation.grouping === 'Vertical'
    && typeof node.presentation.united === 'boolean'
    && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'));
}

/** Share row tracks between side-by-side vertical groups. A united child uses one track. */
export function alignUnitedRows(root, model, wrapped, collapsed) {
  const elements = new Map([...root.querySelectorAll('[data-element]')].map(element => [element.dataset.element, element]));
  const containers = new Map([...root.querySelectorAll('.taxi-items[data-layout-owner]')].map(items => [items.dataset.layoutOwner, items]));
  const undo = [], owners = new Set();
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
  }

  visit(model);
  for (const items of root.querySelectorAll('.taxi-items[data-united-columns]')) {
    style(items, '--taxi-united-preferred-columns', getComputedStyle(items).gridTemplateColumns);
  }
  return { owners, clear: () => { for (const restore of undo) restore(); } };
}
