import { buttonMetrics } from './model.mjs';
import { buttonCaptionPixels } from './button-caption.mjs';
import { createCaptionRaster } from './caption-raster.js';
import { paintCanvas, rgb } from './native-control-paint.js';

export function NativeCaption(props) {
  let canvas;
  const status = createCaptionRaster(props, {
    target: () => props.button(),
    mode: 'gray',
    dependencies: () => [props.trailingWidth, JSON.stringify(props.background)],
    paint({ style, raster }) {
      const padding = buttonMetrics(props.font);
      const expectedHeight = Math.max(26, padding.lineHeight + 2 * padding.verticalPadding + 2);
      const width = parseFloat(style.width), height = parseFloat(style.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || height < expectedHeight || height > 4096 || width < raster.width + 2) {
        throw new Error('font-raster-layout');
      }
      const foreground = rgb(style.color), background = rgb(style.backgroundColor);
      if (!foreground || !background) throw new Error('font-raster-color');
      const image = buttonCaptionPixels(raster, height, foreground, background);
      const left = Math.floor((width - image.width - (props.trailingWidth ?? 0)) / 2) - parseFloat(style.borderLeftWidth);
      canvas.style.left = left + 'px';
      canvas.style.top = (image.top - parseFloat(style.borderTopWidth)) + 'px';
      if (!paintCanvas(canvas, image)) throw new Error('font-raster-canvas');
    },
  });
  return <>
    <span data-native-caption={status()} style={{ visibility: status() === 'ready' ? 'hidden' : undefined }}>{props.text}</span>
    <canvas ref={canvas} class="taxi-native-caption" aria-hidden="true" style={{ display: status() === 'ready' ? undefined : 'none' }}/>
  </>;
}
