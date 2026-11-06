import { controlCaptionOptions } from './font-metrics.mjs';
import { buttonMetrics, fontLineMetrics } from './model.mjs';
import { paintTumblerCaptions, tumblerCaptionWidth } from './tumbler-caption.mjs';
import { tumblerPaint } from './tumbler-paint.mjs';

export function radioTumblerLayout(labels, columns, font) {
  if (!labels.length || !columns) return;
  const options = controlCaptionOptions(font);
  const advances = labels.map(label => tumblerCaptionWidth(label, options));
  if (advances.some(advance => advance === undefined)) return;

  const { lineHeight, verticalPadding } = buttonMetrics(font);
  const unitHeight = Math.max(23, lineHeight + 2 * verticalPadding + 2);
  const side = Math.round(fontLineMetrics(font).pixels * 9 / 13);
  const padding = Math.max(0, side - 2);
  const columnWidths = Array(columns).fill(0);
  for (const [index, advance] of advances.entries()) {
    const column = index % columns;
    columnWidths[column] = Math.max(columnWidths[column], advance + 2 * side);
  }
  let edge = 0;
  const ends = columnWidths.map(width => edge += width);
  const width = edge + columns + 1;
  const rowCount = Math.ceil(labels.length / columns);
  const height = rowCount === 1 ? unitHeight + 1 : rowCount * unitHeight;
  if (width * height > 1_048_576) return;
  const rows = [];
  for (let index = 0; index < rowCount; index++) {
    const labelsInRow = labels.slice(index * columns, (index + 1) * columns);
    const count = labelsInRow.length;
    const first = index === 0, last = index === rowCount - 1;
    // A short last row ends at the previous row's vertical separator.
    const rowWidth = count === columns ? width : ends[count - 1];
    const dividers = ends.slice(0, count - 1).map(x => x - 1);
    const rowHeight = first && !last ? unitHeight : unitHeight + 1;
    const top = first ? 0 : index * unitHeight - 1;
    const nextShort = labels.length - (index + 1) * columns < columns;
    const corners = [first, first, last, last || nextShort];
    const captions = labelsInRow.map((text, column) => {
      const left = column === 0 ? 1 : ends[column - 1];
      const right = dividers[column] ?? rowWidth - 1;
      return { left, right, limit: right - left - 2 * padding, padding, lines: [text] };
    });
    rows.push({ width: rowWidth, height: rowHeight, top, dividers, corners, captions });
  }
  return { width, height, advances, rows };
}

export function paintRadioTumbler(layout, font, face, colors, foreground) {
  const { width, height, rows } = layout;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const outside = [...colors.backdrop, 255];
  for (let i = 0; i < rgba.length; i += 4) rgba.set(outside, i);
  for (const { top, captions, ...row } of rows) {
    const image = tumblerPaint({ ...row, ...colors });
    if (!image) return;
    paintTumblerCaptions(image, captions, font, face, foreground);
    const stride = image.width * 4;
    for (let y = 0; y < image.height; y++) {
      rgba.set(image.rgba.subarray(y * stride, (y + 1) * stride), (top + y) * width * 4);
    }
  }
  return { width, height, rgba };
}
