import { borderBoxSize, boxInsets, pixels } from './layout-box.mjs';

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
  const minimumWidth = collapses ? tail : widths.reduce((sum, value) => sum + value, Math.max(0, widths.length - 1) * gap);
  return {
    minimumWidth,
    allocate() {
      if (!collapses) return;
      const available = borderBoxSize(bar, scale).width - boxInsets(getComputedStyle(bar)).width;
      const visible = fitCommandPrefix(widths, available, tail, gap);
      entries.forEach((entry, index) => entry.toggleAttribute('data-root-command-hidden', index >= visible));
    },
  };
}
