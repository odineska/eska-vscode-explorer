import { color, property, number, scalar, flag, fieldWidth, inputHeight, inputControlHeight, inputRows, linuxFixedInputWidth, nativeReferenceInput, referenceButtonWidth, automaticTextWidth, numericLabelMetrics } from './model.mjs';
import { hasTableSurface, tableSearchReference } from './table-model.mjs';

const containers = new Set(['Form', 'UsualGroup', 'Page', 'Pages', 'ColumnGroup']);
const surfaces = new Set(['Table', 'ChartField', 'DendrogramField', 'GanttChartField', 'PlannerField',
  'SpreadSheetDocumentField', 'TextDocumentField', 'FormattedDocumentField', 'HTMLDocumentField',
  'PDFDocumentField', 'GeographicalSchemaField', 'GraphicalSchemaField', 'PictureField']);
const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
const explicitNo = value => ['false', 'No', '0'].includes(value);
const explicitYes = value => ['true', 'Yes', '1'].includes(value);

// In Linux Designer, authored heights of forms and ordinary groups use a 16 px unit.
export const linuxContainerHeightUnit = 16;

export function horizontalGrouping(node) {
  return ['Horizontal', 'HorizontalIfPossible'].includes(node.presentation.grouping);
}

export function ordinaryGroup(node) {
  return node.kind === 'UsualGroup' && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'));
}

/** Only an explicitly undecorated group continues automatic caption tracks. */
export function sharesGroupLabels(node) {
  if (!ordinaryGroup(node) || !flag(node, 'HorizontalStretch')) return false;
  const mode = scalar(node, 'ThroughAlign', 'Auto');
  return mode === 'Use' || mode === 'Auto' && scalar(node, 'Representation') === 'None';
}

export function hasAuthoredGroupHeight(node, os) {
  return os === 'linux' && ordinaryGroup(node) && number(node, 'Height') > 0;
}

/** An automatic group width can contract even if the group receives no extra space. */
export function groupCanShrink(node, os) {
  return os === 'linux' && ordinaryGroup(node) && number(node, 'Width') <= 0;
}

export function automaticHorizontalSpacing(node) {
  return scalar(node, 'HorizontalSpacing', 'Auto') === 'Auto';
}

export function displayedInPreview(node) {
  if (!node.presentation.displayed) return false;
  if (node.kind === 'Table') return hasTableSurface(node);
  if (!ordinaryGroup(node) || node.children.length || flag(node, 'ShowTitle')) return true;
  // Empty settings containers remain in the tree and enter the preview when they acquire content.
  const decoration = !['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto')) || !!property(node, 'BackColor');
  return decoration || number(node, 'Width') > 0 || number(node, 'Height') > 0
    || explicitYes(scalar(node, 'HorizontalStretch')) || explicitYes(scalar(node, 'VerticalStretch'));
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
  if (node.kind === 'InputField' && inputRows(node) > 1
    && !explicitNo(scalar(node, 'HorizontalStretch'))) return true;
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

function automaticMultilineMaximum(node, os) {
  const { kind, length } = node.presentation.valueType;
  if (kind !== 'string' || length || !linuxFixedInputWidth(node, os) || inputRows(node) <= 1
    || explicitNo(scalar(node, 'AutoMaxWidth'))) return;
  return Math.max(fieldWidth(node, os), automaticTextWidth(node));
}

function inputMinimum(node, axis, os, authoredHeight) {
  if (axis === 'x') return Math.min(80, fieldWidth(node, os));
  if (os === 'linux') {
    // An authored container height can compress the input to one line. Viewport overflow keeps its XML height.
    return authoredHeight ? inputHeight(node, os) : inputControlHeight(node, os);
  }
  return flag(node, 'MultiLine', false) ? 40 : inputHeight(node, os);
}

