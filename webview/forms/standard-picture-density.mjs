export function selectStandardPictureVariant(variants, zoom, pixelRatio) {
  const scale = zoom * pixelRatio;
  if (zoom === 100 || !variants || !Number.isFinite(scale) || scale <= 0) return;
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
