/** LCD glyphs blend separately: rounding a combined mask changes overlapping pixels. */
export function lcdCaptionPixels(raster, foreground, background) {
  if ([foreground, background].some(rgb => rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255))) {
    throw new Error('font-raster-color');
  }
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    rgba[pixel] = background[0]; rgba[pixel + 1] = background[1]; rgba[pixel + 2] = background[2]; rgba[pixel + 3] = 255;
  }
  for (const glyph of raster.glyphs) {
    for (let y = 0; y < glyph.rows; y++) for (let x = 0; x < glyph.columns; x++) {
      const tx = glyph.pen + glyph.left + x - raster.originX, ty = raster.ascent - glyph.top + y - raster.originY;
      if (tx < 0 || tx >= raster.width || ty < 0 || ty >= raster.height) continue;
      const index = (ty * raster.width + tx) * 4, source = (y * glyph.columns + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const back = rgba[index + channel], alpha = glyph.coverage[source + channel];
        rgba[index + channel] = Math.round(back + (foreground[channel] - back) * alpha / 255);
      }
    }
  }
  return rgba;
}
