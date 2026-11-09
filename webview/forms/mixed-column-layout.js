import { availableTrackWidth, borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { controlBounds, horizontalInputMaximum, allocateLaneSizes, laneInputBounds, stretches } from './layout-model.mjs';
import { flag, inputRows, nativeReferenceInput, number, property, scalar } from './model.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { inputCaptionInset } from './field-caption-layout.js';

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

function measureThroughPicture(entry, { alignment, scale }) {
  const { node, element, width } = entry;
  const authored = number(node, 'Width');
  if (!authored || flag(node, 'AutoMaxWidth') || authored !== number(node, 'MaxWidth')) return;
  const control = element.querySelector('.taxi-picture-field');
  const border = boxInsets(getComputedStyle(control));
  // The authored maximum includes the value width. The border remains visible at the cap.
  entry.size = { minimum: Math.min(width, 10 + border.width), preferred: width,
    maximum: width + border.width, growthWeight: width };
  const height = number(node, 'Height');
  const fixedHeight = height > 0 && !flag(node, 'AutoMaxHeight') && height === number(node, 'MaxHeight');
  alignment.mark(element, 'data-through-picture', fixedHeight ? 'height' : '');
  if (fixedHeight) {
    const painted = borderBoxSize(control, scale).height + border.height;
    alignment.style(element, '--taxi-through-picture-height', `${painted}px`);
    const vertical = scalar(node, 'GroupVerticalAlign');
    alignment.style(element, '--taxi-through-picture-offset', vertical === 'Center' ? '.5px' : vertical ? '0px' : '1px');
  }
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

function stretchReference(entry, os) {
  return entry.node.kind === 'InputField' && entry.size.growthWeight > 0
    && inputRows(entry.node) === 1 && nativeReferenceInput(entry.node, os) && !!laneInputBounds(entry.node, os);
}

function referencePictureLabel(lane, os) {
  const [field, picture, label] = lane.children;
  return lane.children.length === 3 && field.kind === 'field' && stretchReference(field, os)
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
  const minimumRows = new Map(), widthFloors = new Map(), allocations = [], throughAllocations = [];

  function sizeEntries(entries) {
    for (const entry of entries) entry.size = controlSize(entry, context);
  }

  function register(items, lanes, setCell, setLane) {
    sizeEntries(lanes.flatMap(lane => lane.children));
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

  function registerThrough(lanes, fields, peers) {
    sizeEntries(lanes.flatMap(lane => lane.children));
    const hasTooltip = entry => entry.row.querySelector('[data-tooltip-button]');
    if (!lanes.every(lane => referencePictureLabel(lane, os) && !hasTooltip(lane.children[0]))) return;
    sizeEntries(fields);
    const references = fields.filter(entry => stretchReference(entry, os) && !hasTooltip(entry));
    if (!references.length) return;

    for (const lane of lanes) {
      const [, picture, label] = lane.children;
      measureThroughPicture(picture, context);
      if (property(label.node, 'BackColor')) {
        label.size.minimum = Math.min(label.size.preferred, label.size.minimum + 2);
      }
      alignment.mark(lane.items, 'data-through-mixed-lane');
      for (const {element} of lane.children) {
        alignment.style(element, '--taxi-united-cell-flex', '0 0 var(--taxi-preferred-width)');
        alignment.style(element, '--taxi-united-cell-min-width', '0px');
      }
    }
    for (const { element } of references) {
      alignment.mark(element, 'data-through-mixed-field');
      alignment.style(element, '--taxi-through-value-width', '');
    }
    const members = [...lanes, ...references].map(entry => entry.element);
    let column = lanes[0].element.parentElement;
    while (column && !members.every(element => column.contains(element))) {
      column = column.parentElement?.closest('.taxi-items');
    }
    const captions = [...references, ...lanes.map(lane => lane.children[0])].map(({ node, row, labelGap }) => {
      const label = row.querySelector('.taxi-field-label')?.getAttribute('aria-label') ?? '';
      const profile = fieldCaptionProfile(label, node.presentation.titleFont);
      return profile && profile.minimum + inputCaptionInset + labelGap;
    });
    const compactReserve = captions.every(Number.isFinite) ? Math.max(...captions) : undefined;
    throughAllocations.push({ column, lanes, references, compactReserve, ...peers(column) });
  }

  function leadingOrigin(lanes) {
    return lanes[0].children[0].element.getBoundingClientRect().left / scale;
  }

  function occupiedWidth(fields, origin) {
    return Math.max(0, ...fields.map(({ element, outset, width = 0 }) => {
      const { left, right } = element.getBoundingClientRect();
      return Math.round(Math.max(right / scale, left / scale + width) + outset - origin);
    }));
  }

  function captureThroughPreferred() {
    for (const scope of throughAllocations) {
      const { column, lanes, fixedSiblings, stacks } = scope;
      const origin = leadingOrigin(lanes);
      const [leading, picture, label] = trackProfiles(lanes);
      const spacing = (lanes[0].children.length - 1) * pixels(getComputedStyle(lanes[0].items).columnGap);
      const rigid = occupiedWidth(fixedSiblings.filter(peer => peer.rigid), origin);
      const fixed = occupiedWidth(fixedSiblings, origin);
      const stack = Math.max(0, ...stacks.map(({ items, fields }) => occupiedWidth(fields, origin)
        + pixels(getComputedStyle(items).paddingRight) + pixels(getComputedStyle(items.parentElement).paddingRight)));
      // A fixed group that is wider in the preferred layout already supplies the leading slot.
      scope.stackWidth = stack > fixed ? stack : 0;
      const width = Math.max(leading.preferred, scope.stackWidth, rigid);
      if (width > leading.preferred) {
        const preferred = width + picture.preferred + label.preferred + spacing;
        for (const { items } of lanes) alignment.style(items, '--taxi-through-preferred-width', `${preferred}px`);
      }
      if (rigid > 0) {
        const floor = rigid + picture.minimum + label.minimum + spacing;
        widthFloors.set(column, Math.max(floor, widthFloors.get(column) ?? 0));
      }
    }
  }

  function allocateThrough({ lanes, references, fixedSiblings, compactReserve, stackWidth }) {
    // Read the caption after the through-aligned groups have chosen their wrapped titles.
    for (const lane of lanes) {
      const [entry] = lane.children;
      entry.labelWidth = pixels(getComputedStyle(entry.row).gridTemplateColumns);
    }
    const tracks = trackProfiles(lanes), [leading, picture, label] = tracks;
    const available = Math.min(...lanes.map(lane => availableTrackWidth(lane.items, tracks.length, scale)));
    // A fixed sibling occupies the leading track across the vertical stack.
    const origin = leadingOrigin(lanes);
    const fixed = occupiedWidth(fixedSiblings, origin);
    const floor = Math.min(fixed, available - picture.minimum - label.minimum);
    const renderedMinimum = Math.max(leading.minimum, floor);
    const stackDominates = stackWidth > leading.preferred;
    // A wrapping title contributes its compact width to the shrink calculation.
    const compactMinimum = leading.minimum - leading.reserve + (compactReserve ?? leading.reserve);
    leading.minimum = stackDominates ? Math.max(floor, Math.min(renderedMinimum, compactMinimum)) : renderedMinimum;
    leading.preferred = Math.max(leading.preferred, leading.minimum, stackWidth);
    leading.maximum = Math.max(leading.maximum, leading.preferred);
    leading.growthWeight = leading.preferred - leading.reserve;
    let requested = allocateLaneSizes(available, tracks, { fractional: true });
    if (stackDominates && requested[0] < renderedMinimum) {
      leading.minimum = renderedMinimum;
      requested = allocateLaneSizes(available, tracks, { fractional: true });
    }
    const preferred = sum(tracks.map(track => track.preferred));
    // Round the two leading boxes independently and give the last label the remaining pixels.
    const round = available < preferred ? Math.floor : Math.round;
    const first = requested.slice(0, 2).map(round);
    const widths = [...first, round(sum(requested) + 1e-7) - sum(first)];
    for (const lane of lanes) {
      for (const [index, entry] of lane.children.entries()) {
        updateStyle(entry.element, '--taxi-united-cell-flex', `0 0 ${widths[index]}px`);
      }
    }
    for (const entry of references) {
      const caption = pixels(getComputedStyle(entry.row).gridTemplateColumns);
      const width = Math.max(entry.size.minimum, widths[0] - caption - entry.labelGap);
      updateStyle(entry.element, '--taxi-through-value-width', `${width}px`);
    }
    return origin + widths[0];
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
    return new Map(throughAllocations.map(scope => [scope.column, allocateThrough(scope)]));
  }

  return { register, registerThrough, captureThroughPreferred, allocate, minimumRows, widthFloors };
}
