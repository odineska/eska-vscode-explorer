import { cappedTrackGrowth, fitCaptionWidths, roundTrackWidths } from './layout-model.mjs';

/** Preserve the minimum value width while compressing titles in a horizontal row of columns. */
export function narrowInputLaneWidths(available, tracks) {
  const fit = fitCaptionWidths(available, tracks, true);
  if (!fit) return;
  const { captions, valueSpace, preferredValues, minimumValues } = fit;
  const automatic = tracks.every(track => track.growthWeight !== undefined);
  const spare = valueSpace - preferredValues;

  if (spare < 0) {
    const limits = tracks.map(({caption, value}, index) => {
      const limit = value.preferred - value.minimum;
      const titleRoom = caption.preferred - captions[index];
      const weight = automatic ? limit + 8 + titleRoom : limit + Math.max(0, titleRoom - 1);
      return { limit, weight };
    });
    const growth = roundTrackWidths(cappedTrackGrowth(valueSpace - minimumValues, limits));
    return tracks.map(({reserve, value}, index) => ({
      caption: captions[index], width: reserve + captions[index] + value.minimum + growth[index],
    }));
  }

  const controls = [], titles = [];
  for (const [index, track] of tracks.entries()) {
    const caption = captions[index], room = track.caption.preferred - caption;
    const valueWeight = automatic ? track.valueWeight : track.value.preferred - 1;
    controls.push({ limit: track.value.maximum - track.value.preferred,
      weight: room > 0 ? valueWeight : track.growthWeight ?? valueWeight });
    titles.push({ limit: room, weight: caption * valueWeight / (2 * track.valueWeight) });
  }
  const titleGrowth = roundTrackWidths(cappedTrackGrowth(spare, [...titles, ...controls]).slice(0, tracks.length));
  const remaining = spare - titleGrowth.reduce((sum, width) => sum + width, 0);
  const growth = roundTrackWidths(cappedTrackGrowth(remaining, controls));
  return tracks.map(({reserve, value}, index) => ({
    caption: captions[index] + titleGrowth[index],
    width: reserve + captions[index] + titleGrowth[index] + value.preferred + growth[index],
  }));
}
