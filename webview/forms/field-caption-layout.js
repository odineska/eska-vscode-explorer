import { fieldCaptionLines, fieldCaptionOccupiedWidth } from './font-metrics.mjs';
import { pixels, updateStyle } from './layout-box.mjs';
import { allocateLaneSizes } from './layout-model.mjs';

// Designer leaves one extra pixel between a field's caption track and its control.
export const inputCaptionInset = 1;

/** A wrapped side caption keeps the row's upper and lower edge pixels. */
export function sideCaptionRowHeight(height, lines, lineHeight) {
  return Math.max(height, lines * lineHeight + 2);
}

/** Share growth between a standalone caption and its input, up to the unwrapped width. */
export function growFieldCaption({ minimum, preferred }, available, minimumWidth, reserve, sharedInset = 0) {
  const growth = Math.max(0, available - minimumWidth);
  const share = (minimum + sharedInset / 2) / (minimumWidth - reserve + sharedInset);
  return Math.min(preferred, minimum + Math.round(growth * share));
}

/** Choose a whole-word wrap using both tracks' bounds, then grow the tightened caption. */
export function isolatedInputCaptionWidth(caption, available, gap, valueMinimum, valuePreferred) {
  const reserve = gap + inputCaptionInset;
  if (available + .5 >= caption.preferred + reserve + valuePreferred) return;
  const preferred = caption.preferred - 1;
  const [split] = allocateLaneSizes(available - reserve, [
    { minimum: caption.minimum, preferred: caption.preferred },
    { minimum: valueMinimum, preferred: valuePreferred },
  ], { fractional: true });
  const minimum = fieldCaptionOccupiedWidth(caption, Math.min(preferred, Math.round(split)));
  return growFieldCaption({ minimum, preferred }, available, minimum + reserve + valuePreferred, reserve, inputCaptionInset);
}

export function throughCaptionWidth(element) {
  const items = element.parentElement;
  const mode = items.dataset.throughLabels;
  return mode === 'all' || mode === 'leading' && items.firstElementChild === element
    ? pixels(items.style.getPropertyValue('--taxi-through-label-width')) : 0;
}

/** Allocate the label track while keeping its original accessible name. */
export function allocateFieldCaption(captions, { element, key, caption }, width, inset = 0, styleProperty = '--taxi-field-caption-width') {
  updateStyle(element, styleProperty, width === undefined ? '' : `${width + inset}px`);
  if (width === undefined || width >= caption.preferred) return false;
  const lines = fieldCaptionLines(caption, width);
  if (lines.length < 2) return false;
  captions.set(key, lines.join('\n'));
  return true;
}
