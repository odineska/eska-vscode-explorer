import { number } from './model.mjs';

/** Recalculate the drawing's coordinates at its allocated CSS size; never scale a previous bitmap. */
export function allocatedSurfaceMetrics(preferred, allocation, node) {
  if (!preferred || !allocation || allocation.width <= 2 || allocation.height <= 2) return preferred;
  const width = allocation.width, height = allocation.height;
  if (width === preferred.width && height === preferred.height) return preferred;
  const safe = Number.isInteger(width) && Number.isInteger(height) && width <= 4096 && height <= 4096 && width * height <= 4194304;
  const result = { ...preferred, width, height, calibrated: preferred.calibrated && safe };
  if (node.kind === 'CalendarField') {
    if (number(node, 'WidthInMonths', 1) === 0) {
      const panel = preferred.monthsPanel ? preferred.panelWidth + 7 : 0;
      result.columns = Math.max(1, Math.min(12, Math.floor((width - 27 - panel) / (preferred.cellWidth * 7 + 17))));
    }
    if (number(node, 'HeightInMonths', 1) === 0) {
      const footer = preferred.currentDate && !preferred.monthsPanel ? preferred.rowHeight + 6 : 0;
      result.rows = Math.max(1, Math.min(12, Math.floor((height - 17 - footer) / (preferred.rowHeight * 8 + 7))));
    }
  }
  return result;
}
