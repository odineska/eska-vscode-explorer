/** Average the covered source cells in premultiplied color so thin marks survive scaling. */
export function scaleRaster(image, width, height) {
  if (width === image.width && height === image.height) return image;
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Measure overlap on an integer grid to avoid rounding source-cell boundaries.
  const cellArea = image.width * image.height;
  for (let y = 0; y < height; y++) {
    const top = y * image.height, bottom = top + image.height;
    for (let x = 0; x < width; x++) {
      const left = x * image.width, right = left + image.width;
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sy = Math.floor(top / height); sy < Math.ceil(bottom / height); sy++) {
        const rows = Math.min(bottom, (sy + 1) * height) - Math.max(top, sy * height);
        for (let sx = Math.floor(left / width); sx < Math.ceil(right / width); sx++) {
          const columns = Math.min(right, (sx + 1) * width) - Math.max(left, sx * width);
          const from = (sy * image.width + sx) * 4;
          const coverage = rows * columns * image.rgba[from + 3];
          red += coverage * image.rgba[from];
          green += coverage * image.rgba[from + 1];
          blue += coverage * image.rgba[from + 2];
          alpha += coverage;
        }
      }
      const to = (y * width + x) * 4;
      rgba[to + 3] = Math.round(alpha / cellArea);
      if (!rgba[to + 3]) continue;
      rgba[to] = Math.round(red / alpha);
      rgba[to + 1] = Math.round(green / alpha);
      rgba[to + 2] = Math.round(blue / alpha);
    }
  }
  return { width, height, rgba };
}
