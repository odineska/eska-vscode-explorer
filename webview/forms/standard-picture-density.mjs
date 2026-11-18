export function standardPicturePixelScale(zoom, pixelRatio) {
  const scale = zoom * pixelRatio;
  if (zoom !== 100 && Number.isFinite(scale) && scale > 0) return scale / 100;
}