/** Pixel bounds apply to the control area; titles and auxiliary bars are allocated separately. */
export function controlBounds(node, axis, preferred, os, { atPreferred = false, authoredHeight = false } = {}) {
  const dimension = axis === 'x' ? 'Width' : 'Height';
  const explicit = number(node, dimension), stretch = stretches(node, axis);
  // With an explicit fixed size, Designer ignores maximum-size properties.
  if (explicit > 0 && !stretch) return {};
  const unit = axis === 'x' ? os === 'linux' ? 10 : 8 : node.kind === 'InputField' ? 20 : os === 'linux' ? 25 : 20;
  // 8.3.27 calculates minima itself; unknown MinWidth/MinHeight XML must not become invented properties.
  const numericLabel = axis === 'x' ? numericLabelMetrics(node, os) : undefined;
  const minimum = numericLabel?.minimum ?? (node.kind === 'InputField' ? inputMinimum(node, axis, os, authoredHeight) : 0);
  let maximum = axis === 'x' ? automaticMultilineMaximum(node, os) : undefined;
  if (maximum === undefined && (explicit <= 0 || numericLabel)) {
    const manual = explicitNo(scalar(node, `AutoMax${dimension}`, 'Auto'));
    if (manual) {
      // Manual bounds apply after leaving the initial Designer size.
      const limit = positive(number(node, `Max${dimension}`));
      if (!atPreferred && limit) maximum = limit * unit + (numericLabel?.widthOutset ?? 0);
    } else if (numericLabel) {
      maximum = numericLabel.maximum;
    } else if (axis === 'x' && node.kind === 'InputField') {
      const automatic = automaticInputMaximum(node, os);
      if (automatic !== undefined) maximum = Math.max(preferred || 0, automatic);
    }
  }
  return { minimum: minimum || undefined, maximum: maximum ? Math.max(numericLabel?.preferred ?? minimum, maximum) : undefined };
}

function manualLaneMaximum(node) {
  if (number(node, 'Width') > 0 || !explicitNo(scalar(node, 'AutoMaxWidth', 'Auto'))) return;
  const limit = positive(number(node, 'MaxWidth'));
  if (limit) return limit * 10 + 10;
}

/** A bounded input in a Linux horizontal row reserves only its usable width. */
export function horizontalInputMaximum(node, os) {
  if (os !== 'linux' || node.kind !== 'InputField' || !stretches(node, 'x')) return;
  const maximum = manualLaneMaximum(node);
  if (maximum === undefined) return automaticMultilineMaximum(node, os);
  const intrinsic = fieldWidth(node, os);
  const minimum = controlBounds(node, 'x', intrinsic, os).minimum;
  if (nativeReferenceInput(node, os)) {
    // A cap that accommodates the native value area preserves the preferred buttons.
    // Smaller caps include the buttons and the trailing border in the capped box.
    return maximum >= intrinsic - referenceButtonWidth
      ? Math.max(intrinsic, maximum) : Math.max(minimum, maximum + 1);
  }
  if (node.presentation.valueType.kind === 'string' && linuxFixedInputWidth(node, os)) return Math.max(maximum, minimum);
}

/** Width bounds of the measured input profiles inside a horizontal group of columns. */
export function laneInputBounds(node, os) {
  const type = node.presentation.valueType;
  const reference = nativeReferenceInput(node, os);
  const plain = type.kind === 'string' && !type.length && linuxFixedInputWidth(node, os);
  if ((!reference && !plain) || (node.presentation.font?.points ?? 10) !== 10) return;
  const intrinsic = fieldWidth(node, os);
  const bounds = controlBounds(node, 'x', intrinsic, os);
  const maximum = manualLaneMaximum(node) ?? automaticInputMaximum(node, os, true) ?? bounds.maximum ?? Infinity;
  // A manual cap below the intrinsic width becomes the preferred box with its trailing border.
  const preferred = Math.min(intrinsic, maximum + 1);
  const narrowMinimum = Math.min(reference ? 113 : 71, preferred);
  const minimum = reference && node.presentation.titleLocation !== 'None'
    ? Math.min(bounds.minimum ?? intrinsic, preferred) : narrowMinimum;
  return { preferred, minimum, narrowMinimum, maximum: Math.max(preferred, maximum), valueWeight: reference ? 98 : 78 };
}

