import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { buttonMetrics, fontLineMetrics } from './model.mjs';
import { hintedTextWidth } from './font-metrics.mjs';
import { buttonCaptionPixels } from './button-caption.mjs';

export function NativeCaption(props) {
  let canvas;
  const [status, setStatus] = createSignal('browser');
  const owner = {};
  createEffect(on(() => [props.enabled, props.text, JSON.stringify(props.font), JSON.stringify(props.foreground), JSON.stringify(props.background)], () => {
    const runtime = props.runtime, text = props.text, enabled = props.enabled, value = props.font;
    runtime?.issue(owner, false); setStatus('browser');
    if (!enabled || !text || !runtime) return;
    const button = props.button(), metrics = fontLineMetrics(value), css = getComputedStyle(button);
    const padding = buttonMetrics(value), expectedHeight = Math.max(26, padding.lineHeight + 2 * padding.verticalPadding + 2);
    const family = css.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (family !== 'ESKA Taxi Sans' || value?.italic || value?.underline || value?.strikeout
        || hintedTextWidth(text, { family, pixels: metrics.pixels, weight: css.fontWeight }) === undefined) {
      runtime.issue(owner, true); return;
    }
    let current = true, raster;
    const fail = () => { if (current) { setStatus('browser'); runtime.issue(owner, true); } };
    const draw = () => {
      if (!current || !raster) return;
      try {
        const style = getComputedStyle(button), width = parseFloat(style.width), height = parseFloat(style.height);
        if (!Number.isInteger(width) || height !== expectedHeight || width < raster.width + 2) throw new Error('font-raster-layout');
        const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.color);
        const background = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.backgroundColor);
        if (!match || !background) throw new Error('font-raster-color');
        const image = buttonCaptionPixels(raster, height, match.slice(1).map(Number), background.slice(1).map(Number));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('font-raster-canvas');
        canvas.width = image.width; canvas.height = image.height;
        canvas.style.left = `${Math.floor((width - image.width) / 2) - parseFloat(style.borderLeftWidth)}px`;
        canvas.style.top = `${image.top - parseFloat(style.borderTopWidth)}px`;
        context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
        runtime.issue(owner, false); setStatus('ready');
      } catch { fail(); }
    };
    setStatus('pending');
    const observer = new ResizeObserver(draw); observer.observe(button);
    runtime.face(css.fontWeight).then(face => {
      if (!current) return;
      raster = face.raster(text, metrics.pixels, metrics.ascent, metrics.descent);
      if (raster.width !== hintedTextWidth(text, { family, pixels: metrics.pixels, weight: css.fontWeight })) throw new Error('font-raster-advance');
      draw();
    }).catch(fail);
    onCleanup(() => { current = false; observer.disconnect(); runtime.issue(owner, false); });
  }));
  onCleanup(() => props.runtime?.issue(owner, false));
  return <><span data-native-caption={status()} style={{ visibility: status() === 'ready' ? 'hidden' : undefined }}>{props.text}</span>
    <canvas ref={canvas} class="taxi-native-caption" aria-hidden="true" style={{ display: status() === 'ready' ? undefined : 'none' }}/></>;
}
