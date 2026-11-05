import { buttonBackgroundShade } from './model.mjs';

/** Precompose onto the same discrete fill as CSS; browser alpha rounding differs. */
export function buttonCaptionPixels(raster, buttonHeight, foreground, background = [255, 255, 255]) {
  if (!Number.isInteger(buttonHeight) || buttonHeight < 3 || buttonHeight > 4096
      || [foreground, background].some(color => !Array.isArray(color) || color.length !== 3
        || color.some(value => !Number.isInteger(value) || value < 0 || value > 255))) {
    throw new Error('font-raster-color');
  }
  const top = Math.floor((buttonHeight + raster.ascent - raster.descent) / 2) - raster.ascent + raster.originY;
  const rgba = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let y = 0; y < raster.height; y++) {
    const row = Math.max(0, Math.min(buttonHeight - 3, top + y - 1));
    const back = background.map(value => buttonBackgroundShade(buttonHeight - 2, row, value));
    for (let x = 0; x < raster.width; x++) {
      const pixel = y * raster.width + x, alpha = raster.alpha[pixel];
      for (let channel = 0; channel < 3; channel++) {
        rgba[pixel * 4 + channel] = Math.round(back[channel] + (foreground[channel] - back[channel]) * alpha / 255);
      }
      rgba[pixel * 4 + 3] = 255;
    }
  }
  return { width: raster.width, height: raster.height, top, rgba };
}

/** Native six-by-three dropdown stencil over the same discrete button fill. */
export function buttonArrowPixels(foreground, background) {
  const alpha=[128,255,255,255,255,127,0,128,255,255,127,0,0,0,128,127,0,0];
  if([foreground,background].some(color=>!Array.isArray(color)||color.length!==3||color.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new Error('button-arrow-color');
  const rgba=new Uint8ClampedArray(6*3*4);
  for(let y=0;y<3;y++)for(let x=0;x<6;x++){
    const index=y*6+x,back=background.map(value=>buttonBackgroundShade(24,12+y,value));
    for(let channel=0;channel<3;channel++)rgba[index*4+channel]=Math.round(back[channel]+(foreground[channel]-back[channel])*alpha[index]/255);
    rgba[index*4+3]=255;
  }
  return rgba;
}
