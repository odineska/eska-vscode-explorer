import { fieldWidth, number, property, scalar } from './model.mjs';
import { stretches, stretchWeight } from './layout-model.mjs';

const pixels = value => parseFloat(value) || 0;
const total = values => values.reduce((sum, value) => sum + value, 0);

function ordinaryRow(node) {
  return node.kind === 'UsualGroup' && node.presentation.grouping === 'Horizontal'
    && typeof node.presentation.united === 'boolean'
    && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'))
    && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'))
    && scalar(node, 'HorizontalSpacing', 'Auto') === 'Auto'
    && number(node, 'Width') <= 0 && !property(node, 'BackColor');
}

function leadingField(entry) {
  if (entry.kind === 'field') return entry;
  if (entry.kind !== 'group' || scalar(entry.node, 'ThroughAlign', 'Auto') === 'DontUse') return;
  return leadingField(entry.children[0]);
}

function cells(entry) {
  if (entry.kind === 'field' || entry.node.presentation.united) return [entry];
  return [...(entry.title ? [entry.title] : []), ...entry.children.flatMap(cells)];
}

function intrinsic(entry, gap, labelWidth) {
  if (entry.kind === 'title') return entry.width;
  if (entry.kind === 'field') return (labelWidth ?? entry.labelWidth) + entry.labelGap + entry.controlWidth;
  const firstLabel = leadingField(entry) ? labelWidth : undefined;
  const children = entry.children.map((child, index) => intrinsic(child, gap, index === 0 ? firstLabel : undefined));
  return total(children) + gap * (children.length - 1);
}

/** Lay out the shared columns of horizontal groups without changing the Solid owners. */
export function alignUnitedColumns(model, elements, containers, os, collapsed, scale) {
  const scopes = [], undo = [];
  const mark = (element, attribute) => {
    element.setAttribute(attribute, '');
    undo.push(() => element.removeAttribute(attribute));
  };
  const style = (element, name, value) => {
    element.style.setProperty(name, `${value}px`);
    undo.push(() => element.style.removeProperty(name));
  };
  const visible = node => node.children.filter(child => elements.has(child.key));

  function entryFor(node) {
    const element = elements.get(node.key);
    if (node.kind === 'InputField' && node.presentation.titleLocation === 'Left') {
      const row = element.querySelector(':scope > .taxi-field-row'), label = row?.querySelector('.taxi-field-label');
      if (!label) return;
      return { kind: 'field', node, element, labelWidth: pixels(getComputedStyle(label).width),
        labelGap: pixels(getComputedStyle(row).columnGap), controlWidth: fieldWidth(node, os) };
    }
    if (!ordinaryRow(node)) return;
    const items = containers.get(node.key), group = items?.parentElement;
    if (!items) return;
    const children = visible(node).map(entryFor);
    if (!children.length || children.some(child => !child)) return;
    const titleElement = group.querySelector(':scope > .taxi-group-title');
    if (!titleElement) return { kind: 'group', node, element, items, group, children };
    // The title of an exposed group occupies a column before its elements.
    if (node.presentation.united) return;
    const range = document.createRange();
    range.selectNodeContents(titleElement);
    const title = { kind: 'title', element: titleElement, width: range.getBoundingClientRect().width / scale };
    return { kind: 'group', node, element, items, group, children, title };
  }

  function visit(node) {
    const children = visible(node), items = containers.get(node.key);
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
    style(entry.element, '--taxi-united-cell-width', width);
  }
  function setLane(entry, gap) {
    mark(entry.items, 'data-united-horizontal-lane');
    style(entry.items, '--taxi-united-cell-gap', gap);
  }
  function placeCell(entry, width, labelWidth, gap) {
    setCell(entry, width);
    if (entry.kind === 'field') {
      style(entry.element, '--taxi-united-cell-label-width', labelWidth ?? entry.labelWidth);
      return;
    }
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
    if (entry.kind === 'field' || entry.node.presentation.united) {
      const track = tracks[first];
      placeCell(entry, track.width, track.labelWidth, gap);
      return first + 1;
    }
    setLane(entry, gap);
    let last = first;
    if (entry.title) {
      mark(entry.group, 'data-united-horizontal-title');
      style(entry.group, '--taxi-united-cell-gap', gap);
      style(entry.title.element, '--taxi-united-title-width', tracks[last++].width);
    }
    for (const child of entry.children) last = placeLane(child, last, tracks, gap);
    setCell(entry, total(tracks.slice(first, last).map(track => track.width)) + gap * (last - first - 1));
    return last;
  }

  for (const {lanes, gap} of scopes) {
    const rows = lanes.map(cells), count = Math.max(...rows.map(row => row.length));
    const tracks = Array.from({length: count}, (_, index) => {
      const items = rows.map(row => row[index]).filter(Boolean);
      const labelWidth = Math.max(...items.map(entry => leadingField(entry)?.labelWidth ?? 0));
      const width = Math.max(...items.map(entry => intrinsic(entry, gap, labelWidth)));
      return { width, labelWidth };
    });
    for (const lane of lanes) placeLane(lane, 0, tracks, gap);
  }
  return () => { for (const restore of undo) restore(); };
}
