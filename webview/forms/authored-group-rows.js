import { allocateLaneSizes } from './layout-model.mjs';
import { borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';

const allocatedRows = '--taxi-group-allocated-rows';
const resizableControl = [
  ':scope > .taxi-table-field:is([data-native-column-sizing],[data-native-dynamic-list]) > .taxi-table-scroll',
  ':scope > .taxi-field-row > .taxi-field-control > .taxi-input',
].join(', ');

/** Share the allocated height without reserving spare space past a control's limit. */
export function boundedGroupRows(root, scale, alignment) {
  const groups = [];
  for (const items of root.querySelectorAll('.taxi-items:not([data-united-items]):has(> .taxi-element:is([data-height-constrained], [data-capped-input-height]))')) {
    const elements = [...items.children].filter(element => element.classList.contains('taxi-element'));
    const stretched = elements.filter(element => element.dataset.stretchY === 'true');
    const constrained = stretched.length > 1 && stretched.some(element => element.hasAttribute('data-height-constrained'));
    if (!constrained && !stretched.some(element => element.hasAttribute('data-capped-input-height'))) continue;
    const controls = stretched.map(element => element.querySelector(resizableControl));
    if (controls.some(control => !control)) continue;
    const tracks = stretched.map((element, index) => ({ element, control: controls[index] }));
    const fixed = elements.filter(element => element.dataset.stretchY !== 'true');
    alignment.style(items, allocatedRows, '');
    groups.push({ items, elements, tracks, fixed });
  }
  return minima => {
    for (const { items, elements, tracks, fixed } of groups) {
      if (!items.classList.contains('taxi-items--vertical')) {
        updateStyle(items, allocatedRows, '');
        continue;
      }
      const css = getComputedStyle(items);
      const fixedHeight = fixed.reduce((sum, child) => sum + borderBoxSize(child, scale).height, 0);
      const gaps = pixels(css.rowGap) * (elements.length - 1);
      let available = borderBoxSize(items, scale).height - boxInsets(css).height - fixedHeight - gaps;
      const lanes = tracks.map(({ element, control }) => {
        const style = getComputedStyle(control);
        const minimum = pixels(style.minHeight);
        const maximum = Math.max(minimum, parseFloat(style.maxHeight) || Infinity);
        const natural = pixels(control.style.height);
        const reserve = Math.max(0, (minima.get(element.dataset.element)?.height ?? 0) - minimum);
        available -= reserve;
        return { minimum, maximum, preferred: Math.max(minimum, Math.min(natural, maximum)), growthWeight: natural, reserve };
      });
      const sizes = allocateLaneSizes(available, lanes);
      let index = 0;
      const rows = elements.map(element => {
        if (element.dataset.stretchY !== 'true') return 'max-content';
        const height = sizes[index] + lanes[index].reserve;
        index += 1;
        return `${height}px`;
      });
      updateStyle(items, allocatedRows, rows.join(' '));
    }
  };
}
