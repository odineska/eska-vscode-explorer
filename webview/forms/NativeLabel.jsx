import { inputTextBaseline } from './model.mjs';
import { hintedTextWidth, designTextAdvances, segmentedTextAdvances } from './font-metrics.mjs';
import { lcdCaptionPixels } from './lcd-caption.mjs';
import { createCaptionRaster } from './caption-raster.js';
import { paintCanvas, rgb, solidBackdrop } from './native-control-paint.js';

const calibratedPlacements = ['tab', 'buttonLink', 'tableHeader', 'tableFooter', 'tableSearch'];

function labelAdvances(props, text, options) {
  if (props.segments) {
    const advances = segmentedTextAdvances(props.segments, options);
    if (props.segments.join('') !== text || !advances) throw new Error('font-raster-segments');
    return advances;
  }
  // Date masks allocate character positions without pair kerning.
  if (props.mask) return [...text].map(char => hintedTextWidth(char, options));
  if (props.placement === 'formTitle') {
    const advances = designTextAdvances(text, options);
    if (!advances) throw new Error('font-raster-advances');
    return advances;
  }
}

function paintLabel(canvas, props, { element: label, style, metrics, raster, companion: fieldFrame }) {
  const placement = props.placement;
  const tab = placement === 'tab', link = placement === 'buttonLink', title = placement === 'formTitle', input = placement === 'input';
  const search = placement === 'tableSearch', tableHeader = placement === 'tableHeader', table = tableHeader || placement === 'tableFooter';
  const alignedLeft = ['left', 'start'].includes(style.textAlign);
  const alignedRight = ['right', 'end'].includes(style.textAlign);
  if (!tab && !link && !alignedLeft && !((input || table) && alignedRight) && !(table && style.textAlign === 'center')) {
    throw new Error('font-raster-alignment');
  }
  const height = parseFloat(style.height);
  if (!Number.isFinite(height)) throw new Error('font-raster-layout');
  let baseline = (height + metrics.ascent - metrics.descent) / 2;
  if (tab || title || link) baseline = Math.round(baseline) - Number(tab);
  if (input) baseline = inputTextBaseline(height, props.font);
  // Adjacent captions keep their own baseline when another column enlarges the band.
  if (table) baseline = metrics.ascent + (tableHeader ? 6 : 7);
  if (search || placement === 'radioChoice') baseline = Math.floor(baseline);
  if (fieldFrame) {
    const scale = parseFloat(getComputedStyle(fieldFrame.closest('.taxi-preview')).zoom) || 1;
    const top = (label.getBoundingClientRect().top - fieldFrame.getBoundingClientRect().top) / scale;
    // The row may allocate half a CSS pixel; snap the baseline in form coordinates.
    baseline = Math.floor(top + baseline + 1e-6) - top;
  }
  const width = parseFloat(style.width), borderLeft = parseFloat(style.borderLeftWidth);
  let left = 0;
  if (tab || link) left = Math.round((width - raster.advance) / 2) - borderLeft;
  else if (search) left = 2;
  else if (title || table) left = parseFloat(style.paddingLeft);
  else if (input) left = label.offsetLeft + (alignedLeft ? 3 : width - 3 - raster.advance);
  if (table && !alignedLeft) {
    left = (alignedRight ? width - raster.advance - (tableHeader ? 9 : 8)
      : Math.round((width - raster.advance) / 2)) - borderLeft;
  }
  const canvasLeft = left + raster.originX;
  const canvasTop = baseline - metrics.ascent + raster.originY + (input ? label.offsetTop : 0)
    - (tab || link || table || search ? parseFloat(style.borderTopWidth) : 0);
  canvas.style.left = canvasLeft + 'px';
  canvas.style.top = canvasTop + 'px';

  let clipping = '';
  if (input) {
    const overflowsHeight = metrics.pixels > height - 6, overflowsWidth = raster.advance > width - 6;
    // Overflow uses the native text viewport instead of the LCD bitmap's overhang.
    const clipLeft = Math.max(label.offsetLeft + 3, overflowsHeight ? left : -Infinity);
    const clipRight = Math.min(label.offsetLeft + width, overflowsHeight ? left + raster.advance : Infinity,
      overflowsWidth ? label.offsetLeft + width - (props.mask ? 3 : 4) : Infinity);
    const edges = [
      Math.max(0, label.offsetTop + 3 - canvasTop),
      Math.max(0, canvasLeft + raster.width - clipRight),
      Math.max(0, canvasTop + raster.height - label.offsetTop - height + 3),
      Math.max(0, clipLeft - canvasLeft),
    ];
    clipping = 'inset(' + edges.map(edge => edge + 'px').join(' ') + ')';
  }
  if (search) clipping = 'inset(0 ' + Math.max(0, canvasLeft + raster.width - width + 22) + 'px 0 0)';
  canvas.style.clipPath = clipping;
  const foreground = rgb(style.color), background = solidBackdrop(label);
  if (!foreground || !background) throw new Error('font-raster-color');
  const rgba = lcdCaptionPixels(raster, foreground, background, link);
  if (!paintCanvas(canvas, { width: raster.width, height: raster.height, rgba })) throw new Error('font-raster-canvas');
}

export function NativeLabel(props) {
  let canvas, placeholder;
  const status = createCaptionRaster(props, {
    target: () => props.target?.() ?? placeholder.parentElement,
    mode: 'lcd',
    dependencies: () => [props.placement, props.calibrated, props.mask, JSON.stringify(props.segments)],
    calibrated: () => !calibratedPlacements.includes(props.placement) || !!props.calibrated,
    resizeWith: label => props.placement === 'fieldTitle' ? label.closest('.taxi-form-frame') : undefined,
    advances: (text, options) => labelAdvances(props, text, options),
    paint: layout => paintLabel(canvas, props, layout),
  });
  return <>
    <span ref={placeholder} data-native-label={status()}
      data-native-link={props.placement === 'buttonLink' ? status() : undefined}
      data-native-value={props.placement === 'input' ? status() : undefined}
      style={{
        display: ['input', 'tableSearch'].includes(props.placement) ? 'none' : undefined,
        visibility: status() === 'ready' && !props.interactive ? 'hidden' : undefined,
        color: status() === 'ready' && props.interactive ? 'transparent' : undefined,
      }}>{props.children ?? props.text}</span>
    <canvas ref={canvas} class="taxi-native-label" aria-hidden="true" style={{ display: status() === 'ready' ? undefined : 'none' }}/>
  </>;
}
