import { borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';

export function fitCommandPrefix(items, available, tail, gap) {
  let remaining = available - tail;
  let count = 0;
  for (const width of items) {
    remaining -= width + (count || tail ? gap : 0);
    if (remaining < -.01) break;
    count++;
  }
  return count;
}

/** Measure all commands in the preferred pass, then reuse their widths on viewport resize. */
export function measureRootCommands(bar, scale) {
  if (!bar) return;
  const { columnGap } = getComputedStyle(bar);
  const gap = pixels(columnGap);
  const entries = [...bar.querySelectorAll(':scope > [data-root-command]')];
  const width = element => {
    const style = getComputedStyle(element);
    return borderBoxSize(element, scale).width + pixels(style.marginInlineStart) + pixels(style.marginInlineEnd);
  };
  const widths = entries.map(width);
  const trailing = [...bar.querySelectorAll(':scope > [data-root-command-tail]')];
  const tail = trailing.reduce((sum, element) => sum + width(element), Math.max(0, trailing.length - 1) * gap);
  const collapses = bar.hasAttribute('data-root-command-overflow');
  const centered = bar.dataset.rootCommandAlignment === 'Center';
  const usedWidth = count => widths.slice(0, count).reduce((sum, width) => sum + width,
    tail + Math.max(0, count - (tail ? 0 : 1)) * gap);
  const minimumWidth = collapses ? tail : usedWidth(widths.length);
  return {
    minimumWidth,
    allocate() {
      if (!collapses) {
        entries.forEach(entry => entry.removeAttribute('data-root-command-hidden'));
        if (!centered) return;
      }
      const style = getComputedStyle(bar);
      // Centering adds an inset after fitting. Always fit against the entire command area.
      const available = borderBoxSize(bar, scale).width - boxInsets(style).width + pixels(style.paddingInlineStart);
      const visible = collapses ? fitCommandPrefix(widths, available, tail, gap) : widths.length;
      if (collapses) entries.forEach((entry, index) => entry.toggleAttribute('data-root-command-hidden', index >= visible));
      if (centered) {
        const offset = Math.max(0, Math.floor((available - usedWidth(visible)) / 2));
        updateStyle(bar, '--taxi-root-command-inset', `${offset}px`);
      }
    },
  };
}
