import { paintCanvas } from './native-control-paint.js';
import { scrollbarFragment, scrollbarPaint } from './scrollbar-paint.mjs';
import { tableHorizontalPaint } from './table-scrollbar.mjs';

/** Paint Chromium's scrollbars with the shared Linux Designer fragments. */
export function preparePageScrollbarPaint(items) {
  const document = items.ownerDocument, style = document.documentElement.style;
  const prefix = '--taxi-page-scroll-';
  if (style.getPropertyValue(prefix + 'track-start')) return;
  const { left, right, trackStart, trackEnd, active } = tableHorizontalPaint;
  const images = {
    'track-start': trackStart, 'track-end': trackEnd,
    'thumb-outer-start': active.outerStart, 'thumb-inner-start': active.innerStart,
    'thumb-outer-end': active.outerEnd, 'thumb-inner-end': active.innerEnd,
    'left': left.active, 'left-disabled': left.disabled,
    'right': right.active, 'right-disabled': right.disabled,
    'up': scrollbarFragment([...scrollbarPaint.active.downArrow].reverse()),
    'up-disabled': scrollbarFragment(scrollbarPaint.disabled.upArrow),
    'down': scrollbarFragment(scrollbarPaint.active.downArrow),
    'down-disabled': scrollbarFragment(scrollbarPaint.disabled.downArrow),
  };
  const canvas = document.createElement('canvas');
  for (const [name, image] of Object.entries(images)) {
    if (paintCanvas(canvas, image)) style.setProperty(prefix + name, `url("${canvas.toDataURL()}")`);
  }
}
