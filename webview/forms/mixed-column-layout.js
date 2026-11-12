import { availableTrackWidth, borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { controlBounds, horizontalInputMaximum, allocateLaneSizes, laneInputBounds, pictureFieldStyle, stretches } from './layout-model.mjs';
import { flag, inputRows, nativeReferenceInput, number, property, scalar, textLabelMetrics } from './model.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, inputCaptionInset } from './field-caption-layout.js';

const sum = values => values.reduce((total, value) => total + value, 0);
const gap = 10;
const mixedCaptionWidth = '--taxi-through-mixed-caption-width';

function compactTrack({ minimum, maximum }) {
  return { minimum, preferred: minimum, maximum, growthWeight: minimum };
}

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

function measureThroughPicture(entry, { alignment, os, scale }) {
  const { node, element } = entry;
  const authored = number(node, 'Width');
  if (!authored || flag(node, 'AutoMaxWidth') || authored !== number(node, 'MaxWidth')) return;
  const control = element.querySelector('.taxi-picture-field');
  const border = boxInsets(getComputedStyle(control));
  const width = pixels(pictureFieldStyle(node, os).width);
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
    && label.node.kind === 'LabelField';
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
  const minimumRows = new Map(), widthFloors = new Map(), fixedThroughWidths = new Map();
  const allocations = [], throughAllocations = [];

  function sizeEntries(entries) {
    for (const entry of entries) entry.size = controlSize(entry, context);
  }

  function register(items, lanes, setCell, setLane) {
    sizeEntries(lanes.flatMap(lane => lane.children));
    const adaptive = lanes.every(lane => referencePictureLabel(lane, os) && lane.children[2].size.growthWeight > 0);
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
      const labelBounds = textLabelMetrics(label.node, os);
      if (labelBounds) {
        label.width = labelBounds.preferred;
        label.size = controlSize(label, context);
      }
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
    const titles = [...references, ...lanes.map(lane => lane.children[0])].map(({ node, row, element, labelGap }) => {
      const label = row.querySelector('.taxi-field-label')?.getAttribute('aria-label') ?? '';
      return { key: node.key, element, labelGap, caption: fieldCaptionProfile(label, node.presentation.titleFont) };
    });
    const compactReserve = titles.every(title => title.caption) ? Math.max(...titles.map(({ caption, labelGap }) =>
      caption.minimum + inputCaptionInset + labelGap)) : undefined;
    throughAllocations.push({ column, lanes, references, titles, compactReserve, ...peers(column) });
  }

  function leadingOrigin(lanes) {
    return lanes[0].children[0].element.getBoundingClientRect().left / scale;
  }

  function occupiedWidth(fields, origin) {
    return Math.max(0, ...fields.map(({ element, outset, width = 0, authoredWidth }) => {
      const { left, right } = element.getBoundingClientRect();
      // The leading track can grow beyond the authored date width during allocation.
      const end = authoredWidth ? left / scale + authoredWidth : Math.max(right / scale, left / scale + width);
      return Math.round(end + outset - origin);
    }));
  }

  function captureThroughPreferred(stackLimits, dateProfiles) {
    for (const scope of throughAllocations) {
      const { column, lanes, fixedSiblings, stacks, compactReserve } = scope;
      const origin = leadingOrigin(lanes);
      const [leading, picture, label] = trackProfiles(lanes);
      const spacing = (lanes[0].children.length - 1) * pixels(getComputedStyle(lanes[0].items).columnGap);
      const reserve = Math.min(leading.reserve, compactReserve ?? leading.reserve);
      const trailing = picture.minimum + label.minimum;
      const minimum = leading.minimum - leading.reserve + reserve + trailing + spacing;
      for (const { items } of lanes) minimumRows.set(items, minimum);
      const rigid = occupiedWidth(fixedSiblings.filter(peer => peer.rigid), origin);
      const fixed = occupiedWidth(fixedSiblings, origin);
      const stack = Math.max(0, ...stacks.map(({ items, fields }) => occupiedWidth(fields, origin)
        + pixels(getComputedStyle(items).paddingRight) + pixels(getComputedStyle(items.parentElement).paddingRight)));
      // A fixed group that is wider in the preferred layout already supplies the leading slot.
      scope.stackWidth = stack > fixed ? stack : 0;
      const fixedDates = fixedSiblings.filter(({ element }) => element.hasAttribute('data-fixed-date-block')
        && Math.abs(element.getBoundingClientRect().left / scale - origin) < .5);
      const topDate = fixedDates.find(({ element }) => dateProfiles.get(element.dataset.element)?.top)?.element;
      if (topDate && compactReserve !== undefined) {
        scope.topDateKey = topDate.dataset.element;
        scope.fullReferenceWidth = leading.preferred;
        for (const { element } of scope.titles) {
          alignment.style(element, '--taxi-field-caption-width', '');
          alignment.style(element.parentElement, '--taxi-through-allocated-label-width', '');
        }
      }
      const width = Math.max(leading.preferred, scope.stackWidth, rigid, fixedDates.length ? fixed : 0);
      const [date] = fixedDates;
      if (fixedDates.length === 1) scope.dateKey = date.element.dataset.element;
      const automaticTop = date && dateProfiles.get(date.element.dataset.element)?.automaticTop;
      if (fixedDates.length === 1 && automaticTop && compactReserve !== undefined) {
        scope.automaticDate = { ...date, ...automaticTop, fullWidth: leading.preferred, fullReserve: leading.reserve,
          captionMinimum: Math.max(...scope.titles.map(({ caption }) => caption.minimum)) };
        for (const { element } of scope.titles) alignment.style(element, mixedCaptionWidth, '');
      }
      if (width > leading.preferred) {
        const preferred = width + picture.preferred + label.preferred + spacing;
        for (const { items } of lanes) alignment.style(items, '--taxi-through-preferred-width', `${preferred}px`);
      }
      if (rigid > 0) {
        const floor = rigid + picture.minimum + label.minimum + spacing;
        widthFloors.set(column, Math.max(floor, widthFloors.get(column) ?? 0));
      }
      if (fixedDates.length) {
        // The fixed group shares the leading slot. The trailing controls need their own space.
        const inset = Math.max(...lanes.map(lane => {
          let width = 0;
          for (let element = lane.items; element && element !== column; element = element.parentElement) {
            const css = getComputedStyle(element);
            width += pixels(css.paddingRight) + pixels(css.borderRightWidth) + pixels(css.marginRight);
          }
          return width;
        }));
        const peers = stacks.map(({ items }) => ({
          offset: Math.round(items.getBoundingClientRect().left / scale - origin), limit: stackLimits.get(items),
        }));
        const layout = {
          trailingMinimum: trailing + spacing + inset,
          trailingPreferred: picture.preferred + label.preferred + spacing + inset,
          compactSpacing: scope.automaticDate ? spacing : 0,
          leadingWidth(available, minima) {
            const preferred = available + .5 >= leading.preferred ? leading.preferred : leading.preferred - leading.reserve + reserve;
            return Math.max(rigid, preferred, ...peers.map(({ offset, limit }) =>
              offset + (limit?.(available - offset, minima) ?? Infinity)));
          },
          availableWidth() {
            return Math.min(...lanes.map(lane => availableTrackWidth(lane.items, lane.children.length, scale))) - trailing;
          },
        };
        // With the date titles above, all three tracks share growth from their compact widths.
        if (scope.automaticDate) layout.compactLeadingWidth = (limit, minimum) =>
          minimum + Math.round(Math.max(0, limit - minimum) * minimum / (minimum + trailing));
        for (const date of fixedDates) {
          const { element } = date;
          const authoredWidth = dateProfiles.get(element.dataset.element)?.authoredWidth;
          date.authoredWidth = authoredWidth;
          fixedThroughWidths.set(element, authoredWidth ? { ...layout, authoredWidth, column } : layout);
        }
      }
    }
  }

  function allocateThrough(scope, above, captions, packedDates) {
    const { lanes, references, fixedSiblings, compactReserve, stackWidth, titles, topDateKey, fullReferenceWidth, automaticDate } = scope;
    const available = Math.min(...lanes.map(lane => availableTrackWidth(lane.items, lane.children.length, scale)));
    const origin = leadingOrigin(lanes);
    const automatic = automaticDate && above.has(automaticDate.leading);
    let planned = packedDates.get(topDateKey ?? scope.dateKey)?.leadingWidth;
    if (topDateKey) {
      const compact = planned !== undefined && planned + .5 < fullReferenceWidth;
      for (const title of titles) {
        const width = compact ? compactReserve - title.labelGap : undefined;
        updateStyle(title.element.parentElement, '--taxi-through-allocated-label-width', width === undefined ? '' : `${width}px`);
        captions.delete(title.key);
        allocateFieldCaption(captions, title, width === undefined ? width : width - inputCaptionInset, inputCaptionInset);
      }
    }
    if (automaticDate) {
      const dateWidth = automatic ? occupiedWidth([automaticDate], origin) : 0;
      const compact = automatic && dateWidth + .5 < automaticDate.fullWidth;
      const { minimum, captionMinimum, fullReserve } = automaticDate;
      const fraction = Math.max(0, (dateWidth - minimum) / minimum);
      const reserve = Math.min(fullReserve, compactReserve + Math.round(captionMinimum * fraction));
      if (automatic) planned = dateWidth;
      // Share the date block's leading edge while the automatic date titles sit above the fields.
      for (const title of titles) {
        if (compact) captions.delete(title.key);
        allocateFieldCaption(captions, title, compact ? reserve - title.labelGap - inputCaptionInset : undefined,
          inputCaptionInset, mixedCaptionWidth);
      }
    }
    // Read the caption after the through-aligned groups have chosen their wrapped titles.
    for (const lane of lanes) {
      const [entry] = lane.children;
      entry.labelWidth = pixels(getComputedStyle(entry.row).gridTemplateColumns);
    }
    const tracks = trackProfiles(lanes), [leading, picture, label] = tracks;
    // A fixed sibling occupies the leading track across the vertical stack.
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
    let requested;
    if (planned !== undefined) {
      const first = Math.min(available - picture.minimum - label.minimum, Math.max(planned, renderedMinimum));
      const followers = automatic ? [compactTrack(picture), compactTrack(label)] : [picture, label];
      requested = [first, ...allocateLaneSizes(available - first, followers, { fractional: true })];
    } else {
      requested = allocateLaneSizes(available, tracks, { fractional: true });
      if (stackDominates && requested[0] < renderedMinimum) {
        leading.minimum = renderedMinimum;
        requested = allocateLaneSizes(available, tracks, { fractional: true });
      }
    }
    const preferred = (planned === undefined ? leading.preferred : requested[0]) + picture.preferred + label.preferred;
    // Round the two leading boxes independently and give the last label the remaining pixels.
    const round = !automatic && available < preferred ? Math.floor : Math.round;
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

  function allocate(above, captions, packedDates) {
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
    return new Map(throughAllocations.map(scope => [scope.column, allocateThrough(scope, above, captions, packedDates)]));
  }

  return { register, registerThrough, captureThroughPreferred, allocate, minimumRows, widthFloors, fixedThroughWidths };
}
