import metrics from '../../resources/forms/fonts/advances.json' with { type: 'json' };

/** Grid-fitted advances of the unmodified bundled Linux fonts, in CSS pixels. */
export function hintedTextWidth(text, { family, pixels, weight, italic }) {
  const name = family === 'ESKA Taxi Sans' ? 'Sans' : family === 'ESKA Taxi Serif' ? 'Serif' : family === 'ESKA Taxi Mono' ? 'Mono' : undefined;
  if (!name || !Number.isInteger(pixels) || pixels < metrics.minPixels || pixels > metrics.maxPixels) return;
  const style = `${Number(weight) > 500 ? 'Bold' : ''}${italic ? 'Italic' : ''}` || 'Regular';
  const face = metrics.faces[`Liberation${name}-${style}.ttf`];
  let width = 0;
  for (const char of text) {
    const index = face.characters[char];
    // A fallback font or contextual shaping needs the browser's measurement.
    if (index === undefined || /[\p{Mark}\p{Format}]/u.test(char)) return;
    const [units, differences] = face.classes[index];
    width += Math.round(units * pixels / face.units) + (differences[pixels] ?? 0);
  }
  return width;
}
