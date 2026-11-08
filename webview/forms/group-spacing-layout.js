import { groupSeparationEdges, groupSpacingInterval } from './group-spacing.mjs';
import { pixels } from './layout-box.mjs';

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

/** Project separation through nested groups before measuring preferred and minimum sizes. */
export function layoutGroupSpacing(model, { targets, alignment, os }) {
  if (os !== 'linux') return;
  function visit(node) {
    const children = targets.children(node), edges = children.map(visit);
    const items = targets.containers.get(node.key);
    const horizontal = items?.classList.contains('taxi-items--horizontal') ?? false;
    const group = items?.parentElement, padding = group && getComputedStyle(group);
    const insets = padding ? { x: [pixels(padding.paddingLeft), pixels(padding.paddingRight)],
      y: [pixels(padding.paddingTop), pixels(padding.paddingBottom)] } : {};
    if (items) {
      const axis = horizontal ? 'x' : 'y', interval = groupSpacingInterval(node, axis);
      if (horizontal) {
        if (interval !== undefined || children.some(child => ['UsualGroup', 'InputField', 'RadioButtonField'].includes(child.kind))) {
          alignment.style(items, '--taxi-horizontal-gap', `${interval ?? 10}px`);
        }
      } else if (interval !== undefined) {
        alignment.style(items, 'row-gap', `${Math.max(0, interval - 2)}px`);
      }
      for (let index = 1; index < children.length; index++) {
        const separation = Math.max(edges[index - 1][axis][1], edges[index][axis][0]);
        const adjustment = axis === 'y' && interval === 0 ? -2 : 0;
        setGroupSpacing(targets.elements.get(children[index].key), axis, separation + adjustment, alignment);
      }
    }
    return groupSeparationEdges(node, edges, horizontal, insets);
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
