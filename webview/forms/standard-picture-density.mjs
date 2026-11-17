export function standardPicturePixelScale(zoom, pixelRatio) {
  const scale = zoom * pixelRatio;
  if (zoom !== 100 && Number.isFinite(scale) && scale > 0) return scale / 100;
}

export function selectStandardPictureVariant(variants, zoom, pixelRatio) {
  if (!variants || !standardPicturePixelScale(zoom, pixelRatio)) return;
  const scale = zoom * pixelRatio;
  let best, distance = Infinity;
  for (const variant of variants) {
    // Match the web client's relative distance, including its bias toward larger rasters.
    const relative = variant.scale < scale ? scale / variant.scale : variant.scale / scale - 0.01;
    if (relative < distance) {
      best = variant;
      distance = relative;
    }
  }
  return best;
}
