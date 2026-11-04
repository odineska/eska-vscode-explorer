import metrics from '../../resources/forms/fonts/advances.json' with { type: 'json' };

function selectFace({ family, pixels, weight, italic }) {
  const name = family === 'ESKA Taxi Sans' ? 'Sans' : family === 'ESKA Taxi Serif' ? 'Serif' : family === 'ESKA Taxi Mono' ? 'Mono' : undefined;
  if (!name || !Number.isInteger(pixels) || pixels < metrics.minPixels || pixels > metrics.maxPixels) return;
  const style = `${Number(weight) > 500 ? 'Bold' : ''}${italic ? 'Italic' : ''}` || 'Regular';
  return metrics.faces[`Liberation${name}-${style}.ttf`];
}

/** Hinted advances and rounded unattenuated kerning of the bundled Linux fonts. */
export function hintedTextWidth(text, options) {
  const face = selectFace(options), { pixels } = options;
  if (!face) return;
  let width = 0, previous = '';
  for (const char of text) {
    const index = face.characters[char];
    // A fallback font or contextual shaping needs the browser's measurement.
    if (index === undefined || /[\p{Mark}\p{Format}]/u.test(char)) return;
    const [units, differences] = face.classes[index];
    const pair = face.kerningPairs[previous + char];
    if (previous && pair !== undefined) {
      const [units, differences] = face.kerningClasses[pair];
      width += Math.round(units * pixels / face.units) + (differences[pixels] ?? 0);
    }
    width += Math.round(units * pixels / face.units) + (differences[pixels] ?? 0);
    previous = char;
  }
  return width;
}

/** Native form-title layout rounds the design advance and following pair together. */
export function designTextAdvances(text, options) {
  const face = selectFace(options), { pixels } = options;
  if (!face) return;
  const characters = [...text], output = [];
  for (const [position, char] of characters.entries()) {
    const index = face.characters[char];
    if (index === undefined || /[\p{Mark}\p{Format}]/u.test(char)) return;
    const units = face.classes[index][0], pair = face.kerningPairs[char + (characters[position + 1] ?? '')];
    const adjustment = pair === undefined ? 0 : face.kerningClasses[pair][0];
    output.push(Math.round((units + adjustment) * pixels / face.units));
  }
  return output;
}

/** Keep kerning inside each native caption fragment, never across fragment boundaries. */
export function segmentedTextAdvances(segments, options) {
  const result=[];
  for (const segment of segments) {
    const chars=[...segment];
    for (let index=0;index<chars.length;index++) {
      const next=chars[index+1]??'',pair=hintedTextWidth(chars[index]+next,options),following=next?hintedTextWidth(next,options):0;
      if (pair===undefined||following===undefined) return;
      result.push(pair-following);
    }
  }
  return result;
}
