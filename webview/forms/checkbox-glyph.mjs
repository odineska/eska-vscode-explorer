import measurements from './checkbox-raster.json' with { type: 'json' };

/** The black and white 96-DPI measurements give each pixel's contribution over a solid surface. */
export function checkboxGlyph(mode, inactive, backdrop) {
  const { width, height, active, inactive: muted } = measurements[mode];
  const { palette, rows } = inactive ? muted : active;
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
