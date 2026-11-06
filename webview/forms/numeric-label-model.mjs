import { cappedTrackGrowth, fitCaptionWidths, roundTrackWidths } from './layout-model.mjs';

/** Allocate captions and value boxes within horizontal numeric tracks, excluding the group gap. */
export function narrowNumericTracks(available, tracks) {
  const fit = fitCaptionWidths(available, tracks);
  if (!fit) return;
  const { captions, valueSpace, preferredValues, minimumValues } = fit;
  const spare = valueSpace - preferredValues;
  if (spare < 0) {
    const widths = cappedTrackGrowth(valueSpace - minimumValues, tracks.map(({caption, value}, index) => {
      const limit = value.preferred - value.minimum;
      return { limit, weight: limit + Math.max(0, caption.compact - captions[index]) };
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
  return tracks.map(({caption, reserve, value}, index) => {
    const growth = growths[index];
    const captionRoom = caption.preferred - captions[index], valueRoom = value.maximum - value.preferred;
    const share = valueRoom > 0 ? captions[index] / (captions[index] + value.preferred) : 1;
    const captionGrowth = Math.min(captionRoom, Math.max(growth - valueRoom, Math.round(growth * share)));
    return { width: reserve + captions[index] + value.preferred + growth, caption: captions[index] + captionGrowth };
  });
}
