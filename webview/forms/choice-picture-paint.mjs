import { referenceButtonSlotWidth } from './model.mjs';

/** The divider owns one pixel of the slot. Smaller pictures keep their intrinsic size. */
export function choicePictureBounds(image, buttonHeight) {
  const width = referenceButtonSlotWidth - 1;
  const height = Math.floor(buttonHeight) - 2;
  if (height <= 0 || image.width <= 0 || image.height <= 0) return;
  const scale = Math.min(1, width / image.width, height / image.height);
  const drawnWidth = Math.max(1, Math.round(image.width * scale));
  const drawnHeight = Math.max(1, Math.round(image.height * scale));
  return {
    width: drawnWidth,
    height: drawnHeight,
    x: Math.floor((width - drawnWidth) / 2),
    y: Math.floor((height - drawnHeight) / 2),
  };
}

/** Linux reduces chroma before lightening the picture, preserving the alpha channel. */
export function inactiveChoicePicture(pixels) {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (!pixels[offset + 3]) continue;
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
    const mean = Math.floor((red + green + blue) / 3);
    const span = Math.max(red, green, blue) - Math.min(red, green, blue);
    const scale = span > 18 ? 18 / span : 1;
    const rgb = [red, green, blue].map(channel => mean + Math.floor((channel - mean) * scale + 1e-8));
    const gray = Math.floor((rgb[0] + rgb[1] + rgb[2]) / 3);
    const lift = 144 - Math.floor(gray * 3 / 4);
    for (const [channel, value] of rgb.entries()) {
      pixels[offset + channel] = gray === 255 ? 207 : value + lift;
    }
  }
}
