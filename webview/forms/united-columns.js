import { fieldWidth, inputPaintedOutset, number, property, scalar } from './model.mjs';
import { stretches, stretchWeight, ordinaryGroup, automaticHorizontalSpacing, horizontalInputMaximum, sharesGroupLabels } from './layout-model.mjs';
import { borderBoxSize, pixels, textWidth } from './layout-box.mjs';
import { mixedColumnLayout } from './mixed-column-layout.js';

const total = values => values.reduce((sum, value) => sum + value, 0);

function ordinaryRow(node) {
  return ordinaryGroup(node) && (node.presentation.grouping === 'Horizontal'
      || node.presentation.grouping === 'HorizontalIfPossible' && node.presentation.united === false
        && node.children.every(child => child.kind === 'CommandBar'))
    && typeof node.presentation.united === 'boolean'
    && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'))
    && automaticHorizontalSpacing(node)
    && number(node, 'Width') <= 0 && !property(node, 'BackColor');
}

function leadingField(entry) {
  if (entry.kind === 'field') return entry.location === 'Left' ? entry : undefined;
  if (entry.kind !== 'group' || !sharesGroupLabels(entry.node)) return;
  return leadingField(entry.children[0]);
}

function hasUnlabeledCheckbox(entry) {
  return entry.node.kind === 'CheckBoxField' && entry.node.presentation.titleLocation === 'None'
    || (entry.children ?? []).some(hasUnlabeledCheckbox);
}

function cells(entry) {
  if (entry.kind !== 'group' || entry.node.presentation.united) return [entry];
  return [...(entry.title ? [entry.title] : []), ...entry.children.flatMap(cells)];
}

function intrinsic(entry, gap, labelWidth) {
  if (entry.kind === 'field') {
    return entry.location === 'Top' ? Math.max(entry.controlWidth, entry.labelWidth)
      : (labelWidth ?? entry.labelWidth) + entry.labelGap + entry.controlWidth;
  }
  if (entry.kind !== 'group') return entry.width;
  const firstLabel = leadingField(entry) ? labelWidth : undefined;
  const children = entry.children.map((child, index) => intrinsic(child, gap, index === 0 ? firstLabel : undefined));
  return total(children) + gap * (children.length - 1);
}

