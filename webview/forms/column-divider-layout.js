import { createSignal } from 'solid-js';
import { availableTrackWidth, boundingScale, pixels } from './layout-box.mjs';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** The column allocation is local to this preview, including when it is detached. */
export function createColumnDividers(schedule) {
  const [dividers, setDividers] = createSignal(new Map());
  const positions = new WeakMap();

  function allocate(pairs, minima, root) {
    const previous = dividers();
    if (!pairs.size && !previous.size) return;
    const scale = pairs.size ? boundingScale(root) : 1;
    const next = new Map();
    let changed = false;
    for (const [key, { items, left, right, preferred, minimumWidths }] of pairs) {
      const width = availableTrackWidth(items, 2, scale);
      // The native outline and rounded CSS track widths can differ by one pixel.
      if (width + 1 >= preferred || width <= 0) continue;
      const minimum = Math.ceil(minimumWidths?.[0] ?? minima.get(left)?.width ?? 0);
      const maximum = Math.floor(width - (minimumWidths?.[1] ?? minima.get(right)?.width ?? 0));
      if (maximum <= minimum) continue;
      const saved = positions.get(items);
      const manual = saved?.left === left && saved.right === right;
      // The end of the range can move when wrapping adds or removes the viewport scrollbar.
      const edge = { minimum, maximum }[saved?.edge];
      const firstTrack = manual ? edge ?? saved.value : pixels(getComputedStyle(items).gridTemplateColumns);
      const value = clamp(Math.round(firstTrack), minimum, maximum);
      const tracks = manual ? `${value}px ${width - value}px` : undefined;
      const before = previous.get(key);
      if (!before || before.value !== value || before.minimum !== minimum || before.maximum !== maximum
        || before.tracks !== tracks || before.items !== items || before.left !== left || before.right !== right) changed = true;
      next.set(key, { minimum, maximum, value, tracks, items, left, right });
    }
    if (changed || previous.size !== next.size) {
      setDividers(next);
      // Caption and nested column allocation use the resulting grid tracks.
      schedule();
    }
  }

  function move(key, value, edge) {
    const divider = dividers().get(key);
    if (!divider) return;
    const next = clamp(Math.round(value), divider.minimum, divider.maximum);
    positions.set(divider.items, { left: divider.left, right: divider.right, value: next, edge });
    schedule();
  }

  return { allocate, get: key => dividers().get(key), move };
}