/** Share free space proportionally, redistributing a track’s excess after its cap. */
export function cappedTrackGrowth(space, limits) {
  const active = limits.map(({weight, limit}, index) => ({weight, limit, index}))
    .filter(({weight, limit}) => weight > 0 && limit > 0)
    .sort((left, right) => left.limit / left.weight - right.limit / right.weight);
  const widths = limits.map(() => 0);
  let weight = active.reduce((sum, track) => sum + track.weight, 0), first = 0;
  for (; first < active.length; first++) {
    const track = active[first];
    if (space * track.weight / weight <= track.limit) break;
    widths[track.index] = track.limit;
    space -= track.limit;
    weight -= track.weight;
  }
  for (const track of active.slice(first)) widths[track.index] = space * track.weight / weight;
  return widths;
}

/** Choose the caption widths that fit beside the preferred value boxes. */
export function fitCaptionWidths(available, tracks, trailingOnly = false) {
  const sum = values => values.reduce((total, value) => total + value, 0);
  const insets = sum(tracks.map(track => track.reserve));
  const preferredValues = sum(tracks.map(track => track.value.preferred));
  const minimumValues = sum(tracks.map(track => track.value.minimum));
  const preferred = insets + preferredValues + sum(tracks.map(track => track.caption.preferred));
  if (available >= preferred) return;

  const captions = tracks.map(track => track.caption.minimum);
  let captionTotal = sum(captions);
  const width = Math.max(available - insets, captionTotal + minimumValues);
  // A third line can be removed once the minimum captions and preferred values fit.
  for (let index = tracks.length - 1; index >= 0; index--) {
    const delta = tracks[index].caption.compact - captions[index];
    if (width >= captionTotal + preferredValues && width >= captionTotal + delta + minimumValues) {
      captions[index] += delta;
      captionTotal += delta;
    }
  }
  // Retain full captions from the trailing side while their preferred values fit.
  for (let index = tracks.length - 1; index >= 0; index--) {
    const delta = tracks[index].caption.preferred - captions[index];
    if (width >= captionTotal + delta + preferredValues) {
      captions[index] += delta;
      captionTotal += delta;
    } else if (delta > 0 && trailingOnly) break;
  }

  return { captions, valueSpace: width - captionTotal, preferredValues, minimumValues };
}

/** Allocate bounded tracks in native pixels, including space reserved for control chrome. */
export function allocateLaneSizes(available, lanes) {
  const preferred = lanes.reduce((sum, lane) => sum + lane.preferred, 0);
  let widths;
  let round = Math.round;
  if (available <= preferred) {
    const minimum = lanes.reduce((sum, lane) => sum + lane.minimum, 0);
    const fraction = Math.max(0, (available - minimum) / (preferred - minimum || 1));
    widths = lanes.map(lane => lane.minimum + (lane.preferred - lane.minimum) * fraction);
    round = Math.floor;
  } else if (lanes.every(lane => lane.growthWeight !== undefined)) {
    const growth = cappedTrackGrowth(available - preferred, lanes.map(lane => ({
      weight: lane.growthWeight, limit: lane.maximum - lane.preferred,
    })));
    widths = lanes.map((lane, index) => lane.preferred + growth[index]);
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
  return roundTrackWidths(widths, round);
}

export function roundTrackWidths(widths, round = Math.round) {
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
  const linux = os === 'linux', height = positive(number(node, 'Height'));
  // The authored height of an ordinary group includes its two layout edge pixels.
  return { width: positive(number(node, 'Width')) * (linux ? 10 : 8),
    height: height * (linux ? linuxContainerHeightUnit : 20) + (linux && height > 0 && ordinaryGroup(node) ? 2 : 0) };
}

export function pictureFieldStyle(node, os) {
  const width = number(node, 'Width'), height = number(node, 'Height');
  const linux = os === 'linux';
  const fixedHeight = linux ? height * linuxContainerHeightUnit + 2 : height * 20;
  const border = property(node, 'Border')?.value;
  const borderStyle = border?.kind === 'record' && border.fields.find(field =>
    field.key.namespace === 'http://v8.1c.ru/8.1/data/ui' && field.key.name === 'style')?.value.text;
  return {
    width: (width > 0 ? width * (linux ? 10 : 8) : 122) + 'px',
    height: (height > 0 ? fixedHeight : 120) + 'px',
    'border-style': borderStyle === 'WithoutBorder' ? 'none' : undefined,
    'border-color': color(node.presentation.border),
  };
}
