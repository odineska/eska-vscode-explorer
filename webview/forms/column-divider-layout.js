import { createSignal } from 'solid-js';
import { availableTrackWidth, boundingScale, pixels } from './layout-box.mjs';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** The column allocation is local to this preview, including when it is detached. */
export function createColumnDividers(schedule) {
  const [dividers, setDividers] = createSignal(new Map());
  const positions = new WeakMap();

  function measure(pairs, minima, root) {
    const next = new Map();

    function resolve(key, { items, left, right }, width, low, high, readPosition) {
      const minimum = Math.ceil(low), maximum = Math.floor(high);
      if (maximum <= minimum) return;
      const saved = positions.get(items);
      const manual = saved?.left === left && saved.right === right;
      // The end of the range can move when wrapping adds or removes the viewport scrollbar.
      const edge = { minimum, maximum }[saved?.edge];
      const firstTrack = manual ? edge ?? saved.value : readPosition();
      const value = clamp(Math.round(firstTrack), minimum, maximum);
      const tracks = manual ? `${value}px ${width - value}px` : undefined;
      const divider = { minimum, maximum, value, tracks, items, left, right };
      next.set(key, divider);
      return divider;
    }

    const scale = pairs.size ? boundingScale(root) : 1;
    for (const [key, pair] of pairs) {
      const { items, left, right, preferred, minimumWidths } = pair;
      const width = availableTrackWidth(items, 2, scale);
      // The native outline and rounded CSS track widths can differ by one pixel.
      if (width + 1 >= preferred || width <= 0) continue;
      const minimum = minimumWidths?.[0] ?? minima.get(left)?.width ?? 0;
      const maximum = width - (minimumWidths?.[1] ?? minima.get(right)?.width ?? 0);
      resolve(key, pair, width, minimum, maximum, () => pixels(getComputedStyle(items).gridTemplateColumns));
    }

    function publish() {
      const previous = dividers();
      const changed = previous.size !== next.size || [...next].some(([key, current]) => {
        const before = previous.get(key);
        return !before || Object.keys(current).some(name => before[name] !== current[name]);
      });
      if (changed) {
        setDividers(next);
        // Caption and nested column allocation use the resulting tracks.
        schedule();
      }
    }

    return { resolve, get: key => next.get(key), publish };
  }

  function move(key, value, edge) {
    const divider = dividers().get(key);
    if (!divider) return;
    const next = clamp(Math.round(value), divider.minimum, divider.maximum);
    positions.set(divider.items, { left: divider.left, right: divider.right, value: next, edge });
    schedule();
  }

  return { measure, get: key => dividers().get(key), move };
}
