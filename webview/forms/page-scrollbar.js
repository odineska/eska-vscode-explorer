import { updateStyle } from './layout-box.mjs';
import { paintCanvas } from './native-control-paint.js';
import { scrollbarFragment, scrollbarPaint } from './scrollbar-paint.mjs';
import { tableHorizontalPaint } from './table-scrollbar.mjs';

export function pageScrollbar(items, alignment, height) {
  alignment.mark(items, 'data-native-page-scroll', 'false');
  alignment.style(items.parentElement, '--taxi-page-row-height', `${height}px`);
  let scrollHeight = height;
  return (enabled, nextHeight = height) => {
    const heightChanged = enabled && scrollHeight !== nextHeight;
    if (heightChanged) {
      scrollHeight = nextHeight;
      updateStyle(items.parentElement, '--taxi-page-row-height', `${scrollHeight}px`);
    }
    const value = String(!!enabled);
    if (items.dataset.nativePageScroll === value) return !!heightChanged;
    items.dataset.nativePageScroll = value;
    if (enabled) preparePageScrollbarPaint(items);
    else {
      delete items.dataset.pageScrollX;
      delete items.dataset.pageScrollY;
    }
    return true;
  };
}

/** Paint Chromium's scrollbars with the shared Linux Designer fragments. */
function preparePageScrollbarPaint(items) {
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
