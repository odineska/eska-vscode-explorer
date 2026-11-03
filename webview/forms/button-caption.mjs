import { buttonBackgroundShade } from './model.mjs';

/** Precompose onto the same discrete fill as CSS; browser alpha rounding differs. */
export function buttonCaptionPixels(raster, buttonHeight, foreground) {
  if (!Number.isInteger(buttonHeight) || buttonHeight < 3 || buttonHeight > 4096
      || foreground.length !== 3 || foreground.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('font-raster-color');
  }
  const top = Math.floor((buttonHeight + raster.ascent - raster.descent) / 2) - raster.ascent + raster.originY;
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let y = 0; y < raster.height; y++) {
    const back = buttonBackgroundShade(buttonHeight - 2, Math.max(0, Math.min(buttonHeight - 3, top + y - 1)));
    for (let x = 0; x < raster.width; x++) {
      const pixel = y * raster.width + x, alpha = raster.alpha[pixel];
      for (let channel = 0; channel < 3; channel++) rgba[pixel * 4 + channel] = Math.round(back + (foreground[channel] - back) * alpha / 255);
      rgba[pixel * 4 + 3] = 255;
    }
  }
  return { width: raster.width, height: raster.height, top, rgba };
}
