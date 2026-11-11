import { allocateLaneSizes, cappedTrackGrowth, fitCaptionWidths, roundTrackWidths } from './layout-model.mjs';
import { fieldCaptionOccupiedWidth } from './font-metrics.mjs';

const sum = widths => widths.reduce((total, width) => total + width, 0);

/** Fit caption lines against the nominal width, then allocate the painted width. */
export function fixedCaptionTracks(available, tracks, fitWidth = available) {
  const values = tracks.map(({reserve, value}) => reserve + value.preferred);
  const profiles = tracks.map(({caption}) => caption);
  const reserve = sum(values), preferred = sum(profiles.map(caption => caption.preferred));
  const budget = available - reserve, fitBudget = fitWidth - reserve;
  let sizes;
  if (fitBudget >= preferred) {
    // Only the painted tabs intrude into an otherwise unwrapped row.
    const reductions = cappedTrackGrowth(Math.max(0, preferred - budget), profiles.map(caption => ({
      weight: 1, limit: caption.preferred - caption.minimum,
    })));
    sizes = profiles.map((caption, index) => caption.preferred - reductions[index]);
  } else {
    const provisional = allocateLaneSizes(fitBudget, profiles, { fractional: true });
    const wrapped = profiles.map((caption, index) => Math.max(caption.minimum,
      fieldCaptionOccupiedWidth(caption, Math.round(provisional[index]))));
    const retained = [...wrapped];
    let spare = fitBudget - sum(wrapped);
    for (let index = retained.length - 1; index >= 0; index--) {
      const extra = profiles[index].preferred - retained[index];
      if (extra > spare) continue;
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
  if (!fit) return;
  const { captions, preferredValues, minimumValues } = fit;
  const valueSpace = Math.max(minimumValues, fit.valueSpace + available - fitWidth);
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
