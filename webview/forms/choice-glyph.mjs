import checkboxes from './checkbox-raster.json' with { type: 'json' };
import radios from './radio-raster.json' with { type: 'json' };

export function checkboxGlyph(mode, inactive, backdrop) {
  const shape = checkboxes[mode];
  return glyph(shape, inactive ? shape.inactive : shape.active, backdrop);
}

export function radioGlyph(selected, inactive, backdrop) {
  const shape = selected ? radios.selected : radios.unselected;
  return glyph(radios, inactive ? shape.inactive : shape.active, backdrop);
}

/** The black and white 96-DPI measurements give each pixel's contribution over a solid surface. */
function glyph({ width, height }, { palette, rows }, backdrop) {
  const colors = palette.map(sample => [
    ...backdrop.map((channel, index) => sample[index] + Math.round(channel * (sample[index + 3] - sample[index]) / 255)),
    255,
  ]);
  const rgba = new Uint8ClampedArray(width * height * 4);
  let index = 0;
  for (const row of rows) {
    for (const [length, color] of row) {
      for (let pixel = 0; pixel < length; pixel++) {
        rgba.set(colors[color], index);
        index += 4;
      }
    }
  }
  return { width, height, rgba };
}
