import { flag, scalar } from './model.mjs';

export function independentVerticalSection(node) {
  return node.kind === 'UsualGroup' && scalar(node, 'Representation') === 'NormalSeparation'
    && scalar(node, 'Group') === 'Vertical' && !flag(node, 'United');
}

/** Native separation is a boundary requirement, shared by both adjacent items. */
export function groupSeparationEdges(node, children, horizontal, padding = {}) {
  const empty = { x: [0, 0], y: [0, 0] };
  if (node.kind !== 'UsualGroup') return empty;
  const normal = scalar(node, 'Representation') === 'NormalSeparation';
  return Object.fromEntries(['x', 'y'].map(axis => {
    const edges = children.map(child => child[axis]);
    const inherited = !edges.length ? [0, 0] : horizontal === (axis === 'x')
      ? [edges[0][0], edges.at(-1)[1]]
      : [Math.max(...edges.map(edge => edge[0])), Math.max(...edges.map(edge => edge[1]))];
    const unit = axis === 'x' ? 10 : 8;
    const separated = normal && !(axis === 'y' && independentVerticalSection(node));
    return [axis, inherited.map((value, side) => Math.max(value, separated ? unit - (padding[axis]?.[side] ?? 0) : 0))];
  }));
}

/** Spacing properties use the native interval; input flow reserves two vertical border pixels. */
export function groupSpacingInterval(node, axis) {
  const mode = scalar(node, axis === 'x' ? 'HorizontalSpacing' : 'VerticalSpacing', 'Auto');
  const unit = axis === 'x' ? 10 : 9;
  return { None: 0, Half: Math.ceil(unit / 2), Single: unit, Double: 2 * unit }[mode];
}

/** A conditional row keeps its native horizontal gap while stacked. */
export function horizontalGroupGap(node, children) {
  return groupSpacingInterval(node, 'x') ?? (children.some(child =>
    ['UsualGroup', 'InputField', 'RadioButtonField', 'LabelDecoration', 'LabelField'].includes(child.kind)) ? 10 : undefined);
}
