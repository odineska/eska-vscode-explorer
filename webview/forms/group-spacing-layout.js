import { groupSeparationEdges, groupSpacingInterval, independentVerticalSection } from './group-spacing.mjs';
import { borderBoxSize, pixels } from './layout-box.mjs';

const spacingProperty = axis => `--taxi-group-spacing-${axis}`;
export const groupSpacingAmount = (element, axis) => pixels(element.style.getPropertyValue(spacingProperty(axis)));

export function setGroupSpacing(element, axis, amount, alignment) {
  const previous = groupSpacingAmount(element, axis);
  if (previous === amount) return;
  const margin = axis === 'x' ? 'margin-left' : 'margin-top';
  const baseline = pixels(getComputedStyle(element).getPropertyValue(margin)) - previous;
  alignment.style(element, spacingProperty(axis), `${amount}px`);
  alignment.style(element, margin, `${baseline + amount}px`);
}

function reservePaintedInsets(edge, axis, trailing, targets, alignment) {
  const property = axis === 'x' ? (trailing ? 'padding-right' : 'padding-left')
    : (trailing ? 'padding-bottom' : 'padding-top');
  for (const { key, distance } of edge.insets) {
    const items = targets.containers.get(key);
    const original = pixels(getComputedStyle(items).getPropertyValue(property));
    alignment.style(items, property, `${original + distance}px`);
  }
}

function shareSectionInset(children, targets, alignment) {
  const sections = new Map(children.filter(independentVerticalSection).map(child => {
    const group = targets.containers.get(child.key)?.parentElement;
    return [child.key, group ? pixels(getComputedStyle(group).paddingLeft) : 0];
  }));
  const inset = Math.max(0, ...sections.values());
  if (!inset) return;
  // Independent sections expose their leading content track to the surrounding column.
  for (const child of children) {
    if (sections.has(child.key) || child.kind?.endsWith('Field')) {
      setGroupSpacing(targets.elements.get(child.key), 'x', inset - (sections.get(child.key) ?? 0), alignment);
    }
  }
}

function alignPaintedRow(children, targets, alignment, scale) {
  if (children.length < 2 || !children.every(child => child.kind === 'UsualGroup'
      && child.presentation?.grouping === 'Vertical' && child.presentation.united)) return;
  const groups = children.map(child => targets.containers.get(child.key)?.parentElement);
  if (groups.some(group => !group)) return;
  const sizes = groups.map(group => {
    const { paddingTop, paddingBottom } = getComputedStyle(group);
    const top = pixels(paddingTop), bottom = pixels(paddingBottom);
    return { top, bottom, content: borderBoxSize(group, scale).height - top - bottom };
  });
  if (sizes.some(size => size.top !== size.bottom || size.content !== sizes[0].content)
      || sizes.every(size => size.top === sizes[0].top)) return;
  // Equal-height content aligns across the painted insets of an ordinary row.
  for (const child of children) alignment.style(targets.elements.get(child.key), 'align-self', 'center');
}

/** Project separation through nested groups before measuring preferred and minimum sizes. */
export function layoutGroupSpacing(model, { targets, alignment, os, scale }) {
  if (os !== 'linux') return;
  function visit(node) {
    // Pages have an Items container but no ordinary element wrapper.
    const logicalEdges = new Map(node.children.map(child => [child.key, visit(child)]));
    const children = targets.children(node), edges = children.map(child => logicalEdges.get(child.key));
    const items = targets.containers.get(node.key);
    const horizontal = items?.classList.contains('taxi-items--horizontal') ?? false;
    const group = items?.parentElement, padding = group && getComputedStyle(group);
    const insets = padding ? { x: [pixels(padding.paddingLeft), pixels(padding.paddingRight)],
      y: [pixels(padding.paddingTop), pixels(padding.paddingBottom)] } : {};
    if (items) {
      const axis = horizontal ? 'x' : 'y', interval = horizontal ? undefined : groupSpacingInterval(node, 'y');
      if (interval !== undefined) {
        alignment.style(items, 'row-gap', `${Math.max(0, interval - 2)}px`);
      }
      for (let index = 1; index < children.length; index++) {
        const previous = edges[index - 1][axis][1], next = edges[index][axis][0];
        reservePaintedInsets(previous, axis, true, targets, alignment);
        if (!previous.distance) reservePaintedInsets(next, axis, false, targets, alignment);
        // The earlier section owns the shared outside interval when it requests one.
        const separation = previous.distance || next.distance;
        const adjustment = axis === 'y' && interval === 0 ? -2 : 0;
        setGroupSpacing(targets.elements.get(children[index].key), axis, separation + adjustment, alignment);
      }
      if (horizontal) alignPaintedRow(children, targets, alignment, scale);
      else shareSectionInset(children, targets, alignment);
    }
    const painted = group?.classList.contains('taxi-group--painted') ?? false;
    return groupSeparationEdges(node, edges, horizontal, insets, painted);
  }
  visit(model);
}

/** Exposed United rows use the largest boundary in any participating column. */
export function shareUnitedGroupSpacing(lanes, alignment) {
  const cells = [], boundaries = new Map();
  function collect(entry, track, inherited = 0) {
    const before = inherited + groupSpacingAmount(entry.element, 'y');
    if (!entry.children?.length) {
      cells.push({ element: entry.element, track });
      boundaries.set(track, Math.max(boundaries.get(track) ?? -Infinity, before));
      return;
    }
    setGroupSpacing(entry.element, 'y', 0, alignment);
    if (entry.title) {
      cells.push({ element: entry.title, track });
      boundaries.set(track, Math.max(boundaries.get(track) ?? -Infinity, before));
      track++;
    }
    for (const [index, child] of entry.children.entries()) {
      collect(child, track, index === 0 && !entry.title ? before : 0);
      track += child.rows;
    }
  }
  for (const lane of lanes) collect(lane, 0);
  for (const { element, track } of cells) setGroupSpacing(element, 'y', boundaries.get(track), alignment);
}
