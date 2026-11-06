function mixInactiveCaption(foreground, backgroundValue, backgroundSaturation) {
  const high = Math.max(...foreground), range = high - Math.min(...foreground);
  const value = (high + backgroundValue) / 2;
  const saturation = ((high ? range / high : 0) + backgroundSaturation) / 2;
  return foreground.map(channel => Math.round(range ? value * (1 - saturation * (high - channel) / range) : value));
}

export function inactiveTumblerTextColor(foreground, fill) {
  // The tumbler blends against the face after lowering its RGB levels.
  const fillHigh = Math.max(0, Math.max(...fill) - 76);
  const fillLow = Math.max(0, Math.min(...fill) - 76);
  return mixInactiveCaption(foreground, fillHigh, fillHigh ? (fillHigh - fillLow) / fillHigh : 0);
}

export function inactiveRadioTextColor(foreground, backdrop) {
  // The ordinary radio mixes against a lightened, less saturated backdrop.
  const high = Math.max(...backdrop), low = Math.min(...backdrop);
  return mixInactiveCaption(foreground, Math.round((high + 255) / 2), high ? (high - low) / (2 * high) : 0);
}
