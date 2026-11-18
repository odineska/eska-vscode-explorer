import { measureRootCommands } from './root-command-layout.mjs';
import { allocateLaneSizes } from './layout-model.mjs';
import { borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';

/** Linux command-only rows share spare width in proportion to their painted content. */
export function commandBarLayout(root, { os, scale, alignment }) {
  const rows = [];
  const minima = new Map(), commands = [];
  if (os === 'linux') for (const bar of root.querySelectorAll('.taxi-command-bar[data-form-command-overflow]')) {
    const layout = measureRootCommands(bar, scale);
    minima.set(bar, layout.minimumWidth + boxInsets(getComputedStyle(bar)).width);
    commands.push(layout);
  }
  if (os === 'linux') for (const items of root.querySelectorAll('.taxi-items[data-layout-owner]')) {
    const children = [...items.children];
    if (items.hasAttribute('data-united-horizontal-lane')) continue;
    if (!children.length || children.some(child => child.dataset.kind !== 'CommandBar')) continue;
    alignment.mark(items, 'data-native-command-row');
    for (const child of children) alignment.style(child, '--taxi-command-allocation', '');
    rows.push({ items, children });
  }
  function allocate(bounds) {
    for (const { items, children } of rows) {
      if (getComputedStyle(items).display !== 'flex') {
        for (const child of children) child.style.removeProperty('--taxi-command-allocation');
        continue;
      }
      const gap = pixels(getComputedStyle(items).columnGap);
      const available = borderBoxSize(items, scale).width - gap * (children.length - 1);
      const tracks = children.map(child => {
        const minimum = bounds.get(child.dataset.element)?.width ?? 0;
        return { preferred: minimum, minimum, growthWeight: child.dataset.stretchX === 'true' ? Math.max(0, minimum - 2) : 0,
          maximum: child.dataset.stretchX === 'true' ? Infinity : minimum };
      });
      const widths = allocateLaneSizes(available, tracks);
      for (const [index, child] of children.entries()) updateStyle(child, '--taxi-command-allocation', `${widths[index]}px`);
    }
    for (const command of commands) command.allocate();
  }
  return { minima, allocate };
}
