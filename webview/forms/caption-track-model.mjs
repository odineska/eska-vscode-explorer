import { cappedTrackGrowth, fitCaptionWidths, roundTrackWidths } from './layout-model.mjs';

/** Share a shortfall between captions while retaining the widths of their fixed controls. */
export function fixedCaptionTracks(available, tracks) {
  const preferred = tracks.reduce((sum, {caption, reserve, value}) => sum + caption.preferred + reserve + value.preferred, 0);
  const reductions = cappedTrackGrowth(Math.max(0, preferred - available), tracks.map(({caption}) => ({
    weight: 1, limit: caption.preferred - caption.minimum,
  })));
  const captions = roundTrackWidths(tracks.map(({caption}, index) => caption.preferred - reductions[index]));
  return tracks.map(({reserve, value}, index) => ({
    width: reserve + captions[index] + value.preferred, caption: captions[index],
  }));
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
