const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const separator = 4, dataMinimum = 225, propertiesMinimum = 210;
const columnMinimums = [180, dataMinimum, propertiesMinimum];
const compactColumnMinimums = [148, 172, 176];
const minimumHeight = 84, previewMinimum = 96, horizontalSeparator = 5;

/** Choose the inspector tracks from its own webview size and keep the user's proportions on resize. */
export function inspectorLayout(size, ui, detached = false) {
  const viewportWidth = Math.max(1, finite(size.width, 0));
  const available = finite(size.height, 0) - finite(size.toolbar, 34) - finite(size.status, 23);
  const maximumHeight = Math.max(minimumHeight, available - (detached ? 0 : horizontalSeparator + previewMinimum));
  const height = detached ? maximumHeight : clamp(finite(ui.upper, 230), minimumHeight, maximumHeight);
  if (detached || viewportWidth >= 740) {
    const [structure, data, properties] = viewportWidth >= 740 ? columnMinimums : compactColumnMinimums;
    const width = Math.max(viewportWidth, structure + data + properties + 2 * separator);
    const first = clamp(finite(ui.left, 30) * width / 100, structure + separator, width - data - properties - separator);
    const second = clamp(finite(ui.right, 66) * width / 100, first + data + separator, width - properties);
    return { mode: 'columns', width, height, minimumHeight, maximumHeight,
      tracks: `${first - separator}px ${separator}px ${second - first - separator}px ${separator}px ${width - second}px`,
      left: first * 100 / width, right: second * 100 / width,
      leftMinimum: (structure + separator) * 100 / width, leftMaximum: (second - data - separator) * 100 / width,
      rightMinimum: (first + data + separator) * 100 / width, rightMaximum: (width - properties) * 100 / width,
    };
  }
  const width = viewportWidth;
  if (width >= 475) {
    const minimum = dataMinimum + separator, maximum = width - propertiesMinimum;
    const boundary = clamp(finite(ui.compactRight, 56) * width / 100, minimum, maximum);
    return { mode: 'compact', width, height, minimumHeight, maximumHeight,
      tracks: `${boundary - separator}px ${separator}px ${width - boundary}px`, right: boundary * 100 / width,
      rightMinimum: minimum * 100 / width, rightMaximum: maximum * 100 / width };
  }
  return { mode: 'compactStacked', width, height, minimumHeight, maximumHeight,
    tracks: 'minmax(0, 1fr)' };
}
