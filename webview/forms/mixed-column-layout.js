import { availableTrackWidth, updateStyle } from './layout-box.mjs';
import { controlBounds, horizontalInputMaximum, allocateLaneSizes, laneInputBounds, stretches } from './layout-model.mjs';
import { inputRows, nativeReferenceInput, scalar } from './model.mjs';

const sum = values => values.reduce((total, value) => total + value, 0);
const gap = 10;

function controlSize(entry, { os, collapsed }) {
  const value = entry.kind === 'field' ? entry.controlWidth : entry.width;
  if (!stretches(entry.node, 'x', collapsed)) {
    return { preferred: value, minimum: value, maximum: value, growthWeight: 0 };
  }
  const bounds = controlBounds(entry.node, 'x', value, os);
  const maximum = horizontalInputMaximum(entry.node, os) ?? bounds.maximum ?? Infinity;
  const preferred = Math.min(value, maximum);
  const minimum = laneInputBounds(entry.node, os)?.narrowMinimum
    ?? bounds.minimum ?? (entry.node.kind === 'LabelField' ? 60 : 80);
  return { preferred, minimum: Math.min(preferred, minimum), maximum, growthWeight: preferred };
}

function trackProfiles(lanes, above) {
  const count = Math.max(...lanes.map(lane => lane.children.length));
  return Array.from({length: count}, (_, index) => {
    const entries = lanes.flatMap(lane => lane.children[index] ?? []);
    const side = entry => entry.location === 'Left' && !above?.has(entry.node.key);
    const labelWidth = Math.max(0, ...entries.filter(side).map(entry => entry.labelWidth));
    const sizes = entries.map(entry => {
      const reserve = side(entry) ? labelWidth + entry.labelGap : 0;
      const {preferred, minimum, maximum, growthWeight} = entry.size;
      return {reserve, preferred: reserve + preferred, minimum: reserve + minimum, maximum: reserve + maximum, growthWeight};
    });
    const widest = property => Math.max(...sizes.map(size => size[property]));
    return { labelWidth, reserve: widest('reserve'), preferred: widest('preferred'), minimum: widest('minimum'),
      maximum: widest('maximum'), growthWeight: widest('growthWeight') };
  });
}

function referencePictureLabel(lane, os) {
  const [field, picture, label] = lane.children;
  return lane.children.length === 3 && field.kind === 'field' && field.size.growthWeight > 0
    && inputRows(field.node) === 1 && nativeReferenceInput(field.node, os) && !!laneInputBounds(field.node, os)
    && picture.node.kind === 'PictureField' && !picture.size.growthWeight
    && label.node.kind === 'LabelField' && label.size.growthWeight > 0;
}

function placementPlans(lanes, preferred) {
  const candidates = lanes.map(lane => lane.children[0])
    .filter(field => field.location === 'Left' && scalar(field.node, 'TitleLocation', 'Auto') === 'Auto')
    .sort((a, b) => b.labelWidth + b.labelGap - a.labelWidth - a.labelGap);
  const plans = [{above: new Set(), tracks: preferred, minimum: sum(preferred.map(track => track.minimum))}];
  const above = new Set();
  for (const field of candidates) {
    above.add(field.node.key);
    const tracks = trackProfiles(lanes, above);
    plans.push({above: new Set(above), tracks, minimum: sum(tracks.map(track => track.minimum))});
  }
  return plans;
}

function topTrackWidths(available, tracks, weights, round) {
  const [input, picture, label] = tracks;
  const room = Math.min(available - picture.preferred, input.maximum + label.maximum);
  const ideal = round(room * weights[0].preferred / (weights[0].preferred + weights[2].preferred));
  const lower = Math.max(input.minimum, room - label.maximum);
  const upper = Math.min(input.maximum, room - label.minimum);
  const width = Math.max(lower, Math.min(upper, ideal));
  return [width, picture.preferred, room - width];
}

