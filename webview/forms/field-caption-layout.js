import { fieldCaptionLines } from './font-metrics.mjs';
import { pixels, updateStyle } from './layout-box.mjs';

// Designer leaves one extra pixel between a field's caption track and its control.
export const inputCaptionInset = 1;

export function throughCaptionWidth(element) {
  const items = element.parentElement;
  const mode = items.dataset.throughLabels;
  return mode === 'all' || mode === 'leading' && items.firstElementChild === element
    ? pixels(items.style.getPropertyValue('--taxi-through-label-width')) : 0;
}

/** Allocate the label track while keeping its original accessible name. */
export function allocateFieldCaption(captions, { element, key, caption }, width, inset = 0) {
  updateStyle(element, '--taxi-field-caption-width', width === undefined ? '' : `${width + inset}px`);
  if (width === undefined || width >= caption.preferred) return false;
  const lines = fieldCaptionLines(caption, width);
  if (lines.length < 2) return false;
  captions.set(key, lines.join('\n'));
  return true;
}
