const f32 = Math.fround;
const TARGET = 7;

function luminance(rgb) {
  const [r, g, b] = rgb.map(value => {
    const channel = value / 255;
    return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return r * .2126 + g * .7152 + b * .0722;
}
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
const gray = lightness => Math.floor(f32(lightness * 255) + .5);

/** Taxi adjusts the standard gray, then its HSL mirror, then float32 lightness. */
export function primaryForeground(background) {
  if (!Array.isArray(background) || background.length !== 3
      || background.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('primary-button-color');
  }
  const back = luminance(background);
  const score = value => contrast(back, luminance([value, value, value]));
  if (score(77) >= TARGET) return 77;
  const mirror = gray(f32(1 - f32(77 / 255)));
  if (score(mirror) >= TARGET) return mirror;
  let low = 0, high = 1, lowerScore = score(0), upperScore = score(255), lightness = high;
  const reachable = lowerScore > TARGET || upperScore > TARGET;
  // The .01 band belongs to the native contrast search, not pixel comparison.
  // Preserve the last midpoint even when float32 endpoint convergence stops it.
  for (let i = 0; i < 32 && (lowerScore > TARGET || upperScore > TARGET); i++) {
    lightness = f32(f32(high + low) * .5);
    if (Math.abs(lightness - high) < 2 ** -23 || Math.abs(lightness - low) < 2 ** -23) break;
    const current = score(gray(lightness));
    if (current > 6.99 && current < 7.01) break;
    if ((current < TARGET) === (upperScore > lowerScore)) { low = lightness; lowerScore = current; }
    else { high = lightness; upperScore = current; }
  }
  return reachable ? gray(lightness) : Math.abs(score(0) - TARGET) > Math.abs(score(255) - TARGET) ? 255 : 0;
}
