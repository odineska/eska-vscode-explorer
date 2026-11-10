import { groupPreferredSize } from './layout-model.mjs';
import { boxInsets } from './layout-box.mjs';

/** The scrolling grid does not determine the table's width inside an authored container. */
export function layoutTableWidths(model, { targets, alignment, os }, formWidth) {
  if (os !== 'linux') return;
  function visit(node, available, local) {
    const items = targets.containers.get(node.key);
    if (items && node.kind !== 'Form') {
      const width = groupPreferredSize(node, os).width;
      if (width) {
        available = Math.min(available ?? width, width);
        local = true;
      }
      if (available !== undefined) {
        const insets = boxInsets(getComputedStyle(items)).width + boxInsets(getComputedStyle(items.parentElement)).width;
        available = Math.max(0, available - insets);
      }
    }
    if (node.kind === 'Table') {
      const element = targets.elements.get(node.key);
      if (element && available !== undefined) {
        alignment.mark(element, 'data-table-width-bounded', local ? 'group' : 'form');
        alignment.style(element, '--taxi-table-width-budget', `${available}px`);
        const bar = element.querySelector(':scope > .taxi-table-field > [data-foldable-table-toolbar]:not([data-adaptive-table-toolbar])');
        if (bar) alignment.mark(bar, 'data-adaptive-table-toolbar');
      }
      return;
    }
    for (const child of node.children) visit(child, available, local);
  }
  visit(model, formWidth, false);
}
