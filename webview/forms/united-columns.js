import { fieldWidth, number, property, scalar } from './model.mjs';
import { stretches, stretchWeight, ordinaryGroup, automaticHorizontalSpacing, controlBounds, horizontalInputMaximum, laneInputBounds } from './layout-model.mjs';
import { borderBoxSize, pixels, textWidth } from './layout-box.mjs';

const total = values => values.reduce((sum, value) => sum + value, 0);

function ordinaryRow(node) {
  return ordinaryGroup(node) && node.presentation.grouping === 'Horizontal'
    && typeof node.presentation.united === 'boolean'
    && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'))
    && automaticHorizontalSpacing(node)
    && number(node, 'Width') <= 0 && !property(node, 'BackColor');
}

function leadingField(entry) {
  if (entry.kind === 'field') return entry;
  if (entry.kind !== 'group' || scalar(entry.node, 'ThroughAlign', 'Auto') === 'DontUse') return;
  return leadingField(entry.children[0]);
}

function cells(entry) {
  if (entry.kind !== 'group' || entry.node.presentation.united) return [entry];
  return [...(entry.title ? [entry.title] : []), ...entry.children.flatMap(cells)];
}

function intrinsic(entry, gap, labelWidth) {
  if (entry.kind === 'field') return (labelWidth ?? entry.labelWidth) + entry.labelGap + entry.controlWidth;
  if (entry.kind !== 'group') return entry.width;
  const firstLabel = leadingField(entry) ? labelWidth : undefined;
  const children = entry.children.map((child, index) => intrinsic(child, gap, index === 0 ? firstLabel : undefined));
  return total(children) + gap * (children.length - 1);
}

