import { borderBoxSize, boxInsets, pixels, textWidth, updateStyle } from './layout-box.mjs';
import { throughCaptionWidth } from './field-caption-layout.js';
import { sideTabRepresentation } from './tab-metrics.mjs';
import { sideTabWidths } from './page-fit-layout.js';

const widthWithHeadings = value => value.fullWidth ?? value.width;
const widthWithSideCaptions = value => value.sideWidth ?? value.width;
const maximumWidth = value => value.maximumWidth ?? Infinity;

function reserveWidth(value, width, fullWidth = width) {
  value.fullWidth = Math.max(widthWithHeadings(value), fullWidth);
  value.sideWidth = Math.max(widthWithSideCaptions(value), width);
  value.width = Math.max(value.width, width);
  value.maximumWidth = Math.max(maximumWidth(value), fullWidth);
}

/** Measure logical flow boxes, excluding absolute native borders, shadows and selection overlays. */
export function minimumFormLayout(root, scale, { minimumCaptions, minimumInputs, commandWidth, minimumRows, widthFloors, fixedThroughWidths, headingHeights, available, conditionalWidth }) {
  const minima = new Map(), headingFloors = new Map();
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
  const add = (value, spacing) => ({ width: value.width + spacing.width,
    fullWidth: widthWithHeadings(value) + widthWithHeadings(spacing),
    sideWidth: widthWithSideCaptions(value) + widthWithSideCaptions(spacing),
    maximumWidth: maximumWidth(value) + spacing.width, height: value.height + spacing.height });
  function items(element) {
    if (!element) return { width: 0, maximumWidth: 0, height: 0 };
    const elements = [...element.children].filter(child => child.classList.contains('taxi-element'));
    const children = elements.map(item);
    const reflows = conditionalWidth && element.dataset.grouping === 'HorizontalIfPossible';
    const horizontal = element.hasAttribute('data-united-columns') || getComputedStyle(element).display === 'flex';
    const css = getComputedStyle(element), gap = pixels(horizontal ? css.columnGap : css.rowGap) * Math.max(0, children.length - 1);
    // A conditional row can use the widest child's minimum when stacked.
    const width = sizeOf => horizontal && !reflows
      ? children.reduce((sum, child) => sum + sizeOf(child), gap)
      : Math.max(0, ...children.map((child, index) => sizeOf(child) - (reflows && horizontal
        ? pixels(elements[index].style.getPropertyValue('--taxi-group-spacing-x')) : 0)));
    const value = { width: width(child => child.width), fullWidth: width(widthWithHeadings),
      sideWidth: width(widthWithSideCaptions), height: horizontal
      ? Math.max(0, ...children.map(value => value.height)) : children.reduce((sum, value) => sum + value.height, gap) };
    value.maximumWidth = horizontal ? children.reduce((sum, child) => sum + maximumWidth(child), gap)
      : Math.max(0, ...children.map(maximumWidth));
    const padding = insets(element);
    if (element.hasAttribute('data-united-columns')) {
      // Use the allocator's lower bound for this row, including independent captions.
      const laneMinimum = pixels(element.style.getPropertyValue('--taxi-input-lane-minimum'));
      if (laneMinimum && !reflows) value.width = value.fullWidth = value.sideWidth = laneMinimum + gap;
    }
    if (element.hasAttribute('data-united-columns') || element.hasAttribute('data-fixed-date-row')) {
      value.height = Math.max(value.height, size(element).height - padding.height);
    }
    if (element.dataset.nativePageScroll === 'true') {
      value.height = pixels(css.getPropertyValue('--taxi-page-row-height'));
    }
    const minimum = minimumRows.get(element);
    if (minimum !== undefined && !reflows) value.width = value.fullWidth = value.sideWidth = minimum;
    const floor = widthFloors.get(element);
    if (floor !== undefined) reserveWidth(value, floor);
    if (fixedThroughWidths.size) {
      for (const [index, child] of elements.entries()) {
        const through = fixedThroughWidths.get(child);
        if (!through) continue;
        const bounds = children[index];
        reserveWidth(value, bounds.width + through.trailingMinimum, widthWithHeadings(bounds) + through.trailingMinimum);
      }
    }
    const measured = add(add(value, padding), margins(element));
    const titleMaximum = pixels(element.style.getPropertyValue('--taxi-page-title-maximum'));
    if (titleMaximum) measured.maximumWidth = titleMaximum;
    return measured;
  }
  function item(element) {
    const field = element.querySelector(':scope > .taxi-field-row'), group = element.querySelector(':scope > .taxi-group');
    const pages = element.querySelector(':scope > .taxi-pages'), table = element.querySelector(':scope > .taxi-table-field');
    let value;
    if (field) {
      const label = field.querySelector(':scope > .taxi-field-label'), control = field.querySelector(':scope > .taxi-field-control');
      const child = control?.firstElementChild, content = child ? marginBox(child) : { width: 0, height: 0 };
      content.height += pixels(element.style.getPropertyValue('--taxi-input-title-offset'));
      const title = label ? marginBox(label) : { width: 0, height: 0 }, location = field.dataset.titleLocation;
      if (label && location === 'Left') title.width = Math.max(title.width, throughCaptionWidth(element));
      const fullTitleWidth = title.width;
      if (label && location === 'Left') title.width = minimumCaptions.get(element.dataset.element) ?? fullTitleWidth;
      const vertical = ['Top', 'Bottom'].includes(location), css = getComputedStyle(field);
      const gap = label ? pixels(css[vertical ? 'rowGap' : 'columnGap']) : 0;
      const padding = boxInsets(css);
      const rowHeight = height => (vertical ? title.height + gap + height : Math.max(title.height, height)) + padding.height;
      value = {
        width: (vertical ? Math.max(title.width, content.width) : title.width + gap + content.width) + padding.width,
        height: Math.max(rowHeight(content.height), pixels(css.minHeight)),
      };
      const inputMinimum = minimumInputs.get(element.dataset.element);
      if (inputMinimum) {
        if (inputMinimum.aboveWidth !== undefined) value.width = inputMinimum.aboveWidth + padding.width;
        value.sideWidth = Math.max(value.width, content.width + inputMinimum.alignedCaption + inputMinimum.gap + padding.width);
      }
      const widthLimit = pixels(element.style.getPropertyValue('--taxi-control-max-width'));
      if (widthLimit && child?.classList.contains('taxi-input')) {
        const controlWidth = widthLimit + margins(child).width;
        value.maximumWidth = (vertical ? Math.max(fullTitleWidth, controlWidth)
          : fullTitleWidth + gap + controlWidth) + padding.width;
      }
      if (element.hasAttribute('data-horizontal-input-limit')) {
        // Keep the caption outside the control limit when allocating the entire field.
        const reserve = vertical ? 0 : value.width - content.width;
        element.style.setProperty('--taxi-horizontal-input-reserve', `${reserve}px`);
      }
    } else if (table) {
      const children = [...table.children].map(marginBox), spacing = insets(table);
      const controlWidth = pixels(getComputedStyle(table).minWidth);
      const width = element.hasAttribute('data-table-width-bounded') ? controlWidth
        : Math.max(controlWidth, ...children.map(value => value.width + spacing.width));
      value = { width,
        height: children.reduce((sum, value) => sum + value.height, spacing.height) };
    } else if (group) {
      value = items(group.querySelector(':scope > .taxi-items'));
      const title = group.querySelector(':scope > .taxi-group-title');
      if (title) {
        const height = (headingHeights.get(title) ?? size(title).height) + margins(title).height;
        if (group.hasAttribute('data-united-horizontal-title')) value.height = Math.max(value.height, height);
        else value.height += height;
        const preferred = textWidth(title, scale);
        reserveWidth(value, Number(title.dataset.nativeHeadingMinimum ?? preferred), preferred);
      }
      value = add(value, insets(group));
      if (element.hasAttribute('data-compact-command-bars')) {
        reserveWidth(value, pixels(element.style.getPropertyValue('--taxi-group-width')));
      }
      if (element.hasAttribute('data-authored-group-height')) {
        value.height = Math.max(value.height, pixels(element.style.getPropertyValue('--taxi-group-height')));
      }
    } else if (pages) {
      const panels = [...pages.querySelectorAll(':scope > .taxi-page-stack > .taxi-page')]
        .map(page => ({ page, content: page.querySelector(':scope > .taxi-items') }));
      const children = panels.map(({page, content}) => add(items(content), add(insets(page), margins(page))));
      value = { width: Math.max(0, ...children.map(value => value.width)), fullWidth: Math.max(0, ...children.map(widthWithHeadings)),
        sideWidth: Math.max(0, ...children.map(widthWithSideCaptions)),
        height: Math.max(0, ...children.map(value => value.height)) };
      const tabs = pages.querySelector(':scope > .taxi-tabs');
      const side = sideTabRepresentation(pages.dataset.representation);
      const rail = side ? sideTabWidths(tabs, scale) : undefined;
      if (tabs) {
        const box = marginBox(tabs);
        if (side) {
          const width = rail?.nominal ?? box.width;
          value.fullWidth += width;
          value.sideWidth += width;
          value.width += width;
          if (rail && !pages.hasAttribute('data-authored-side-stretch')) {
            value.maximumWidth = Math.max(0, ...children.map(maximumWidth)) + rail.nominal;
          }
        } else value.height += box.height;
      }
      value = add(value, insets(pages));
      if (tabs?.dataset.sideFitMinimum !== undefined) {
        const authored = pixels(element.style.getPropertyValue('--taxi-group-width'));
        value.maximumWidth = Math.max(value.maximumWidth, widthWithHeadings(value), authored);
        const compactTitles = panels.some(({content}) => content?.style.getPropertyValue('--taxi-page-title-maximum'));
        const limit = (element.dataset.stretchX === 'true' || compactTitles) && Number.isFinite(value.maximumWidth)
          ? `${value.maximumWidth}px` : 'none';
        updateStyle(pages, '--taxi-side-page-maximum', limit);
      }
    } else {
      const child = element.firstElementChild;
      value = child ? marginBox(child) : { width: 0, height: 0 };
      if (child?.hasAttribute('data-native-decoration')) value.width = Number(child.dataset.decorationMinimum) + insets(child).width;
    }
    const inlineMinimum = pixels(element.style.getPropertyValue('--taxi-inline-track-minimum'));
    if (inlineMinimum) value.width = value.fullWidth = value.sideWidth = inlineMinimum;
    const columnWidth = pixels(element.style.getPropertyValue('--taxi-united-cell-min-width')
      || element.style.getPropertyValue('--taxi-united-cell-width'));
    reserveWidth(value, columnWidth);
    if (element.dataset.layoutContainer === 'true') {
      if (element.dataset.stretchX === 'false' && !element.hasAttribute('data-group-shrink-x')) {
        reserveWidth(value, pixels(element.style.getPropertyValue('--taxi-preferred-width')));
      }
      if (element.dataset.stretchY === 'false') value.height = Math.max(value.height, pixels(element.style.getPropertyValue('--taxi-preferred-height')));
    }
    const spacing = { width: pixels(element.style.getPropertyValue('--taxi-group-spacing-x')),
      height: pixels(element.style.getPropertyValue('--taxi-group-spacing-y')) };
    if (element.dataset.stretchX === 'false') value.maximumWidth = widthWithHeadings(value);
    value = add(value, spacing);
    value.maximumWidth = Math.max(value.maximumWidth, widthWithHeadings(value));
    minima.set(element.dataset.element, value);
    if (value.fullWidth > value.width) headingFloors.set(element, value);
    element.style.setProperty('--taxi-min-width', `${value.width - spacing.width}px`);
    element.style.setProperty('--taxi-min-height', `${value.height - spacing.height}px`);
    return value;
  }
  const content = root.querySelector(':scope > .taxi-form-content'), title = root.querySelector(':scope > .taxi-form-title');
  const value = items(content.querySelector(':scope > .taxi-form-scrollport > .taxi-items'));
  const commands = content.querySelector(':scope > .taxi-root-commands');
  const itemsHeight = value.height, rootInsets = insets(root), chromeHeight = rootInsets.height + size(title).height;
  if (commands) {
    reserveWidth(value, commandWidth ?? 0);
    value.height += marginBox(commands).height;
  }
  const minimum = add(add(value, insets(content)), { width: rootInsets.width, height: chromeHeight });
  if (headingFloors.size && minimum.fullWidth <= available + .5) {
    // Preserve a single-line heading while the whole frame can fit at that width.
    minimum.width = minimum.fullWidth;
    for (const [element, bounds] of headingFloors) {
      bounds.width = bounds.fullWidth;
      element.style.setProperty('--taxi-min-width', `${bounds.width - pixels(element.style.getPropertyValue('--taxi-group-spacing-x'))}px`);
    }
  }
  return { minimum, minima, itemsHeight, chromeHeight };
}
