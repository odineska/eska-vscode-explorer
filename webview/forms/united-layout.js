import { stretches, ordinaryGroup, horizontalGrouping, automaticHorizontalSpacing, allocateLaneSizes, roundTrackWidths, stretchWeight } from './layout-model.mjs';
import { inputLaneLayout } from './input-lane-layout.js';
import { shareUnitedGroupSpacing } from './group-spacing-layout.js';
import { availableTrackWidth, borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { textInputWidthBounds } from './model.mjs';

function ordinaryVerticalGroup(node) {
  return ordinaryGroup(node) && node.presentation.grouping === 'Vertical' && typeof node.presentation.united === 'boolean';
}

function groupWidthInsets(items) {
  return items ? boxInsets(getComputedStyle(items)).width + boxInsets(getComputedStyle(items.parentElement)).width : 0;
}

/** Share row tracks between side-by-side vertical groups. A united child uses one track. */
export function alignUnitedRows(model, context, wrapped) {
  const { targets, alignment, collapsed, os, scale } = context;
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const owners = new Set(), columnPairs = new Map(), columnBounds = new Map();
  const { register, minimumCaptions, allocateWidths: allocateInputs } = inputLaneLayout(context);

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
    const separatedColumn = children.some(child => ordinaryVerticalGroup(child) && child.presentation.united === false);
    if (items && horizontalGrouping(node) && children.length > 1
      && (children.every(ordinaryVerticalGroup) || separatedColumn)) {
      owners.add(node.key);
      if (automaticHorizontalSpacing(node)) mark(items, 'data-united-auto-spacing');
      if (!wrapped.has(node.key)) {
        const inputs = shareRows(items, children, node.presentation.grouping === 'Horizontal');
        // Exposed rows share their parent's grid and have no separate column boundary.
        if (children.length === 2 && children.every(child => ordinaryVerticalGroup(child) && child.presentation.united)) {
          const [left, right] = children;
          const groups = os === 'linux' && !inputs && children.every(child => stretches(child, 'x', collapsed, model)) ? children : undefined;
          columnPairs.set(node.key, { items, left: left.key, right: right.key, groups });
          if (groups) style(items, '--taxi-united-allocated-columns', '');
        }
      }
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
    shareUnitedGroupSpacing(lanes, alignment);
    // A single row already receives its measured minimum from the parent layout.
    // A max-content floor would retain the children's previous allocated heights.
    const minimum = tracks === 1 ? '0' : 'max-content';
    style(items, '--taxi-united-tracks', Array.from({length: tracks}, (_, index) =>
      flexible.has(index) ? `minmax(${minimum}, 1fr)` : 'max-content').join(' '));
    return register(items, children, allowWrap);
  }

  visit(model);
  function capturePreferredColumns(titleFloors) {
    for (const owner of owners) {
      const items = containers.get(owner);
      if (items.hasAttribute('data-united-columns')) {
        const columns = getComputedStyle(items).gridTemplateColumns;
        style(items, '--taxi-united-preferred-columns', columns);
        const pair = columnPairs.get(owner);
        if (pair) {
          pair.natural = columns.split(' ').map(pixels);
          pair.preferred = pair.natural.reduce((sum, width) => sum + width, 0);
          if (pair.groups) {
            pair.available = availableTrackWidth(items, pair.natural.length, scale);
            if (!titleFloors.size) continue;
            const children = pair.groups.map(mountedChildren);
            const blocks = children.map(nodes => nodes.flatMap(node => {
              const profile = titleFloors.get(node.key);
              return profile ? [{ key: node.key, ...profile }] : [];
            }));
            if (blocks.some(children => children.length)) {
              pair.captionColumns = pair.groups.map((node, index) => {
                const insets = groupWidthInsets(containers.get(node.key))
                  + pixels(elements.get(node.key).style.getPropertyValue('--taxi-group-spacing-x'));
                const fields = blocks[index].some(block => block.compactWidth !== undefined)
                  ? children[index].filter(child => elements.get(child.key).dataset.stretchX === 'true') : [];
                const widths = fields.map(field => field.presentation.titleLocation === 'None'
                  ? textInputWidthBounds(field, os)?.preferredPaint : undefined);
                const inputPreference = widths.length && widths.every(Number.isFinite) ? Math.max(...widths) + insets : undefined;
                return { insets, blocks: blocks[index], inputPreference };
              });
            }
          }
        }
      }
    }
  }
  function stretchWidth(node, minima) {
    const element = elements.get(node.key);
    if (element.dataset.stretchX !== 'true') return 0;
    const preferred = pixels(element.style.getPropertyValue('--taxi-preferred-width'));
    const width = Math.min(preferred, minima.get(node.key)?.maximumWidth ?? Infinity);
    const items = containers.get(node.key);
    if (!items || !ordinaryVerticalGroup(node)) return width;
    const child = Math.max(0, ...mountedChildren(node).map(node => stretchWidth(node, minima)));
    if (!child) return width;
    return Math.min(width, child + groupWidthInsets(items));
  }
  function captionFloors(pair, tracks, minima, available) {
    if (!pair.captionColumns || available >= pair.preferred) return;
    const candidates = pair.captionColumns.map(({ insets, blocks }, index) => {
      const { minimum } = tracks[index];
      const dates = blocks.flatMap(block => {
        const bounds = minima.get(block.key);
        return bounds ? [{ ...block, width: bounds.width + insets }] : [];
      });
      return { minimum, insets, mixed: Math.max(minimum, ...dates.map(date => date.width + date.mixed)),
        side: Math.max(minimum, ...dates.map(date => date.width + date.side)) };
    });
    if (candidates.every(candidate => candidate.side <= candidate.minimum)) return;
    for (const level of ['side', 'mixed']) {
      const widths = candidates.map(candidate => candidate[level]);
      if (widths.reduce((sum, width) => sum + width, 0) <= available) return { widths };
    }
    // Before the side captions fit, share extra space in proportion to the minimum content widths.
    const widths = candidates.map(candidate => candidate.minimum);
    const weights = candidates.map(candidate => Math.max(0, candidate.minimum - candidate.insets));
    const remainder = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0));
    const weight = weights.reduce((sum, width) => sum + width, 0) || 1;
    const allocated = roundTrackWidths(widths.map((width, index) => width + remainder * weights[index] / weight), Math.floor);
    return { widths, allocated };
  }
  function allocateWidths(captions, minima) {
    allocateInputs(captions);
    for (const pair of columnPairs.values()) {
      if (!pair.groups) continue;
      const lanes = pair.groups.map((node, index) => {
        const bounds = minima.get(node.key);
        const minimum = bounds?.width ?? pair.natural[index];
        const preferred = Math.max(minimum, pair.natural[index]);
        return { minimum, preferred, maximum: Math.max(preferred, bounds?.maximumWidth ?? Infinity),
          growthWeight: stretchWeight(node, 'x') };
      });
      // A complex pair can already expand inside the form's preferred width.
      // Shrink both columns from that allocation before using their individual floors.
      const natural = lanes.reduce((sum, lane) => sum + lane.preferred, 0);
      const preferred = allocateLaneSizes(Math.max(natural, pair.available), lanes);
      pair.preferred = preferred.reduce((sum, width) => sum + width, 0);
      const available = availableTrackWidth(pair.items, lanes.length, scale);
      let tracks = lanes.map((lane, index) => ({ ...lane, preferred: preferred[index] }));
      const floors = captionFloors(pair, tracks, minima, available);
      pair.minimumWidths = floors?.widths;
      if (floors) tracks = tracks.map((track, index) => ({ ...track, minimum: floors.widths[index] }));
      for (const [index, node] of pair.groups.entries()) columnBounds.set(elements.get(node.key), tracks[index]);
      const topColumns = !floors && available < pair.preferred
        ? pair.captionColumns?.flatMap(({ insets, blocks, inputPreference }, index) => blocks.flatMap(block =>
          block.compactWidth !== undefined && minima.get(block.key)?.width + insets === tracks[index].minimum
            ? [{ index, inputPreference, compactWidth: block.compactWidth + insets }] : []))
        : undefined;
      const top = topColumns?.length === 1 ? topColumns[0] : undefined;
      // Round the top-caption track before its sibling takes the remainder.
      let widths = floors?.allocated ?? (top?.index === 1
        ? allocateLaneSizes(available, [tracks[1], tracks[0]]).reverse()
        : allocateLaneSizes(available, tracks));
      if (top?.inputPreference !== undefined) {
        const { index, inputPreference, compactWidth } = top;
        const other = 1 - index;
        // Keep enough room for a two-line checkbox once its compact width fits.
        const compact = widths[index] >= compactWidth ? compactWidth : 0;
        const limit = Math.max(tracks[index].minimum, inputPreference, compact, available - tracks[other].preferred);
        const spare = Math.max(0, widths[index] - limit);
        widths[index] -= spare;
        widths[other] += spare;
      }
      if (widths.reduce((sum, width) => sum + width, 0) < available) {
        // The group tracks still fill the row when all controls have reached their caps.
        // A wide fixed descendant contributes to the preferred size, but does not attract surplus.
        widths = allocateLaneSizes(available, tracks.map((track, index) => ({ ...track,
          preferred: widths[index], maximum: Infinity, growthWeight: Math.max(1, stretchWidth(pair.groups[index], minima)),
        })));
      }
      updateStyle(pair.items, '--taxi-united-allocated-columns', widths.map(width => `${width}px`).join(' '));
    }
  }
  function columnFraction(element) {
    const column = element.closest('.taxi-element[data-united-cell]');
    const bounds = columnBounds.get(column);
    if (!bounds || bounds.preferred <= bounds.minimum) return 1;
    const width = borderBoxSize(column, scale).width;
    return Math.max(0, Math.min(1, (width - bounds.minimum) / (bounds.preferred - bounds.minimum)));
  }
  return { owners, columnPairs, minimumCaptions, allocateWidths, capturePreferredColumns, columnFraction };
}
