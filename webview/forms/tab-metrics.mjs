import { fontLineHeight } from './model.mjs';

// Native 8.3.27.2342 Linux, Liberation Sans, 96 DPI. Shared header allocation
// follows the largest page title; the captions retain their individual fonts.
// Height, top/bottom padding, total side padding, and minimum side fit width.
const measured = new Map([
  [8, [23, 8, 13, 37]], [10, [27, 9, 15, 43]], [12, [33, 12, 21, 57]],
  [14, [40, 15, 25, 68]], [16, [43, 16, 27, 74]], [18, [49, 18, 31, 84]],
  [20, [54, 20, 33, 91]], [24, [62, 24, 39, 107]], [28, [72, 28, 47, 126]],
  [32, [83, 33, 55, 147]],
]);

export function sideTabRepresentation(value) {
  return value === 'TabsOnLeftHorizontal' || value === 'TabsOnRightHorizontal';
}

export function tabMetrics(fonts) {
  const largest = fonts.reduce((value, font) => (font?.points ?? 10) > (value?.points ?? 10) ? font : value, fonts[0]);
  const [height, horizontalPadding, padding, fitMinimum] = measured.get(largest?.points ?? 10) ?? [];
  const calibrated = height !== undefined && fonts.every(font => measured.has(font?.points ?? 10));
  // Side buttons add two borders and have a separate painted minimum.
  const side = calibrated ? { padding, fitMinimum, buttonMinimum: Math.max(50, fitMinimum + 2) } : undefined;
  return {
    height: height ?? Math.ceil(fontLineHeight(largest) * 1.75),
    horizontalPadding: horizontalPadding ?? Math.max(1, Math.floor(fontLineHeight(largest) * .7) - 1),
    calibrated, side,
  };
}
