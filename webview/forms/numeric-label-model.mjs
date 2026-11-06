import { controlCaptionOptions, designTextAdvances } from './font-metrics.mjs';

function captionParagraph(text, options) {
  const characters = [...text];
  const advances = designTextAdvances(text, options);
  if (!advances) return;
  const edges = [0];
  for (const advance of advances) edges.push(edges.at(-1) + advance);
  const preferred = edges.at(-1);
  let minimum = 0, compact = preferred, word = 0;
  for (let index = 0; index < characters.length; index++) {
    if (characters[index] !== ' ') continue;
    minimum = Math.max(minimum, edges[index] - edges[word]);
    compact = Math.min(compact, Math.max(edges[index], preferred - edges[index + 1]));
    word = index + 1;
  }
  minimum = Math.max(minimum, preferred - edges[word]);
  return { characters, edges, minimum, compact, preferred };
}

/** The minimum keeps each word intact. The compact width fits a paragraph on two lines. */
export function numericCaptionProfile(text, font) {
  const options = controlCaptionOptions(font);
  const paragraphs = text.split(/\r\n?|\n/u).map(line => captionParagraph(line, options));
  if (paragraphs.some(paragraph => !paragraph)) return;
  const width = kind => paragraphs.reduce((size, paragraph) => Math.max(size, paragraph[kind]), 0);
  return { paragraphs, minimum: width('minimum'), compact: width('compact'), preferred: width('preferred') };
}

/** A parenthesized suffix keeps the break space in its width but starts at the left edge. */
export function numericCaptionLines(profile, width) {
  return profile.paragraphs.flatMap(({characters, edges}) => {
    if (!characters.length) return [''];
    const lines = [];
    let start = 0;
    while (start < characters.length) {
      while (characters[start] === ' ' && characters[start + 1] !== '(') start++;
      if (start >= characters.length) break;
      let end = start, boundary = start;
      while (end < characters.length && (end === start || edges[end + 1] - edges[start] <= width)) {
        if (characters[end] === ' ' && end > start + Number(characters[start] === ' ')) boundary = end;
        end++;
      }
      if (end < characters.length && characters[end] !== ' ' && boundary > start) end = boundary;
      const line = characters.slice(start, end).join('').trim();
      if (line) lines.push(line);
      start = end;
    }
    return lines.length ? lines : [''];
  });
}

const total = values => values.reduce((sum, value) => sum + value, 0);

function distribute(space, limits) {
  const active = limits.map(({weight, limit}, index) => ({weight, limit, index}))
    .filter(({weight, limit}) => weight > 0 && limit > 0)
    .sort((left, right) => left.limit / left.weight - right.limit / right.weight);
  const widths = limits.map(() => 0);
  let weight = total(active.map(track => track.weight)), first = 0;
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

/** Allocate captions and value boxes within horizontal numeric tracks, excluding the group gap. */
export function narrowNumericTracks(available, tracks) {
  const insets = total(tracks.map(track => track.reserve));
  const preferredValues = total(tracks.map(track => track.value.preferred));
  const minimumValues = total(tracks.map(track => track.value.minimum));
  const preferred = insets + preferredValues + total(tracks.map(track => track.caption.preferred));
  if (available >= preferred) return;

  const captions = tracks.map(track => track.caption.minimum);
  let captionTotal = total(captions);
  available = Math.max(available - insets, captionTotal + minimumValues);
  // A third line can be removed once the minimum captions and preferred values fit.
  for (let index = tracks.length - 1; index >= 0; index--) {
    const delta = tracks[index].caption.compact - captions[index];
    if (available >= captionTotal + preferredValues && available >= captionTotal + delta + minimumValues) {
      captions[index] += delta;
      captionTotal += delta;
    }
  }
  // Retain full captions from the trailing side while their preferred values fit.
  for (let index = tracks.length - 1; index >= 0; index--) {
    const delta = tracks[index].caption.preferred - captions[index];
    if (available >= captionTotal + delta + preferredValues) {
      captions[index] += delta;
      captionTotal += delta;
    }
  }

  const spare = available - captionTotal - preferredValues;
  if (spare < 0) {
    const widths = distribute(available - captionTotal - minimumValues, tracks.map(({caption, value}, index) => {
      const limit = value.preferred - value.minimum;
      return { limit, weight: limit + Math.max(0, caption.compact - captions[index]) };
    }));
    let used = 0;
    return tracks.map(({reserve, value}, index) => {
      const before = Math.floor(used + 1e-7);
      used += widths[index];
      const valueWidth = value.minimum + Math.floor(used + 1e-7) - before;
      return { width: reserve + captions[index] + valueWidth, caption: captions[index] };
    });
  }

  const widths = distribute(spare, tracks.map(({caption, reserve, value}, index) => {
    const captionRoom = caption.preferred - captions[index], valueRoom = value.maximum - value.preferred;
    return { limit: captionRoom + valueRoom, weight: valueRoom > 0 ? captions[index] + reserve + value.preferred : captions[index] };
  }));
  let used = 0;
  return tracks.map(({caption, reserve, value}, index) => {
    const before = Math.round(used);
    used += widths[index];
    const growth = Math.round(used) - before;
    const captionRoom = caption.preferred - captions[index], valueRoom = value.maximum - value.preferred;
    const share = valueRoom > 0 ? captions[index] / (captions[index] + value.preferred) : 1;
    const captionGrowth = Math.min(captionRoom, Math.max(growth - valueRoom, Math.round(growth * share)));
    return { width: reserve + captions[index] + value.preferred + growth, caption: captions[index] + captionGrowth };
  });
}
