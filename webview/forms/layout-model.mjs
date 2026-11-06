import { number, scalar, flag, fieldWidth, inputHeight, linuxFixedInputWidth, nativeReferenceInput, automaticTextWidth } from './model.mjs';
import { hasTableSurface, tableSearchReference } from './table-model.mjs';

const containers = new Set(['Form', 'UsualGroup', 'Page', 'Pages', 'ColumnGroup']);
const surfaces = new Set(['Table', 'ChartField', 'DendrogramField', 'GanttChartField', 'PlannerField',
  'SpreadSheetDocumentField', 'TextDocumentField', 'FormattedDocumentField', 'HTMLDocumentField',
  'PDFDocumentField', 'GeographicalSchemaField', 'GraphicalSchemaField', 'PictureField']);
const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
const explicitNo = value => ['false', 'No', '0'].includes(value);
const explicitYes = value => ['true', 'Yes', '1'].includes(value);

export function horizontalGrouping(node) {
  return ['Horizontal', 'HorizontalIfPossible'].includes(node.presentation.grouping);
}

export function ordinaryGroup(node) {
  return node.kind === 'UsualGroup' && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'));
}

export function automaticHorizontalSpacing(node) {
  return scalar(node, 'HorizontalSpacing', 'Auto') === 'Auto';
}

export function displayedInPreview(node) {
  return node.presentation.displayed && (node.kind !== 'Table' || hasTableSurface(node));
}

/** Designer's Auto belongs to the widget/type; group Auto inherits its visible descendants. */
export function stretches(node, axis, collapsed = {}) {
  const value = scalar(node, axis === 'x' ? 'HorizontalStretch' : 'VerticalStretch', 'Auto');
  if (explicitYes(value)) return true;
  if (explicitNo(value)) return false;
  if (containers.has(node.kind)) {
    if (axis === 'y' && collapsed[node.key]) return false;
    return node.children.some(child => displayedInPreview(child) && stretches(child, axis, collapsed));
  }
  if (surfaces.has(node.kind)) return true;
  if (axis === 'x' && node.kind === 'CommandBar') return scalar(node, 'CommandSource').startsWith('Item.')
    || node.children.some(child => !!tableSearchReference(scalar(child, 'CommandName')));
  if (axis === 'x') return ['InputField', 'LabelField'].includes(node.kind)
    && ['string', 'reference'].includes(node.presentation.valueType?.kind);
  return ['InputField', 'LabelField'].includes(node.kind) && number(node, 'Height') > 1;
}

/** An explicit dimension of a stretchable item is its proportional allocation weight. */
export function stretchWeight(node, axis) { return positive(number(node, axis === 'x' ? 'Width' : 'Height')) || 1; }

function automaticInputMaximum(node, os, referenceLane = false) {
  const auto = scalar(node, 'AutoMaxWidth', 'Auto');
  if (explicitNo(auto)) return;
  const { kind, length } = node.presentation.valueType;
  const reference = nativeReferenceInput(node, os);
  const stretchesByDefault = !explicitYes(scalar(node, 'HorizontalStretch', 'Auto'))
    && ['string', 'reference'].includes(kind);
  if (explicitYes(auto) || stretchesByDefault || referenceLane && reference) {
    return kind === 'string' && !length || reference ? automaticTextWidth(node) : fieldWidth(node, os);
  }
}

/** Pixel bounds apply to the control area; titles and auxiliary bars are allocated separately. */
export function controlBounds(node, axis, preferred, os, atPreferred = false) {
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
    const manual = explicitNo(scalar(node, `AutoMax${dimension}`, 'Auto'));
    if (manual) {
      // Manual bounds apply after leaving the initial Designer size.
      if (!atPreferred) maximum = positive(number(node, `Max${dimension}`)) * unit || undefined;
    } else if (axis === 'x' && node.kind === 'InputField') {
      const automatic = automaticInputMaximum(node, os);
      if (automatic !== undefined) maximum = Math.max(preferred || 0, automatic);
    }
  }
  return { minimum: minimum || undefined, maximum: maximum ? Math.max(minimum, maximum) : undefined };
}

/** Width bounds of the measured input profiles inside a horizontal group of columns. */
export function laneInputBounds(node, os) {
  const type = node.presentation.valueType;
  const reference = nativeReferenceInput(node, os);
  const plain = type.kind === 'string' && !type.length && linuxFixedInputWidth(node, os);
  if ((!reference && !plain) || (node.presentation.font?.points ?? 10) !== 10) return;
  const preferred = fieldWidth(node, os);
  const bounds = controlBounds(node, 'x', preferred, os);
  const maximum = automaticInputMaximum(node, os, true) ?? bounds.maximum ?? Infinity;
  return { preferred, minimum: Math.min(reference ? bounds.minimum ?? preferred : 71, preferred), maximum: Math.max(preferred, maximum) };
}

/** Allocate column widths in native pixels, including the fixed space reserved for titles. */
export function horizontalLaneWidths(available, lanes) {
  const preferred = lanes.reduce((sum, lane) => sum + lane.preferred, 0);
  let widths;
  let round = Math.round;
  if (available <= preferred) {
    const minimum = lanes.reduce((sum, lane) => sum + lane.minimum, 0);
    const fraction = Math.max(0, (available - minimum) / (preferred - minimum || 1));
    widths = lanes.map(lane => lane.minimum + (lane.preferred - lane.minimum) * fraction);
    round = Math.floor;
  } else {
    // Grow proportional control tracks and freeze each one as it reaches its maximum.
    const events = lanes.flatMap(lane => {
      const weight = lane.preferred - lane.reserve - 1;
      if (weight <= 0 || lane.preferred === lane.maximum) return [];
      const limits = [[(lane.preferred - lane.reserve) / weight, weight]];
      if (Number.isFinite(lane.maximum)) limits.push([(lane.maximum - lane.reserve) / weight, -weight]);
      return limits;
    }).sort((a, b) => a[0] - b[0]);
    let total = preferred, slope = 0, factor = 0;
    for (const [next, delta] of events) {
      const growth = (next - factor) * slope;
      if (slope > 0 && total + growth >= available) {
        factor += (available - total) / slope;
        total = available;
        break;
      }
      total += growth;
      factor = next;
      slope += delta;
    }
    if (slope > 0) factor += (available - total) / slope;
    widths = lanes.map(lane => Math.max(lane.preferred,
      Math.min(lane.maximum, lane.reserve + Math.max(0, lane.preferred - lane.reserve - 1) * factor)));
  }
  let edge = 0, previous = 0;
  return widths.map(width => {
    edge += width;
    const next = round(edge + 1e-7), result = next - previous;
    previous = next;
    return result;
  });
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
