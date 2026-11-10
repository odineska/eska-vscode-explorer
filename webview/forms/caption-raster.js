import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { fontLineMetrics } from './model.mjs';
import { firstFontFamily, hintedTextWidth, supportsNativeSans } from './font-metrics.mjs';

/** Keep the DOM caption until a compatible glyph raster has been painted. */
export function createCaptionRaster(props, { target, mode, paint, dependencies, calibrated, advances, resizeWith }) {
  const [status, setStatus] = createSignal('browser');
  const owner = {};
  createEffect(on(
    () => [props.runtime, props.enabled, props.text, JSON.stringify(props.font), JSON.stringify(props.foreground), props.runtime?.pixelAligned?.(), ...dependencies()],
    () => {
      const { runtime, enabled, text, font } = props;
      runtime?.issue(owner, false);
      setStatus('browser');
      if (!enabled || !text || !runtime || runtime.pixelAligned?.() === false) return;

      const element = target();
      const metrics = fontLineMetrics(font);
      const css = getComputedStyle(element);
      const options = { family: firstFontFamily(css.fontFamily), pixels: metrics.pixels, weight: css.fontWeight };
      const expected = hintedTextWidth(text, options);
      if (!supportsNativeSans(options.family, font) || expected === undefined || calibrated?.() === false) {
        runtime.issue(owner, true);
        return;
      }

      let current = true, raster;
      const companion = resizeWith?.(element);
      const fail = () => {
        if (!current) return;
        setStatus('browser');
        runtime.issue(owner, true);
      };
      const draw = () => {
        if (!current || !raster) return;
        try {
          paint({ element, style: getComputedStyle(element), metrics, raster, companion });
          runtime.issue(owner, false);
          setStatus('ready');
        } catch {
          fail();
        }
      };
      setStatus('pending');
      const resize = new ResizeObserver(draw);
      resize.observe(element);
      if (companion) resize.observe(companion);
      // LCD compositing uses the actual ancestor background and text color.
      const appearance = mode === 'lcd' ? new MutationObserver(draw) : undefined;
      if (appearance) {
        for (let node = element; node && !node.classList.contains('taxi-preview'); node = node.parentElement) {
          appearance.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
        }
      }
      runtime.face(options.weight).then(face => {
        if (!current) return;
        const positions = advances?.(text, options);
        const candidate = face.raster(text, metrics.pixels, metrics.ascent, metrics.descent, mode, positions);
        const width = mode === 'lcd' ? candidate.advance : candidate.width;
        if (width !== (positions?.reduce((sum, value) => sum + value, 0) ?? expected)) throw new Error('font-raster-advance');
        raster = candidate;
        draw();
      }).catch(fail);
      onCleanup(() => {
        current = false;
        resize.disconnect();
        appearance?.disconnect();
        runtime.issue(owner, false);
      });
    },
  ));
  onCleanup(() => props.runtime?.issue(owner, false));
  return status;
}
