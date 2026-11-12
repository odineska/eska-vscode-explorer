import { allocateLaneSizes, cappedTrackGrowth, fitCaptionWidths, roundTrackWidths } from './layout-model.mjs';
import { fieldCaptionOccupiedWidth } from './font-metrics.mjs';

const sum = widths => widths.reduce((total, width) => total + width, 0);

/** The Linux Designer checks the last word against a 240px caption measure at 96 DPI. */
export function retainsFullPageTitle(caption) {
  const breakWidth = 240;
  if (caption.preferred <= breakWidth || caption.paragraphs.length !== 1) return false;
  const { characters, edges } = caption.paragraphs[0];
  const lastSpace = characters.lastIndexOf(' ');
  return lastSpace >= 0 && edges[lastSpace] <= breakWidth;
}

/** Keep a preferred caption as wide as possible beside the other fixed column. */
function retainCaption(width, first, second) {
  const leading = Math.max(first.minimum, Math.min(first.maximum, width - second.minimum));
  return [leading, Math.max(second.minimum, Math.min(second.maximum, width - leading))];
}

/** Allocate the upper captions in a fixed string and numeric/date pair with side tabs. */
export function fixedTopPageTracks(width, fitWidth, fields, lanes, { requestedRowWidth, retainText, automatic }) {
  const text = fields[0].kind === 'string' ? 0 : 1;
  const input = lanes[text], peer = lanes[1 - text];
  const order = sizes => text === 0 ? sizes : sizes.reverse();
  const full = input.maximum + peer.maximum;
  const fitsFull = fitWidth >= full - 3;
  const scroll = fitsFull && width < full;
  const minimum = retainText && requestedRowWidth >= input.maximum ? input.maximum + peer.minimum : undefined;
  const nominalSizes = minimum ? order(retainCaption(fitWidth, input, peer)) : undefined;
  if (scroll && !automatic) {
    const reductions = cappedTrackGrowth(full - width, lanes.map(lane => ({
      weight: lane.maximum, limit: lane.maximum - lane.minimum,
    })));
    const sizes = roundTrackWidths(lanes.map((lane, index) => lane.maximum - reductions[index]));
    return { sizes, scroll, minimum, nominalSizes };
  }
  if (minimum) return { sizes: order(retainCaption(width, input, peer)), scroll, minimum, nominalSizes };

  const compact = Math.max(input.minimum, fields[text].caption.compact);
  const compactWidth = compact + peer.maximum;
  if (retainText && !fitsFull && fitWidth >= compactWidth - 3) {
    const [peerWidth, textWidth] = retainCaption(width, peer, input);
    return { sizes: order([textWidth, peerWidth]), scroll: width < compactWidth,
      nominalSizes: order([compact, peer.maximum]) };
  }
  return { sizes: allocateLaneSizes(width, lanes), scroll, divider: width > input.minimum + peer.minimum + 2 };
}

/** Fit caption lines against the nominal width, then allocate the painted width. */
export function fixedCaptionTracks(available, tracks, fitWidth = available, retainedCaption) {
  const values = tracks.map(({reserve, value}) => reserve + value.preferred);
  const profiles = tracks.map(({caption}) => caption);
  const reserve = sum(values), preferred = sum(profiles.map(caption => caption.preferred));
  const budget = available - reserve, fitBudget = fitWidth - reserve;
  let sizes;
  if (fitBudget >= preferred) {
    // Only the painted tabs intrude into an otherwise unwrapped row.
    const reductions = cappedTrackGrowth(Math.max(0, preferred - budget), profiles.map(caption => ({
      weight: retainedCaption === undefined ? 1 : caption.preferred, limit: caption.preferred - caption.minimum,
    })));
    sizes = profiles.map((caption, index) => caption.preferred - reductions[index]);
  } else if (retainedCaption !== undefined) {
    const bounds = profiles.map(({minimum, preferred}) => ({ minimum, maximum: preferred }));
    sizes = retainCaption(budget, bounds[retainedCaption], bounds[1 - retainedCaption]);
    if (retainedCaption === 1) sizes.reverse();
  } else {
    const provisional = allocateLaneSizes(fitBudget, profiles, { fractional: true });
    const wrapped = profiles.map((caption, index) => Math.max(caption.minimum,
      fieldCaptionOccupiedWidth(caption, Math.round(provisional[index]))));
    const retained = [...wrapped];
    let spare = fitBudget - sum(wrapped);
    for (let index = retained.length - 1; index >= 0; index--) {
      const extra = profiles[index].preferred - retained[index];
      if (extra > spare) break;
      retained[index] += extra;
      spare -= extra;
    }
    const remaining = budget - sum(retained);
    const adjustments = cappedTrackGrowth(Math.abs(remaining), retained.map((width, index) => remaining >= 0
      ? { weight: width, limit: profiles[index].preferred - width }
      : { weight: 1, limit: width - wrapped[index] }));
    sizes = retained.map((width, index) => width + Math.sign(remaining) * adjustments[index]);
  }
  return roundTrackWidths(sizes).map((caption, index) => ({ width: values[index] + caption, caption }));
}

