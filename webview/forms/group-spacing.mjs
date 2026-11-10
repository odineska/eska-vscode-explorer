import { flag, property, scalar } from './model.mjs';

export function independentVerticalSection(node) {
  const representation = scalar(node, 'Representation', 'Auto');
  return node.kind === 'UsualGroup' && scalar(node, 'Group') === 'Vertical' && !flag(node, 'United')
    && (representation === 'NormalSeparation' || representation === 'Auto' && !property(node, 'BackColor'));
}

const empty = { distance: 0, insets: [] };

function transverseEdge(edges, side) {
  return {
    distance: Math.max(0, ...edges.map(edge => edge[side].distance)),
    insets: edges.flatMap(edge => edge[side].insets),
  };
}

/** Carry boundary requests through transparent groups until a neighboring item consumes them. */
export function groupSeparationEdges(node, children, horizontal, padding = {}, painted = false) {
  if (node.kind !== 'UsualGroup' && node.kind !== 'Form') return { x: [empty, empty], y: [empty, empty] };
  const representation = scalar(node, 'Representation', 'None');
  const normal = representation === 'NormalSeparation';
  return Object.fromEntries(['x', 'y'].map(axis => {
    const edges = children.map(child => child[axis]);
    const inherited = !edges.length ? [empty, empty] : horizontal === (axis === 'x')
      ? [edges[0][0], edges.at(-1)[1]]
      : [transverseEdge(edges, 0), transverseEdge(edges, 1)];
    const unit = axis === 'x' ? 10 : 8;
    const separated = normal && !(axis === 'y' && independentVerticalSection(node));
    return [axis, inherited.map(({ distance, insets }, side) => {
      if (painted && representation === 'None' && distance > 0) {
        return { distance: 0, insets: [...insets, { key: node.key, distance }] };
      }
      const own = separated ? unit - (padding[axis]?.[side] ?? 0) : 0;
      // A represented section supplies the common edge for its exposed descendants.
      return own > 0 ? { distance: own, insets: [] } : { distance, insets };
    })];
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