/** Lay out the shared columns of horizontal groups without changing the Solid owners. */
export function alignUnitedColumns(model, context) {
  const { targets, alignment, os, collapsed, scale } = context;
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const scopes = [], mixed = mixedColumnLayout(context);

  function entryFor(node, mixedRow = false, commandColumns = false) {
    const element = elements.get(node.key), location = node.presentation.titleLocation;
    const choice = ['RadioButtonField', 'CheckBoxField'].includes(node.kind);
    if ((node.kind === 'InputField' || choice) && (location === 'Left' || mixedRow && location === 'Top')) {
      const row = element.querySelector(':scope > .taxi-field-row'), label = row?.querySelector('.taxi-field-label');
      if (!label) return;
      const labelWidth = location === 'Left' ? pixels(getComputedStyle(label).width) : Math.round(textWidth(label, scale));
      const surface = row.querySelector(':scope > .taxi-field-control'), control = surface?.firstElementChild;
      if (choice && !control) return;
      const tooltip = surface?.querySelector(':scope > .taxi-field-tooltip');
      const accessoryWidth = tooltip ? borderBoxSize(tooltip, scale).width + pixels(getComputedStyle(surface).columnGap) : 0;
      return { kind: 'field', node, element, row, location, labelWidth,
        labelGap: pixels(getComputedStyle(row).columnGap),
        controlWidth: (choice ? borderBoxSize(control, scale).width
          : Math.min(fieldWidth(node, os), horizontalInputMaximum(node, os) ?? Infinity) + inputPaintedOutset(node, os)) + accessoryWidth };
    }
    if (os === 'linux' && commandColumns && node.kind === 'CommandBar') {
      const bar = element.querySelector(':scope > .taxi-command-bar');
      if (bar) return { kind: 'command', node, element, width: borderBoxSize(bar, scale).width };
    }
    if (os === 'linux' && location === 'None' && (node.kind === 'CheckBoxField' || commandColumns && node.kind === 'InputField')) {
      const surface = element.querySelector(':scope > .taxi-field-row > .taxi-field-control');
      const control = node.kind === 'CheckBoxField' ? surface : surface?.firstElementChild;
      if (control) return { kind: 'input', node, element, width: borderBoxSize(control, scale).width };
    }
    if (os === 'linux' && node.presentation.titleLocation === 'None' && ['LabelField', 'PictureField'].includes(node.kind)) {
      const control = element.querySelector(':scope > .taxi-field-row > .taxi-field-control')?.firstElementChild;
      if (control) return { kind: 'control', node, element, width: borderBoxSize(control, scale).width };
    }
    if (!ordinaryRow(node)) return;
    const items = containers.get(node.key), group = items?.parentElement;
    if (!items) return;
    const nodes = mountedChildren(node);
    const mixed = os === 'linux' && nodes.some(child => ['LabelField', 'PictureField'].includes(child.kind));
    const children = nodes.map(child => entryFor(child, mixed, commandColumns));
    if (!children.length || children.some(child => !child)) return;
    const titleElement = group.querySelector(':scope > .taxi-group-title');
    if (!titleElement) return { kind: 'group', node, element, items, group, children };
    // The title of an exposed group occupies a column before its elements.
    if (node.presentation.united) return;
    const title = { kind: 'title', element: titleElement, width: textWidth(titleElement, scale) };
    return { kind: 'group', node, element, items, group, children, title };
  }

  function exposedStack(node) {
    return ordinaryGroup(node) && node.presentation.grouping === 'Vertical' && node.presentation.united === false
      && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'))
      && number(node, 'Width') <= 0 && !property(node, 'BackColor')
      && !containers.get(node.key)?.parentElement.querySelector(':scope > .taxi-group-title');
  }

  function columnNodes(node, exposed) {
    return mountedChildren(node).flatMap(child => {
      if (!exposedStack(child)) return [child];
      exposed.push(child.key);
      return columnNodes(child, exposed);
    });
  }

  function fixedLane(entry) {
    return entry.kind === 'group' ? entry.children.every(fixedLane) : !stretches(entry.node, 'x', collapsed);
  }

  function lanesFor(node, exposed) {
    const nodes = columnNodes(node, exposed);
    const commandColumns = nodes.some(child => ordinaryRow(child) && !child.presentation.united
      && mountedChildren(child).some(item => item.kind === 'CommandBar'));
    return nodes.map(child => entryFor(child, false, commandColumns));
  }

  const covered = new Set();
  function registerColumns(node) {
    const items = containers.get(node.key);
    if (!items || node.presentation.grouping !== 'Vertical' || covered.has(node.key)) return;
    const exposed = [], lanes = lanesFor(node, exposed);
    if (lanes.length < 2 || lanes.some(lane => !lane)) return;
    const rowsOnly = lanes.every(lane => lane.kind === 'group');
    const exposedRow = lanes.some(lane => lane.kind === 'group' && !lane.node.presentation.united);
    // Combined rows with flexible inputs keep the existing adaptive caption layout.
    const mixedTracks = lanes.some(lane => lane.kind === 'group' && lane.children.length > 1)
      && (exposedRow || lanes.every(fixedLane));
    if (!rowsOnly && !mixedTracks) return;
    // Uncombined vertical groups continue the same column scope; united ones own a new scope.
    for (const key of exposed) covered.add(key);
    const firstGroup = lanes.find(lane => lane.kind === 'group');
    // Input tracks already include their painted border; spacing starts at that edge.
    const gap = os === 'linux' ? 10 : pixels(getComputedStyle(firstGroup.items).columnGap);
    scopes.push({ node, items, lanes, gap, preserveAlignment: !rowsOnly || lanes.some(hasUnlabeledCheckbox) });
  }
  function visit(node) {
    registerColumns(node);
    // Page panels own an Items container without an element wrapper.
    for (const child of node.children) visit(child);
  }
  visit(model);

  function setCell(entry, width) {
    mark(entry.element, 'data-united-horizontal-cell');
    style(entry.element, '--taxi-united-cell-width', `${width}px`);
  }
  function setLane(entry, gap) {
    mark(entry.items, 'data-united-horizontal-lane');
    style(entry.items, '--taxi-united-cell-gap', `${gap}px`);
    style(entry.items, '--taxi-united-lane-align', entry.itemAlignment ?? 'start');
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
    const css = getComputedStyle(entry.items);
    const margins = pixels(css.marginLeft) + pixels(css.marginRight);
    setCell(entry, total(tracks.slice(first, last).map(track => track.width)) + gap * (last - first - 1) + margins);
    return last;
  }

  const columns = [];
  for (const scope of scopes) {
    const {node, items, lanes} = scope;
    if (lanes.every(lane => lane.kind === 'group' && !lane.title && lane.children.every(entry => entry.kind !== 'group'))
      && lanes.some(lane => lane.children.some(entry => entry.kind === 'control'))) {
      mixed.register(node, items, lanes, setCell, setLane);
    } else columns.push(scope);
  }

  function captureCaption(entry) {
    if (entry.kind === 'field' && entry.location === 'Left') {
      const width = parseFloat(getComputedStyle(entry.row).gridTemplateColumns);
      if (Number.isFinite(width)) entry.labelWidth = width;
    }
    for (const child of entry.children ?? []) captureCaption(child);
  }

  function alignColumns() {
    // Through-align may contribute a caption from a different vertical branch.
    for (const {lanes, gap, preserveAlignment} of columns) {
      for (const lane of lanes) {
        captureCaption(lane);
        if (preserveAlignment && lane.kind === 'group') lane.itemAlignment = getComputedStyle(lane.items).alignItems;
      }
      const rows = lanes.map(cells), count = Math.max(...rows.map(row => row.length));
      const tracks = Array.from({length: count}, (_, index) => {
        const items = rows.map(row => row[index]).filter(Boolean);
        const labelWidth = Math.max(...items.map(entry => leadingField(entry)?.labelWidth ?? 0));
        const width = Math.max(...items.map(entry => intrinsic(entry, gap, labelWidth)));
        return { width, labelWidth };
      });
      // Standalone fields already use their vertical grid and remain free to resize.
      for (const lane of lanes) if (lane.kind === 'group') placeLane(lane, 0, tracks, gap);
    }
  }
  return { ...mixed, alignColumns };
}
