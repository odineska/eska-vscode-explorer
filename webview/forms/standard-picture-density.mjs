export function standardPicturePixelScale(zoom, pixelRatio, includeBaseZoom = false) {
  const scale = zoom * pixelRatio;
  if ((includeBaseZoom || zoom !== 100) && Number.isFinite(scale) && scale > 0) return scale / 100;
}

export function selectStandardPictureDensity(densities, zoom, pixelRatio) {
  const scale = zoom * pixelRatio;
  if (!Number.isFinite(scale) || scale <= 0) return;
  let best, distance = Infinity;
  for (const density of densities) {
    // The platform compares relative distance and slightly favors the larger raster.
    const relative = density < scale ? scale / density : density / scale - 0.01;
    if (relative < distance) {
      best = density;
      distance = relative;
    }
  }
  return best;
}
