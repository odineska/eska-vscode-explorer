import { borderBoxSize, boxInsets, pixels, textWidth } from './layout-box.mjs';
import { throughCaptionWidth } from './field-caption-layout.js';

/** Measure logical flow boxes, excluding absolute native borders, shadows and selection overlays. */
export function minimumFormLayout(root, scale = 1, minimumCaptions) {
  const minima = new Map();
  const size = element => borderBoxSize(element, scale);
  const margins = element => {
    const css = getComputedStyle(element);
    return { width: pixels(css.marginLeft) + pixels(css.marginRight), height: pixels(css.marginTop) + pixels(css.marginBottom) };
  };
  const marginBox = element => {
    const value = size(element), margin = margins(element);
    return { width: value.width + margin.width, height: value.height + margin.height };
  };
  const insets = element => boxInsets(getComputedStyle(element));
  const add = (value, spacing) => ({ width: value.width + spacing.width, height: value.height + spacing.height });
  function items(element) {
    if (!element) return { width: 0, height: 0 };
    const children = [...element.children].filter(child => child.classList.contains('taxi-element')).map(item);
    const horizontal = element.hasAttribute('data-united-columns') || getComputedStyle(element).display === 'flex';
    const css = getComputedStyle(element), gap = pixels(horizontal ? css.columnGap : css.rowGap) * Math.max(0, children.length - 1);
    const value = horizontal
      ? { width: children.reduce((sum, value) => sum + value.width, gap), height: Math.max(0, ...children.map(value => value.height)) }
      : { width: Math.max(0, ...children.map(value => value.width)), height: children.reduce((sum, value) => sum + value.height, gap) };
    const padding = insets(element);
    if (element.hasAttribute('data-united-columns')) {
      // Use the allocator's lower bound for this row, including independent captions.
      const laneMinimum = pixels(element.style.getPropertyValue('--taxi-input-lane-minimum'));
      if (laneMinimum) value.width = laneMinimum + gap;
      value.height = Math.max(value.height, size(element).height - padding.height);
    }
    return add(value, padding);
  }
  function item(element) {
    const field = element.querySelector(':scope > .taxi-field-row'), group = element.querySelector(':scope > .taxi-group');
    const pages = element.querySelector(':scope > .taxi-pages'), table = element.querySelector(':scope > .taxi-table-field');
    let value;
    if (field) {
      const label = field.querySelector(':scope > .taxi-field-label'), control = field.querySelector(':scope > .taxi-field-control');
      const child = control?.firstElementChild, content = child ? marginBox(child) : { width: 0, height: 0 };
      const title = label ? marginBox(label) : { width: 0, height: 0 }, location = field.dataset.titleLocation;
      if (label && location === 'Left') {
        title.width = minimumCaptions.get(element.dataset.element) ?? Math.max(title.width, throughCaptionWidth(element));
      }
      const vertical = ['Top', 'Bottom'].includes(location), gap = label ? pixels(getComputedStyle(field)[vertical ? 'rowGap' : 'columnGap']) : 0;
      value = vertical ? { width: Math.max(title.width, content.width), height: title.height + gap + content.height }
        : { width: title.width + gap + content.width, height: Math.max(title.height, content.height) };
      value = add(value, insets(field));
      if (element.hasAttribute('data-horizontal-input-limit')) {
        // Keep the caption outside the control limit when allocating the entire field.
        const reserve = vertical ? 0 : value.width - content.width;
        element.style.setProperty('--taxi-horizontal-input-reserve', `${reserve}px`);
      }
      value.height = Math.max(value.height, pixels(getComputedStyle(field).minHeight));
    } else if (table) {
      const children = [...table.children].map(marginBox);
      value = { width: Math.max(pixels(getComputedStyle(table).minWidth), ...children.map(value => value.width)),
        height: children.reduce((sum, value) => sum + value.height, 0) };
    } else if (group) {
      value = items(group.querySelector(':scope > .taxi-items'));
      const title = group.querySelector(':scope > .taxi-group-title');
      if (title) {
        const box = marginBox(title);
        if (group.hasAttribute('data-united-horizontal-title')) value.height = Math.max(value.height, box.height);
        else value.height += box.height;
        value.width = Math.max(value.width, textWidth(title, scale));
      }
      value = add(value, insets(group));
    } else if (pages) {
      const children = [...pages.querySelectorAll(':scope > .taxi-page-stack > .taxi-page')].map(page => add(items(page.querySelector(':scope > .taxi-items')), add(insets(page), margins(page))));
      value = { width: Math.max(0, ...children.map(value => value.width)), height: Math.max(0, ...children.map(value => value.height)) };
      const tabs = pages.querySelector(':scope > .taxi-tabs');
      if (tabs) {
        const box = marginBox(tabs), side = ['TabsOnLeftHorizontal','TabsOnRightHorizontal'].includes(pages.dataset.representation);
        if (side) value.width += box.width; else value.height += box.height;
      }
      value = add(value, insets(pages));
    } else {
      const child = element.firstElementChild;
      value = child ? marginBox(child) : { width: 0, height: 0 };
    }
    const columnWidth = pixels(element.style.getPropertyValue('--taxi-united-cell-width'));
    value.width = Math.max(value.width, columnWidth);
    if (element.dataset.layoutContainer === 'true') {
      if (element.dataset.stretchX === 'false') value.width = Math.max(value.width, pixels(element.style.getPropertyValue('--taxi-preferred-width')));
      if (element.dataset.stretchY === 'false') value.height = Math.max(value.height, pixels(element.style.getPropertyValue('--taxi-preferred-height')));
    }
    minima.set(element.dataset.element, value);
    element.style.setProperty('--taxi-min-width', `${value.width}px`);
    element.style.setProperty('--taxi-min-height', `${value.height}px`);
    return value;
  }
  const content = root.querySelector(':scope > .taxi-form-content'), title = root.querySelector(':scope > .taxi-form-title');
  const value = items(content.querySelector(':scope > .taxi-items')), commands = content.querySelector(':scope > .taxi-root-commands');
  if (commands) {
    const box = marginBox(commands), children = [...commands.children].map(marginBox), gap = pixels(getComputedStyle(commands).columnGap);
    const width = children.reduce((sum, child) => sum + child.width, Math.max(0, children.length - 1) * gap);
    value.width = Math.max(value.width, width); value.height += box.height;
  }
  return { minimum: add(add(value, insets(content)), { width: insets(root).width, height: insets(root).height + size(title).height }), minima };
}
