import { stretches, ordinaryGroup, horizontalGrouping, automaticHorizontalSpacing } from './layout-model.mjs';
import { inputLaneLayout } from './input-lane-layout.js';

function ordinaryVerticalGroup(node) {
  return ordinaryGroup(node) && node.presentation.grouping === 'Vertical' && typeof node.presentation.united === 'boolean';
}

/** Share row tracks between side-by-side vertical groups. A united child uses one track. */
export function alignUnitedRows(model, context, wrapped) {
  const { targets, alignment, collapsed } = context;
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const owners = new Set();
  const { register, minimumCaptions, allocateWidths } = inputLaneLayout(context);

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

  function visit(node) {
    const children = mountedChildren(node);
    const items = containers.get(node.key);
    if (items && horizontalGrouping(node)
      && children.length > 1 && children.every(ordinaryVerticalGroup)) {
      owners.add(node.key);
      if (automaticHorizontalSpacing(node)) mark(items, 'data-united-auto-spacing');
      if (!wrapped.has(node.key)) shareRows(items, children, node.presentation.grouping === 'Horizontal');
    }
    for (const child of node.children) visit(child);
  }

  function shareRows(items, children, allowWrap) {
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
    register(items, children, allowWrap);
  }

  visit(model);
  for (const owner of owners) {
    const items = containers.get(owner);
    if (items.hasAttribute('data-united-columns')) {
      style(items, '--taxi-united-preferred-columns', getComputedStyle(items).gridTemplateColumns);
    }
  }
  return { owners, minimumCaptions, allocateWidths };
}
