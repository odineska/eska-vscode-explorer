import { number, numericLabelMetrics } from './model.mjs';
import { ordinaryGroup, automaticHorizontalSpacing, controlBounds, stretches } from './layout-model.mjs';
import { availableTrackWidth, borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { narrowNumericTracks } from './numeric-label-model.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, throughCaptionWidth } from './field-caption-layout.js';

/** Numeric labels grow to their value limits and wrap their titles within the available row. */
export function alignNumericLabelRows(model, { targets, alignment, os, collapsed, scale }) {
  if (os !== 'linux') return;
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const allocations = [], minimumCaptions = new Map();

  function row(node, items, group, owner, children) {
    mark(items, 'data-numeric-label-row');
    if (automaticHorizontalSpacing(node)) mark(items, 'data-numeric-label-auto-spacing');
    const tracks = children.map(child => {
      const element = elements.get(child.key);
      const preferred = borderBoxSize(element, scale).width;
      const control = element.querySelector('.taxi-label-field');
      const valueWidth = borderBoxSize(control, scale).width;
      const stretch = stretches(child, 'x', collapsed);
      const bounds = stretch ? controlBounds(child, 'x', undefined, os) : {};
      const title = element.querySelector('.taxi-field-label')?.getAttribute('aria-label') ?? '';
      const caption = fieldCaptionProfile(title, child.presentation.titleFont);
      const value = { preferred:valueWidth, minimum:bounds.minimum ?? valueWidth, maximum:stretch ? bounds.maximum ?? Infinity : valueWidth };
      return { key:child.key, element, preferred, caption, value, stretch,
        reserve:preferred - valueWidth - (caption?.preferred ?? 0), maximum:preferred - valueWidth + value.maximum };
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
    if (tracks.some(track => track.stretch) && tracks.every(track => track.caption)
        && tracks.some(track => track.caption.minimum < track.caption.preferred)) {
      allocations.push({items, tracks});
      style(items, '--taxi-numeric-label-align', '');
      for (const track of tracks) {
        minimumCaptions.set(track.key, Math.max(track.caption.minimum, throughCaptionWidth(track.element)));
        style(track.element, '--taxi-numeric-label-allocation', '');
        style(track.element, '--taxi-field-caption-width', '');
      }
    }
  }

  function visit(node) {
    const items = containers.get(node.key);
    const group = items?.parentElement;
    const owner = elements.get(node.key);
    const children = mountedChildren(node);
    if (group && owner && ordinaryGroup(node) && node.presentation.grouping === 'Horizontal'
        && !group.querySelector(':scope > .taxi-group-title') && number(node, 'Width') <= 0
        && children.length && children.every(child => numericLabelMetrics(child, os))) row(node, items, group, owner, children);
    for (const child of node.children) visit(child);
  }

  visit(model);
  return {
    minimumCaptions,
    allocateWidths(captions) {
      const widths = allocations.map(({items, tracks}) => narrowNumericTracks(availableTrackWidth(items, tracks.length, scale), tracks));
      for (const [index, {items, tracks}] of allocations.entries()) {
        let wrapped = false;
        for (const [column, track] of tracks.entries()) {
          const size = widths[index]?.[column];
          updateStyle(track.element, '--taxi-numeric-label-allocation', size ? `0 0 ${size.width}px` : '');
          if (allocateFieldCaption(captions, track, size?.caption)) wrapped = true;
        }
        updateStyle(items, '--taxi-numeric-label-align', wrapped ? 'start' : '');
      }
    },
  };
}
