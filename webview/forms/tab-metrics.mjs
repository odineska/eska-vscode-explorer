import { fontLineHeight } from './model.mjs';

// Native 8.3.27.2342 Linux, Liberation Sans, 96 DPI. Shared header allocation
// follows the largest page title; the captions retain their individual fonts.
const measured = new Map([
  [8, [23, 8]], [10, [27, 9]], [12, [33, 12]], [14, [40, 15]],
  [16, [43, 16]], [18, [49, 18]], [20, [54, 20]], [24, [62, 24]],
  [28, [72, 28]], [32, [83, 33]],
]);

export function tabMetrics(fonts) {
  const largest = fonts.reduce((value, font) => (font?.points ?? 10) > (value?.points ?? 10) ? font : value, fonts[0]);
  const points = largest?.points ?? 10, metrics = measured.get(points);
  return {
    height: metrics?.[0] ?? Math.ceil(fontLineHeight(largest) * 1.75),
    horizontalPadding: metrics?.[1] ?? Math.max(1, Math.floor(fontLineHeight(largest) * .7) - 1),
    calibrated: !!metrics && fonts.every(font => measured.has(font?.points ?? 10)),
  };
}
