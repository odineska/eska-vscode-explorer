import { fontLineHeight } from './model.mjs';

// Native 8.3.27.2342 Linux, Liberation Sans, 96 DPI. Shared header allocation
// follows the largest page title; the captions retain their individual fonts.
// Height, top/bottom padding, total side padding, minimum side fit width,
// horizontal picture inset, extra caption spacing and empty caption width.
const measured = new Map([
  [8, [23, 8, 13, 37, 7, 4, 6]], [10, [27, 9, 15, 43, 8, 5, 8]], [12, [33, 12, 21, 57, 11, 6]],
  [14, [40, 15, 25, 68, 13, 7, 11]], [16, [43, 16, 27, 74, 14, 8]], [18, [49, 18, 31, 84, 16, 9]],
  [20, [54, 20, 33, 91, 17, 10]], [24, [62, 24, 39, 107, 20, 11]], [28, [72, 28, 47, 126, 24, 13]],
  [32, [83, 33, 55, 147, 28, 15, 24]],
]);

export function sideTabRepresentation(value) {
  return value === 'TabsOnLeftHorizontal' || value === 'TabsOnRightHorizontal';
}

export function tabMetrics(fonts, pictureHeight = 0) {
  const largest = fonts.reduce((value, font) => (font?.points ?? 10) > (value?.points ?? 10) ? font : value, fonts[0]);
  const [height, horizontalPadding, padding, fitMinimum, inset, spacing, emptyWidth] = measured.get(largest?.points ?? 10) ?? [];
  const calibrated = height !== undefined && fonts.every(font => measured.has(font?.points ?? 10));
  const lineHeight = fontLineHeight(largest);
  const captionHeight = height ?? Math.ceil(lineHeight * 1.75);
  const captionPadding = horizontalPadding ?? Math.max(1, Math.floor(lineHeight * .7) - 1);
  // Side buttons add two borders and have a separate painted minimum.
  const side = calibrated ? { padding, fitMinimum, buttonMinimum: Math.max(50, fitMinimum + 2) } : undefined;
  return {
    height: captionHeight + Math.max(0, pictureHeight - lineHeight),
    horizontalPadding: captionPadding,
    pictureInset: inset ?? Math.max(1, Math.round(captionPadding * .85)),
    pictureSpacing: spacing ?? Math.max(1, Math.round(captionPadding / 2)),
    emptyWidth: emptyWidth ?? Math.floor(lineHeight / 2),
    calibrated, side,
  };
}

/** A side strip aligns text after the widest picture on a tab with a caption. */
export function tabPictureLayout(metrics, { side, bottom, picture, caption, sharedWidth }) {
  const { width = 0, height = 0 } = picture ?? {};
  const titleInset = metrics.horizontalPadding + 1;
  const sideInset = titleInset + Number(side === 'right');
  const sideGap = titleInset - metrics.pictureInset + metrics.pictureSpacing;
  let leading = width;
  if (caption) {
    if (side && sharedWidth) leading = sharedWidth + sideGap;
    else if (width) leading = width + metrics.pictureSpacing;
  } else if (!width) {
    // Designer reserves a small content area for an empty tab.
    leading = metrics.emptyWidth;
  }
  const left = side ? sideInset + Math.floor(Math.max(0, sharedWidth - width) / 2) : metrics.pictureInset;
  const top = Math.floor((metrics.height - height - 1) / 2) + Number(bottom);
  return { leading, left, top };
}
