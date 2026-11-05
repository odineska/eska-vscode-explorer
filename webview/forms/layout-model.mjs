import { number, scalar, flag, fieldWidth, inputHeight } from './model.mjs';

const containers = new Set(['Form', 'UsualGroup', 'Page', 'Pages', 'ColumnGroup']);
const surfaces = new Set(['Table', 'ChartField', 'DendrogramField', 'GanttChartField', 'PlannerField',
  'SpreadSheetDocumentField', 'TextDocumentField', 'FormattedDocumentField', 'HTMLDocumentField',
  'PDFDocumentField', 'GeographicalSchemaField', 'GraphicalSchemaField', 'PictureField']);
const positive = value => Number.isFinite(value) && value > 0 ? value : 0;

/** Designer's Auto belongs to the widget/type; group Auto inherits its visible descendants. */
export function stretches(node, axis, collapsed = {}) {
  const value = scalar(node, axis === 'x' ? 'HorizontalStretch' : 'VerticalStretch', 'Auto');
  if (['true', 'Yes', '1'].includes(value)) return true;
  if (['false', 'No', '0'].includes(value)) return false;
  if (containers.has(node.kind)) {
    if (axis === 'y' && collapsed[node.key]) return false;
    return node.children.some(child => child.presentation.displayed && stretches(child, axis, collapsed));
  }
  if (surfaces.has(node.kind)) return true;
  if (axis === 'x') return ['InputField', 'LabelField'].includes(node.kind)
    && ['string', 'reference'].includes(node.presentation.valueType?.kind);
  return ['InputField', 'LabelField'].includes(node.kind) && number(node, 'Height') > 1;
}

/** An explicit dimension of a stretchable item is its proportional allocation weight. */
export function stretchWeight(node, axis) { return positive(number(node, axis === 'x' ? 'Width' : 'Height')) || 1; }

/** Pixel bounds apply to the control area; titles and auxiliary bars are allocated separately. */
export function controlBounds(node, axis, preferred, os) {
  const dimension = axis === 'x' ? 'Width' : 'Height';
  const explicit = number(node, dimension), stretch = stretches(node, axis);
  // With an explicit fixed size, Designer ignores maximum-size properties.
  if (explicit > 0 && !stretch) return {};
  const unit = axis === 'x' ? os === 'linux' ? 10 : 8 : node.kind === 'InputField' ? 20 : os === 'linux' ? 25 : 20;
  // 8.3.27 calculates minima itself; unknown MinWidth/MinHeight XML must not become invented properties.
  const minimum = node.kind === 'InputField' ? axis === 'x' ? Math.min(80, fieldWidth(node, os))
    : flag(node, 'MultiLine', false) ? 40 : inputHeight(node, os) : 0;
  let maximum;
  if (explicit <= 0) {
    const auto = scalar(node, `AutoMax${dimension}`, 'Auto');
    if (['false', 'No', '0'].includes(auto)) maximum = positive(number(node, `Max${dimension}`)) * unit || undefined;
    else if (axis === 'x' && node.kind === 'InputField' && (['true', 'Yes', '1'].includes(auto)
      || !['true', 'Yes', '1'].includes(scalar(node, 'HorizontalStretch', 'Auto'))
        && ['string', 'reference'].includes(node.presentation.valueType.kind))) {
      const type = node.presentation.valueType, pixels = Math.round((node.presentation.font?.points ?? 10) * 4 / 3);
      const automatic = type.kind === 'string' && !type.length ? Math.round((pixels - 1) * 100 / 3 + 10) : fieldWidth(node, os);
      maximum = Math.max(preferred || 0, automatic);
    }
  }
  return { minimum: minimum || undefined, maximum: maximum ? Math.max(minimum, maximum) : undefined };
}

/** Convert actual CSS allocation into unzoomed frame bounds, retaining scrolling below minimum size. */
export function formAllocation(viewport, preferred, minimum, zoom = 100) {
  const scale = Math.max(.01, positive(zoom) / 100 || 1);
  const axis = name => Math.max(positive(minimum[name]),
    viewport[name] > 0 ? Math.max(0, viewport[name] / scale - 8) : positive(preferred[name]));
  return { width: axis('width'), height: axis('height') };
}

/** Native Designer keeps the measured reference size before applying manual resize bounds. */
export function atPreferredAxis(outerSize, preferredSize, zoom = 100) {
  const scale = positive(zoom) / 100 || 1;
  return preferredSize > 0 && Math.abs(outerSize / scale - 8 - preferredSize) <= .51 / scale;
}

/** Explicit group dimensions provide an initial constraint; child natural minima still take precedence. */
export function groupPreferredSize(node, os) {
  if (!containers.has(node.kind) || node.kind === 'Form') return {};
  return { width: positive(number(node,'Width')) * (os === 'linux' ? 10 : 8),
    height: positive(number(node,'Height')) * (os === 'linux' ? 25 : 20) };
}
