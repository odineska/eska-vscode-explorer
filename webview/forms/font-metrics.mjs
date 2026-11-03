import metrics from '../../resources/forms/fonts/advances.json' with { type: 'json' };

/** Hinted advances and rounded unattenuated kerning of the bundled Linux fonts. */
export function hintedTextWidth(text, { family, pixels, weight, italic }) {
  const name = family === 'ESKA Taxi Sans' ? 'Sans' : family === 'ESKA Taxi Serif' ? 'Serif' : family === 'ESKA Taxi Mono' ? 'Mono' : undefined;
  if (!name || !Number.isInteger(pixels) || pixels < metrics.minPixels || pixels > metrics.maxPixels) return;
  const style = `${Number(weight) > 500 ? 'Bold' : ''}${italic ? 'Italic' : ''}` || 'Regular';
  const face = metrics.faces[`Liberation${name}-${style}.ttf`];
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
