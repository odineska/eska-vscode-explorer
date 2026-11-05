const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const separator = 4, firstMinimum = 120, secondMinimum = 120, propertiesMinimum = 180;
const minimumHeight = 84, previewMinimum = 96, horizontalSeparator = 5;

/** Clamp displayed chrome to its container without overwriting the saved panel preferences. */
export function inspectorLayout(size, ui) {
  const width = Math.max(firstMinimum + secondMinimum + propertiesMinimum + 2 * separator, finite(size.width, 0));
  const first = clamp(finite(ui.left, 40) * width / 100, firstMinimum + separator, width - secondMinimum - propertiesMinimum - separator);
  const second = clamp(finite(ui.right, 65) * width / 100, first + secondMinimum + separator, width - propertiesMinimum);
  const maximumHeight = Math.max(minimumHeight, finite(size.height, 0) - finite(size.toolbar, 34) - finite(size.status, 23) - horizontalSeparator - previewMinimum);
  return {
    height: clamp(finite(ui.upper, 230), minimumHeight, maximumHeight), minimumHeight, maximumHeight, width,
    tracks: `${first - separator}px ${separator}px ${second - first - separator}px ${separator}px ${width - second}px`,
    left: first * 100 / width, right: second * 100 / width,
    leftMinimum: (firstMinimum + separator) * 100 / width, leftMaximum: (second - secondMinimum - separator) * 100 / width,
    rightMinimum: (first + secondMinimum + separator) * 100 / width, rightMaximum: (width - propertiesMinimum) * 100 / width,
  };
}
