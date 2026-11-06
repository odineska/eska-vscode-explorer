import { number, numericLabelMetrics } from './model.mjs';
import { ordinaryGroup, automaticHorizontalSpacing, controlBounds, stretches } from './layout-model.mjs';
import { borderBoxSize, boxInsets, pixels } from './layout-box.mjs';

/** Numeric labels stretch from their measured row widths and stop at each value's limit. */
export function alignNumericLabelRows(model, { targets, alignment, os, collapsed, scale }) {
  if (os !== 'linux') return;
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;

  function visit(node) {
    const items = containers.get(node.key);
    const group = items?.parentElement;
    const owner = elements.get(node.key);
    const children = mountedChildren(node);
    if (group && owner && ordinaryGroup(node) && node.presentation.grouping === 'Horizontal'
        && !group.querySelector(':scope > .taxi-group-title') && number(node, 'Width') <= 0
        && children.length && children.every(child => numericLabelMetrics(child, os))) {
      mark(items, 'data-numeric-label-row');
      if (automaticHorizontalSpacing(node)) mark(items, 'data-numeric-label-auto-spacing');
      const tracks = children.map(child => {
        const element = elements.get(child.key);
        const preferred = borderBoxSize(element, scale).width;
        const control = element.querySelector('.taxi-label-field');
        if (!stretches(child, 'x', collapsed)) return { element, preferred, maximum: preferred };
        const bounds = controlBounds(child, 'x', undefined, os);
        const reserve = preferred - borderBoxSize(control, scale).width;
        return { element, preferred, maximum: reserve + (bounds.maximum ?? Infinity) };
      });
      for (const track of tracks) {
        style(track.element, '--taxi-numeric-label-grow', String(track.preferred));
        if (Number.isFinite(track.maximum)) style(track.element, '--taxi-numeric-label-track-max', `${track.maximum}px`);
      }
      if (tracks.every(track => Number.isFinite(track.maximum))) {
        const css = getComputedStyle(items);
        const insets = boxInsets(css).width + boxInsets(getComputedStyle(group)).width;
        const gap = pixels(css.columnGap) * (tracks.length - 1);
        const maximum = tracks.reduce((sum, track) => sum + track.maximum, insets + gap);
        mark(owner, 'data-numeric-label-row-owner');
        style(owner, '--taxi-numeric-label-row-max', `${maximum}px`);
      }
    }
    for (const child of node.children) visit(child);
  }

  visit(model);
}