/** Lay out the shared columns of horizontal groups without changing the Solid owners. */
export function alignUnitedColumns(model, { targets, alignment, os, collapsed, scale }) {
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const scopes = [];

  function entryFor(node) {
    const element = elements.get(node.key);
    if (node.kind === 'InputField' && node.presentation.titleLocation === 'Left') {
      const row = element.querySelector(':scope > .taxi-field-row'), label = row?.querySelector('.taxi-field-label');
      if (!label) return;
      return { kind: 'field', node, element, labelWidth: pixels(getComputedStyle(label).width),
        labelGap: pixels(getComputedStyle(row).columnGap), controlWidth: fieldWidth(node, os) };
    }
    if (os === 'linux' && node.presentation.titleLocation === 'None' && ['LabelField', 'PictureField'].includes(node.kind)) {
      const control = element.querySelector(':scope > .taxi-field-row > .taxi-field-control')?.firstElementChild;
      if (control) return { kind: 'control', node, element, width: borderBoxSize(control, scale).width };
    }
    if (!ordinaryRow(node)) return;
    const items = containers.get(node.key), group = items?.parentElement;
    if (!items) return;
    const children = mountedChildren(node).map(entryFor);
    if (!children.length || children.some(child => !child)) return;
    const titleElement = group.querySelector(':scope > .taxi-group-title');
    if (!titleElement) return { kind: 'group', node, element, items, group, children };
    // The title of an exposed group occupies a column before its elements.
    if (node.presentation.united) return;
    const title = { kind: 'title', element: titleElement, width: textWidth(titleElement, scale) };
    return { kind: 'group', node, element, items, group, children, title };
  }

  function visit(node) {
    const children = mountedChildren(node), items = containers.get(node.key);
    if (items && node.presentation.grouping === 'Vertical' && children.length > 1 && children.every(ordinaryRow)) {
      const lanes = children.map(entryFor);
      if (lanes.every(Boolean)) {
        // The native gap between fields on this axis also separates the logical tracks.
        const gap = os === 'linux' ? 11 : pixels(getComputedStyle(lanes[0].items).columnGap);
        scopes.push({ lanes, gap });
      }
    }
    for (const child of children) visit(child);
  }
  visit(model);

  function setCell(entry, width) {
    mark(entry.element, 'data-united-horizontal-cell');
    style(entry.element, '--taxi-united-cell-width', `${width}px`);
  }
  function setLane(entry, gap) {
    mark(entry.items, 'data-united-horizontal-lane');
    style(entry.items, '--taxi-united-cell-gap', `${gap}px`);
  }
  function mixedCell(entry, labelWidth) {
    const value = entry.kind === 'field' ? entry.controlWidth : entry.width;
    const reserve = intrinsic(entry, 0, labelWidth) - value;
    if (!stretches(entry.node, 'x', collapsed)) {
      const width = reserve + value;
      return { width, minimum: width, maximum: width, growth: 0 };
    }
    const bounds = controlBounds(entry.node, 'x', value, os);
    const maximum = horizontalInputMaximum(entry.node, os) ?? bounds.maximum ?? Infinity;
    const preferred = Math.min(value, maximum);
    const minimum = laneInputBounds(entry.node, os)?.narrowMinimum
      ?? bounds.minimum ?? (entry.node.kind === 'LabelField' ? 60 : 80);
    return { width: reserve + preferred, minimum: reserve + Math.min(preferred, minimum),
      maximum: reserve + maximum, growth: preferred };
  }

  function mixedTracks(lanes) {
    const count = Math.max(0, ...lanes.map(lane => lane.children.length));
    return Array.from({length: count}, (_, index) => {
      const entries = lanes.flatMap(lane => lane.children[index] ?? []);
      const labelWidth = Math.max(...entries.map(entry => entry.labelWidth ?? 0));
      const sizes = entries.map(entry => mixedCell(entry, labelWidth));
      const widest = name => Math.max(...sizes.map(size => size[name]));
      return { labelWidth, width: widest('width'), minimum: widest('minimum'),
        maximum: widest('maximum'), growth: widest('growth') };
    });
  }

  function placeMixedRows(lanes) {
    const shared = mixedTracks(lanes.filter(lane => !lane.node.presentation.united));
    for (const lane of lanes) {
      const tracks = lane.node.presentation.united ? mixedTracks([lane]) : shared;
      mark(lane.items, 'data-united-flex-lane');
      setLane(lane, 10);
      for (const [index, entry] of lane.children.entries()) {
        const {width, minimum, maximum, growth, labelWidth} = tracks[index];
        setCell(entry, width);
        if (entry.kind === 'field') style(entry.element, '--taxi-united-cell-label-width', labelWidth + 'px');
        style(entry.element, '--taxi-united-cell-min-width', minimum + 'px');
        style(entry.element, '--taxi-united-cell-max-width', Number.isFinite(maximum) ? maximum + 'px' : 'none');
        // Flexbox distributes each deficit by shrink factor times basis.
        const shrink = width > 0 ? (width - minimum) / width : 0;
        style(entry.element, '--taxi-united-cell-flex', [growth, shrink, width + 'px'].join(' '));
      }
    }
  }

  function placeCell(entry, width, labelWidth, gap) {
    setCell(entry, width);
    if (entry.kind === 'field') {
      style(entry.element, '--taxi-united-cell-label-width', `${labelWidth ?? entry.labelWidth}px`);
      return;
    }
    if (entry.kind !== 'group') return;
    setLane(entry, gap);
    const firstLabel = leadingField(entry) ? labelWidth : undefined;
    const widths = entry.children.map((child, index) => intrinsic(child, gap, index === 0 ? firstLabel : undefined));
    const weights = entry.children.map(child => stretches(child.node, 'x', collapsed) ? stretchWeight(child.node, 'x') : 0);
    const weight = total(weights);
    const spare = Math.max(0, width - total(widths) - gap * (widths.length - 1));
    let consumed = 0, assigned = 0;
    for (const [index, child] of entry.children.entries()) {
      consumed += weights[index];
      const target = weight ? Math.round(spare * consumed / weight) : 0;
      placeCell(child, widths[index] + target - assigned, index === 0 ? firstLabel : undefined, gap);
      assigned = target;
    }
  }
  function placeLane(entry, first, tracks, gap) {
    if (entry.kind !== 'group' || entry.node.presentation.united) {
      const track = tracks[first];
      placeCell(entry, track.width, track.labelWidth, gap);
      return first + 1;
    }
    setLane(entry, gap);
    let last = first;
    if (entry.title) {
      mark(entry.group, 'data-united-horizontal-title');
      style(entry.group, '--taxi-united-cell-gap', `${gap}px`);
      style(entry.title.element, '--taxi-united-title-width', `${tracks[last++].width}px`);
    }
    for (const child of entry.children) last = placeLane(child, last, tracks, gap);
    setCell(entry, total(tracks.slice(first, last).map(track => track.width)) + gap * (last - first - 1));
    return last;
  }

  for (const {lanes, gap} of scopes) {
    if (lanes.every(lane => !lane.title && lane.children.every(entry => entry.kind !== 'group'))
      && lanes.some(lane => lane.children.some(entry => entry.kind === 'control'))) {
      placeMixedRows(lanes);
      continue;
    }
    const rows = lanes.map(cells), count = Math.max(...rows.map(row => row.length));
    const tracks = Array.from({length: count}, (_, index) => {
      const items = rows.map(row => row[index]).filter(Boolean);
      const labelWidth = Math.max(...items.map(entry => leadingField(entry)?.labelWidth ?? 0));
      const width = Math.max(...items.map(entry => intrinsic(entry, gap, labelWidth)));
      return { width, labelWidth };
    });
    for (const lane of lanes) placeLane(lane, 0, tracks, gap);
  }
}