/** Allocate captions and value boxes within horizontal field tracks, excluding the group gap. */
export function narrowCaptionTracks(available, tracks, fitWidth = available) {
  const fit = fitCaptionWidths(fitWidth, tracks);
  if (fit) return allocateFittedTracks(tracks, fit, available - fitWidth);
}

// The Linux inline rows retain this proportional width at the limits measured for wrapped captions.
const wrappedInlineWidthFactor = 1.04;

/** Allocate the constrained caption and value tracks of a mixed inline row. */
export function narrowInlineCaptionTracks(available, tracks) {
  const fit = fitCaptionWidths(available, tracks);
  if (!fit) return;
  const { captions, minimumValues, valueSpace } = fit;
  const wrapped = tracks.map(({ caption }, index) => captions[index] < caption.preferred);
  if (wrapped.filter(Boolean).length < 2) return allocateFittedTracks(tracks, fit);

  const limits = tracks.flatMap(({ caption, value }, index) => {
    const width = captions[index];
    const captionLimit = wrapped[index]
      ? Math.min(caption.preferred - 1, Math.round(width * wrappedInlineWidthFactor)) : width;
    const valueLimit = wrapped[index]
      ? Math.min(value.maximum, Math.round(value.preferred * wrappedInlineWidthFactor)) : value.preferred;
    return [
      { weight: width, limit: captionLimit - width },
      { weight: value.preferred - value.minimum + caption.preferred - width, limit: valueLimit - value.minimum },
    ];
  });
  const space = valueSpace - minimumValues;
  const growth = roundTrackWidths(cappedTrackGrowth(space, limits), Math.floor);
  const fitted = tracks.map((track, index) => ({
    ...track, value: { ...track.value, preferred: track.value.minimum + growth[index * 2 + 1] },
  }));
  const titles = captions.map((width, index) => width + growth[index * 2]);
  return growCaptionTracks(space - sum(growth), fitted, titles);
}

function allocateFittedTracks(tracks, { captions, preferredValues, minimumValues, valueSpace }, offset = 0) {
  valueSpace = Math.max(minimumValues, valueSpace + offset);
  const spare = valueSpace - preferredValues;
  if (spare < 0) {
    const widths = cappedTrackGrowth(valueSpace - minimumValues, tracks.map(({caption, shrinkCaptionWidth = caption.compact, value}, index) => {
      const limit = value.preferred - value.minimum;
      return { limit, weight: limit + Math.max(0, shrinkCaptionWidth - captions[index]) };
    }));
    const growth = roundTrackWidths(widths, Math.floor);
    return tracks.map(({reserve, value}, index) => ({
      width: reserve + captions[index] + value.minimum + growth[index],
      caption: captions[index],
    }));
  }

  return growCaptionTracks(spare, tracks, captions);
}

function growCaptionTracks(spare, tracks, captions) {
  const widths = cappedTrackGrowth(spare, tracks.map(({caption, reserve, value}, index) => {
    const captionRoom = caption.preferred - captions[index], valueRoom = value.maximum - value.preferred;
    return { limit: captionRoom + valueRoom, weight: valueRoom > 0 ? captions[index] + reserve + value.preferred : captions[index] };
  }));
  const growths = roundTrackWidths(widths);
  return tracks.map(({caption, captionInset = 0, reserve, value}, index) => {
    const growth = growths[index];
    const captionRoom = caption.preferred - captions[index], valueRoom = value.maximum - value.preferred;
    const captionWeight = captions[index] + captionInset / 2;
    const share = valueRoom > 0 ? captionWeight / (captionWeight + value.preferred) : 1;
    const captionGrowth = Math.min(captionRoom, Math.max(growth - valueRoom, Math.round(growth * share)));
    return { width: reserve + captions[index] + value.preferred + growth, caption: captions[index] + captionGrowth };
  });
}
