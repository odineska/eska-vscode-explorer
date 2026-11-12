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

function spreadCaptionSurplus(widths, weights, available, first = 0, round = Math.floor) {
  const remainder = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0));
  const weight = weights.reduce((sum, width) => sum + width, 0) || 1;
  const requested = widths.map((width, index) => width + remainder * weights[index] / weight);
  return first === 1 ? roundTrackWidths(requested.reverse(), round).reverse() : roundTrackWidths(requested, round);
}

function partialCaptionFloors(column, candidates, available) {
  const transition = column?.block.transition;
  if (!transition) return;
  const { index, insets, inputPreference } = column;
  const { leadingTop, partial } = transition;
  const { minimum, side } = candidates[index];
  const labelMinimum = partial ? Math.max(minimum, partial.minimum + insets) : minimum;
  const pinned = leadingTop && inputPreference > minimum && inputPreference < side && inputPreference >= labelMinimum;
  if (!pinned && (!partial || labelMinimum >= side)) return;

  const widths = candidates.map(candidate => candidate.minimum);
  const weights = candidates.map(candidate => Math.max(0, candidate.minimum - candidate.insets));
  const other = 1 - index;
  const leadingMinimum = Math.max(labelMinimum, (partial?.leadingMinimum ?? Infinity) + insets);
  const leadingSide = !pinned && leadingMinimum + widths[other] <= available;
  widths[index] = pinned ? inputPreference : leadingSide ? leadingMinimum : labelMinimum;
  if (widths[index] + widths[other] > available) return;
  if (!pinned) weights[index] = inputPreference <= labelMinimum ? partial.preferredWeight : partial.valueWeight;
  const first = leadingTop && !pinned ? index : 0;
  return {
    widths, allocated: spreadCaptionSurplus(widths, weights, available, first),
    partial: { leadingSide, reserveLabel: !!partial },
  };
}

function fillFraction(width, { minimum, preferred }) {
  return preferred > minimum ? Math.max(0, Math.min(1, (width - minimum) / (preferred - minimum))) : 1;
}

function packThroughDate(block, track, insets, provisional, allocated, minima) {
  const { through, top } = block;
  const budget = width => {
    const fraction = fillFraction(width, track);
    const preferred = track.preferred - insets - through.trailingPreferred;
    // The shared leading slot can grow after the date block reaches its own limit.
    const requested = top ? top.minimum + Math.max(0, preferred - top.minimum) * fraction : block.widthAt(fraction);
    return Math.min(requested, allocated - insets - through.trailingMinimum);
  };
  const space = budget(provisional);
  const packed = (top?.pack ?? block.pack)(space);
  if (!packed) return;
  const width = Math.min(Math.round(budget(allocated)), Math.max(packed.width, through.leadingWidth(space, minima)));
  return {
    width,
    allocate(leadingWidth) {
      // A fixed date block keeps its packed width while the mixed rows retain the shared slot.
      const plan = packed.allocate(block.stretch ? leadingWidth : packed.width, Math.round);
      return top || !block.stretch ? { ...plan, leadingWidth } : plan;
    },
  };
}

