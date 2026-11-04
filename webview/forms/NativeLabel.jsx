import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { fontLineMetrics } from './model.mjs';
import { hintedTextWidth, designTextAdvances } from './font-metrics.mjs';
import { lcdCaptionPixels } from './lcd-caption.mjs';

function rgb(value) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  if (!match) throw new Error('font-raster-color');
  return match.slice(1).map(Number);
}
function backdrop(element) {
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.backgroundImage !== 'none') throw new Error('font-raster-background');
    if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') return rgb(style.backgroundColor);
  }
  throw new Error('font-raster-background');
}

export function NativeLabel(props) {
  let canvas, placeholder;
  const [status, setStatus] = createSignal('browser'), owner = {};
  createEffect(on(() => [props.enabled, props.text, props.placement, props.calibrated, JSON.stringify(props.font), JSON.stringify(props.foreground)], () => {
    const runtime = props.runtime, text = props.text, value = props.font;
    runtime?.issue(owner, false); setStatus('browser');
    if (!props.enabled || !text || !runtime) return;
    const label = props.target?.() ?? placeholder.parentElement, metrics = fontLineMetrics(value), css = getComputedStyle(label);
    const fieldFrame=props.placement==='fieldTitle'?label.closest('.taxi-form-frame'):undefined;
    const family = css.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (family !== 'ESKA Taxi Sans' || value?.italic || value?.underline || value?.strikeout
        || props.placement === 'tab' && !props.calibrated
        || hintedTextWidth(text, { family, pixels: metrics.pixels, weight: css.fontWeight }) === undefined) {
      runtime.issue(owner, true); return;
    }
    let current = true, raster;
    const fail = () => { if (current) { setStatus('browser'); runtime.issue(owner, true); } };
    const draw = () => {
      if (!current || !raster) return;
      try {
        const style = getComputedStyle(label);
        const tab = props.placement === 'tab', title = props.placement === 'formTitle', input = props.placement === 'input';
        if (input ? !['right','end'].includes(style.textAlign) : !tab && !['left', 'start'].includes(style.textAlign)) throw new Error('font-raster-alignment');
        const height = parseFloat(style.height), context = canvas.getContext('2d');
        if (!Number.isFinite(height) || !context) throw new Error('font-raster-layout');
        canvas.width = raster.width; canvas.height = raster.height;
        let baseline = tab || title || input ? Math.round((height + metrics.ascent - metrics.descent) / 2) - (tab ? 1 : 0)
          : (height + metrics.ascent - metrics.descent) / 2;
        if(input) {
          // Native line centering uses rounded font ascender/descender metrics.
          const ascent=Math.round(metrics.pixels*1854/2048),descent=Math.round(metrics.pixels*434/2048);
          baseline=Math.floor((height+ascent-descent)/2);
        }
        if(fieldFrame){
          const scale=parseFloat(getComputedStyle(fieldFrame.closest('.taxi-preview')).zoom)||1;
          const top=(label.getBoundingClientRect().top-fieldFrame.getBoundingClientRect().top)/scale;
          // The row may allocate half a CSS pixel; snap the baseline in form coordinates.
          baseline=Math.floor(top+baseline+1e-6)-top;
        }
        const left = tab ? Math.round((parseFloat(style.width) - raster.advance) / 2) - parseFloat(style.borderLeftWidth)
          : title ? parseFloat(style.paddingLeft) : input ? label.offsetLeft + parseFloat(style.width) - 3 - raster.advance : 0;
        canvas.style.left = `${left + raster.originX}px`;
        canvas.style.top = `${baseline - metrics.ascent + raster.originY + (input ? label.offsetTop : 0) - (tab ? parseFloat(style.borderTopWidth) : 0)}px`;
        context.putImageData(new ImageData(lcdCaptionPixels(raster, rgb(style.color), backdrop(label)), raster.width, raster.height), 0, 0);
        runtime.issue(owner, false); setStatus('ready');
      } catch { fail(); }
    };
    setStatus('pending');
    const resize = new ResizeObserver(draw); resize.observe(label);
    if(fieldFrame)resize.observe(fieldFrame);
    const appearance = new MutationObserver(draw);
    for (let node = label; node && !node.classList.contains('taxi-preview'); node = node.parentElement) {
      appearance.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    runtime.face(css.fontWeight).then(face => {
      if (!current) return;
      const options = { family, pixels: metrics.pixels, weight: css.fontWeight };
      const advances = props.placement === 'formTitle' ? designTextAdvances(text,options) : undefined;
      if (props.placement === 'formTitle' && !advances) throw new Error('font-raster-advances');
      raster = face.raster(text, metrics.pixels, metrics.ascent, metrics.descent, 'lcd', advances);
      if (raster.advance !== (advances?.reduce((sum, value) => sum + value, 0) ?? hintedTextWidth(text, options))) throw new Error('font-raster-advance');
      draw();
    }).catch(fail);
    onCleanup(() => { current = false; resize.disconnect(); appearance.disconnect(); runtime.issue(owner, false); });
  }));
  onCleanup(() => props.runtime?.issue(owner, false));
  return <><span ref={placeholder} data-native-label={status()} data-native-value={props.placement === 'input' ? status() : undefined} style={{ display: props.placement === 'input' ? 'none' : undefined, visibility: status() === 'ready' ? 'hidden' : undefined }}>{props.text}</span>
    <canvas ref={canvas} class="taxi-native-label" aria-hidden="true" style={{ display: status() === 'ready' ? undefined : 'none' }}/></>;
}