/** Keep mixed rows in one column scope while their automatic titles move above the controls. */
export function mixedColumnLayout(context) {
  const { alignment, os, scale } = context;
  const minimumRows = new Map(), allocations = [];

  function register(items, lanes, setCell, setLane) {
    for (const lane of lanes) {
      for (const entry of lane.children) entry.size = controlSize(entry, context);
    }
    const adaptive = lanes.every(lane => referencePictureLabel(lane, os));
    const title = adaptive && items.parentElement.querySelector(':scope > .taxi-group-title[data-native-heading-minimum]');
    const heading = title ? { items, preferred: Number(title.dataset.nativeTextWidth) } : undefined;
    const shared = lanes.filter(lane => !lane.node.presentation.united);
    const widest = adaptive ? trackProfiles(lanes) : undefined;
    if (shared.length) registerScope(shared, false, heading, widest, setCell, setLane);
    for (const lane of lanes.filter(lane => lane.node.presentation.united)) {
      registerScope([lane], true, heading, widest, setCell, setLane);
    }
  }

  function registerScope(lanes, united, heading, widest, setCell, setLane) {
    const preferred = trackProfiles(lanes);
    const plans = widest ? placementPlans(lanes, preferred) : undefined;
    for (const lane of lanes) {
      alignment.mark(lane.items, 'data-united-flex-lane');
      setLane(lane, gap);
      if (plans) {
        alignment.mark(lane.items, 'data-united-mixed-titles');
        minimumRows.set(lane.items, plans.at(-1).minimum + gap * (preferred.length - 1));
      }
      for (const [index, entry] of lane.children.entries()) {
        const {preferred: width, minimum, maximum, growthWeight, labelWidth} = preferred[index];
        setCell(entry, width);
        if (entry.kind === 'field') alignment.style(entry.element, '--taxi-united-cell-label-width', `${labelWidth}px`);
        alignment.style(entry.element, '--taxi-united-cell-min-width', `${minimum}px`);
        alignment.style(entry.element, '--taxi-united-cell-max-width', Number.isFinite(maximum) ? `${maximum}px` : 'none');
        // Widths for other mixed controls still use their CSS flex allocation.
        const shrink = width > 0 ? (width - minimum) / width : 0;
        alignment.style(entry.element, '--taxi-united-cell-flex', [growthWeight, shrink, width + 'px'].join(' '));
      }
    }
    if (plans) allocations.push({lanes, plans, united, heading, widest});
  }

  function allocate(above) {
    for (const {lanes, plans, united, heading, widest} of allocations) {
      const available = Math.min(...lanes.map(lane => availableTrackWidth(lane.items, widest.length, scale)));
      const plan = plans.find(candidate => candidate.minimum <= available) ?? plans.at(-1);
      const room = Math.max(available, plan.minimum);
      const {tracks} = plan;
      const moved = plan.above.size > 0;
      // When the group heading wraps, Designer sizes the top-title rows from the value widths.
      const titleWraps = heading && availableTrackWidth(heading.items, 1, scale) < heading.preferred;
      const weights = titleWraps ? tracks : widest;
      const widths = moved && !tracks[0].reserve
        ? topTrackWidths(room, tracks, weights, united ? Math.floor : Math.ceil)
        : allocateLaneSizes(room, tracks);
      for (const lane of lanes) {
        for (const [index, entry] of lane.children.entries()) {
          const track = tracks[index];
          const width = widths[index];
          updateStyle(entry.element, '--taxi-united-cell-flex', `0 0 ${width}px`);
          updateStyle(entry.element, '--taxi-united-cell-min-width', `${track.minimum}px`);
          updateStyle(entry.element, '--taxi-united-cell-max-width', Number.isFinite(track.maximum) ? `${track.maximum}px` : 'none');
          if (entry.kind !== 'field') continue;
          if (plan.above.has(entry.node.key)) above.add(entry.node.key);
          const labelWidth = available <= plan.minimum ? entry.labelWidth : track.labelWidth;
          updateStyle(entry.element, '--taxi-united-cell-label-width', `${labelWidth}px`);
        }
      }
    }
  }

  return { register, allocate, minimumRows };
}
