/** LCD glyphs blend separately: rounding a combined mask changes overlapping pixels. */
export function lcdCaptionPixels(raster, foreground, background, underline = false) {
  if ([foreground, background].some(rgb => rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255))) {
    throw new Error('font-raster-color');
  }
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    rgba[pixel] = background[0]; rgba[pixel + 1] = background[1]; rgba[pixel + 2] = background[2]; rgba[pixel + 3] = 255;
  }
  paintLcdGlyphs({ rgba, width: raster.width, height: raster.height }, raster.glyphs, foreground,
    -raster.originX, raster.ascent - raster.originY);
  // The calibrated Taxi link draws one solid row at the baseline across the advance.
  if (underline) {
    const y = raster.ascent - raster.originY;
    if (y >= 0 && y < raster.height) for (let pen = 0; pen < raster.advance; pen++) {
      const x = pen - raster.originX;
      if (x < 0 || x >= raster.width) continue;
      const index = (y * raster.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) rgba[index + channel] = foreground[channel];
    }
  }
  return rgba;
}

/** Blend into the actual face pixels, which can vary across a control's gradient. */
export function paintLcdGlyphs({ rgba, width, height }, glyphs, foreground, x, baseline,
  [left, top, right, bottom] = [0, 0, width, height]) {
  const x0 = Math.max(0, left), y0 = Math.max(0, top);
  const x1 = Math.min(width, right), y1 = Math.min(height, bottom);
  for (const glyph of glyphs) {
    for (let row = 0; row < glyph.rows; row++) {
      const ty = baseline - glyph.top + row;
      if (ty < y0 || ty >= y1) continue;
      for (let column = 0; column < glyph.columns; column++) {
        const tx = x + glyph.pen + glyph.left + column;
        if (tx < x0 || tx >= x1) continue;
        const index = (ty * width + tx) * 4, source = (row * glyph.columns + column) * 3;
        for (let channel = 0; channel < 3; channel++) {
          const back = rgba[index + channel], alpha = glyph.coverage[source + channel];
          rgba[index + channel] = Math.round(back + (foreground[channel] - back) * alpha / 255);
        }
      }
    }
  }
}
