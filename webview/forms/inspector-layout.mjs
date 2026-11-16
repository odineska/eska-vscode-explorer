const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const separator = 4, minimumHeight = 84, previewMinimum = 125, horizontalSeparator = 5;

/** Preserve the divider settings for each of the two editor layouts. */
export function inspectorLayout(size, ui, detached = false) {
  const viewportWidth = Math.max(1, finite(size.width, 0));
  const available = finite(size.height, 0) - finite(size.toolbar, 34) - finite(size.status, 23);
  const maximumHeight = Math.max(minimumHeight, available - (detached ? 0 : horizontalSeparator + previewMinimum));
  const [structure, data, properties] = viewportWidth >= 740 ? [180, 225, 210] : [144, 155, 176];
  if (detached) {
    const width = Math.max(viewportWidth, structure + data + separator);
    const first = clamp(finite(ui.detachedLeft, 45) * width / 100, structure + separator, width - data);
    const maximumTreeHeight = Math.max(minimumHeight, maximumHeight - horizontalSeparator - minimumHeight);
    const treeHeight = clamp(finite(ui.detachedUpper, 230), minimumHeight, maximumTreeHeight);
    return { mode: 'detached', width, height: maximumHeight, minimumHeight, maximumHeight,
      tracks: first - separator + 'px ' + separator + 'px ' + (width - first) + 'px',
      left: first * 100 / width, leftMinimum: (structure + separator) * 100 / width, leftMaximum: (width - data) * 100 / width,
      treeHeight, maximumTreeHeight };
  }
  const height = clamp(finite(ui.upper, 230), minimumHeight, maximumHeight);
  const width = Math.max(viewportWidth, structure + data + properties + 2 * separator);
  const first = clamp(finite(ui.left, 30) * width / 100, structure + separator, width - data - properties - separator);
  const second = clamp(finite(ui.right, 66) * width / 100, first + data + separator, width - properties);
  return { mode: 'columns', width, height, minimumHeight, maximumHeight,
    tracks: [first - separator, separator, second - first - separator, separator, width - second].map(value => value + 'px').join(' '),
    left: first * 100 / width, right: second * 100 / width,
    leftMinimum: (structure + separator) * 100 / width, leftMaximum: (second - data - separator) * 100 / width,
    rightMinimum: (first + data + separator) * 100 / width, rightMaximum: (width - properties) * 100 / width };
}