function packedDateColumn(pair, tracks, available, widths, partial, minima) {
  const column = pair.packedDateColumn;
  if (!column || available >= pair.preferred) return;
  const { index, insets, block, inputPreference } = column;
  const through = block.through;
  // Match the separator's one-pixel tolerance at the preferred row width.
  if (through && available + 1 >= pair.preferred) return;
  const blockWidth = widths[index] - insets;
  const transition = block.transition;
  if (partial?.reserveLabel) {
    const layout = transition.partial;
    return {
      key: block.key, widths, plan: layout.allocate(blockWidth, partial.leadingSide),
      manual(firstTrack) {
        const actual = (index === 0 ? firstTrack : available - firstTrack) - insets;
        if (actual >= layout.minimum && actual < transition.sideMinimum) {
          return layout.allocate(actual, actual >= layout.leadingMinimum);
        }
      },
    };
  }
  // Fit whole words before rounding the column tracks for display.
  const provisional = allocateLaneSizes(available, tracks, { fractional: true })[index];
  const packed = through ? packThroughDate(block, tracks[index], insets, provisional, widths[index], minima)
    : block.pack(provisional - insets);
  if (!packed) {
    if (transition && blockWidth < transition.sideMinimum && blockWidth > transition.abovePreferred) {
      return { key: block.key, widths, plan: { width: transition.abovePreferred } };
    }
    return;
  }
  const other = 1 - index;
  // A bounded sibling can use the width freed by wrapping while its controls still have room to grow.
  const trailing = through?.trailingPreferred ?? 0;
  const cap = Math.max(packed.width + insets + trailing, inputPreference ?? 0, tracks[index].minimum, available - tracks[other].preferred);
  const width = through ? Math.min(widths[index], Math.round(cap)) : Math.min(Math.floor(provisional + 1e-7), cap);
  const allocated = index === 0 ? [width, available - width] : [available - width, width];
  const plan = (fit, width) => fit?.allocate(Math.max(fit.width, width - insets - trailing));
  return {
    key: block.key, widths: allocated, plan: plan(packed, width),
    manual: block.top || (through && !block.stretch) ? firstTrack => {
      const actual = index === 0 ? firstTrack : available - firstTrack;
      return plan(packThroughDate(block, tracks[index], insets, actual, actual, minima), actual);
    } : undefined,
  };
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
  function capturePreferredColumns(titleFloors, fixedThroughWidths) {
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
              if (!profile) return [];
              const through = fixedThroughWidths.get(elements.get(node.key));
              return [{ key: node.key, trailing: through?.trailingMinimum ?? 0, ...profile, through }];
            }));
            if (blocks.some(children => children.length)) {
              pair.captionColumns = pair.groups.map((node, index) => {
                const insets = groupWidthInsets(containers.get(node.key))
                  + pixels(elements.get(node.key).style.getPropertyValue('--taxi-group-spacing-x'));
                const fields = blocks[index].some(block => block.pack || block.compactWidth !== undefined)
                  ? children[index].filter(child => elements.get(child.key).dataset.stretchX === 'true') : [];
                const widths = fields.map(field => field.presentation.titleLocation === 'None'
                  ? textInputWidthBounds(field, os)?.preferredPaint : undefined);
                const inputPreference = widths.length && widths.every(Number.isFinite) ? Math.max(...widths) + insets : undefined;
                return { insets, blocks: blocks[index], inputPreference };
              });
              pair.hasThroughDates = blocks.some(column => column.some(block => block.trailing > 0));
              const packed = pair.captionColumns.flatMap(({ insets, blocks, inputPreference }, index) => {
                const [block] = blocks;
                if (blocks.length !== 1) return [];
                const canPack = block.through ? block.top || block.widthAt && block.pack : block.pack && inputPreference !== undefined;
                return canPack ? [{ index, insets, block, inputPreference }] : [];
              });
              if (packed.length === 1) pair.packedDateColumn = packed[0];
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
        return bounds ? [{ ...block, width: bounds.width + insets + block.trailing }] : [];
      });
      return { minimum, insets, mixed: Math.max(minimum, ...dates.map(date => date.width + date.mixed)),
        side: Math.max(minimum, ...dates.map(date => date.width + date.side)) };
    });
    if (candidates.every(candidate => candidate.side <= candidate.minimum)) return;
    for (const level of ['side', 'mixed']) {
      const widths = candidates.map(candidate => candidate[level]);
      if (widths.reduce((sum, width) => sum + width, 0) <= available) return { widths };
    }
    const partial = partialCaptionFloors(pair.packedDateColumn, candidates, available);
    if (partial) return partial;
    // Before the side captions fit, share extra space in proportion to the minimum content widths.
    const widths = candidates.map(candidate => candidate.minimum);
    const packed = pair.packedDateColumn;
    const compactSpacing = packed?.block.through?.compactSpacing ?? 0;
    const weights = candidates.map(({ minimum, insets }, index) =>
      Math.max(0, minimum - insets - (index === packed?.index ? compactSpacing : 0)));
    const round = compactSpacing || packed?.block.transition?.widerValue ? Math.round : Math.floor;
    return { widths, allocated: spreadCaptionSurplus(widths, weights, available, 0, round) };
  }
  function allocateWidths(captions, minima) {
    allocateInputs(captions);
    const packedDates = new Map();
    for (const [owner, pair] of columnPairs) {
      if (!pair.groups) continue;
      const available = availableTrackWidth(pair.items, pair.groups.length, scale);
      const bounds = pair.groups.map(node => minima.get(node.key));
      const side = bounds.map((size, index) => Math.max(size?.width ?? pair.natural[index], size?.sideWidth ?? 0));
      // Keep the previous shared caption alignment when both columns fit side by side.
      const fitsSide = side.reduce((sum, width) => sum + width, 0) <= available + .5;
      const lanes = pair.groups.map((node, index) => {
        const size = bounds[index];
        const minimum = fitsSide ? side[index] : size?.width ?? pair.natural[index];
        const preferred = Math.max(minimum, pair.natural[index]);
        return { minimum, preferred, maximum: Math.max(preferred, size?.maximumWidth ?? Infinity),
          growthWeight: stretchWeight(node, 'x') };
      });
      // A complex pair can already expand inside the form's preferred width.
      // Shrink both columns from that allocation before using their individual floors.
      const natural = lanes.reduce((sum, lane) => sum + lane.preferred, 0);
      // The trailing controls are already included in a mixed column's natural width.
      const preferred = pair.hasThroughDates ? lanes.map(lane => lane.preferred)
        : allocateLaneSizes(Math.max(natural, pair.available), lanes);
      pair.preferred = preferred.reduce((sum, width) => sum + width, 0);
      let tracks = lanes.map((lane, index) => ({ ...lane, preferred: preferred[index] }));
      const floors = captionFloors(pair, tracks, minima, available);
      pair.minimumWidths = floors?.widths;
      if (floors) tracks = tracks.map((track, index) => ({ ...track, minimum: floors.widths[index] }));
      for (const [index, node] of pair.groups.entries()) columnBounds.set(elements.get(node.key), tracks[index]);
      const topColumns = !floors && available < pair.preferred
        ? pair.captionColumns?.flatMap(({ insets, blocks, inputPreference }, index) => blocks.flatMap(block =>
          block.compactWidth !== undefined && minima.get(block.key)?.width + insets + block.trailing === tracks[index].minimum
            ? [{ index, inputPreference, compactWidth: block.compactWidth + insets + block.trailing }] : []))
        : undefined;
      const top = topColumns?.length === 1 ? topColumns[0] : undefined;
      // Round the top-caption track before its sibling takes the remainder.
      let widths = floors?.allocated ?? (top?.index === 1
        ? allocateLaneSizes(available, [tracks[1], tracks[0]]).reverse()
        : pair.hasThroughDates ? roundTrackWidths(allocateLaneSizes(available, tracks, { fractional: true }))
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
      const packed = packedDateColumn(pair, tracks, available, widths, floors?.partial, minima);
      if (packed) {
        widths = packed.widths;
        packedDates.set(packed.key, { ...packed.plan, owner, manual: packed.manual });
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
    return packedDates;
  }
  function columnFraction(element) {
    const column = element.closest('.taxi-element[data-united-cell]');
    const bounds = columnBounds.get(column);
    return bounds ? fillFraction(borderBoxSize(column, scale).width, bounds) : 1;
  }
  return { owners, columnPairs, minimumCaptions, allocateWidths, capturePreferredColumns, columnFraction };
}
