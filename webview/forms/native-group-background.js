import { createEffect, createSignal } from 'solid-js';
import { solidBackdrop } from './native-control-paint.js';

/** The native painted group leaves one row of its parent's background at each end. */
export function createNativeGroupBackdrop(element, request) {
  const [outside, setOutside] = createSignal();
  createEffect(request, ({ enabled }) => {
    if (!enabled) { setOutside(); return; }
    const frame = requestAnimationFrame(() => {
      const background = solidBackdrop(element()?.parentElement);
      setOutside(background && `rgb(${background.join(', ')})`);
    });
    return () => cancelAnimationFrame(frame);
  });
  return outside;
}
