import { createCaptionRaster } from './caption-raster.js';
import { paintCanvas, rgb, solidBackdrop } from './native-control-paint.js';
import { viewStatusChipPixels } from './view-status-paint.mjs';

export function ViewStatusChip(props) {
  let chip, canvas;
  const state = props.controller.state;
  const status = createCaptionRaster({
    get runtime() { return props.controller.nativeText; },
    get enabled() { return state.os === 'linux' && props.width >= props.preferred && props.preferred > 0; },
    get text() { return props.label.label; },
    get font() { return props.font; },
    get foreground() { return props.foreground; },
  }, {
    target: () => chip,
    mode: 'lcd',
    dependencies: () => [props.width, props.active, state.ui.zoom, state.modelSequence],
    calibrated: () => props.font.points === 10 && props.font.weight === 400 && state.ui.zoom === 100 && devicePixelRatio === 1,
    paint: ({ style, raster }) => {
      const background = solidBackdrop(chip.parentElement);
      const foreground = props.foreground ? rgb(style.color) : undefined;
      if (!background || props.foreground && !foreground || raster.advance + 28 !== props.preferred) {
        throw new Error('view-status-paint-profile');
      }
      const pixels = viewStatusChipPixels(props.width, background, raster.glyphs, [...props.label.name].length,
        foreground, props.active);
      if (!paintCanvas(canvas, pixels)) throw new Error('view-status-canvas');
    },
  });
  return <span ref={chip} class="taxi-view-status-chip" title={props.label.label}
    data-compact-view-status={props.width < props.preferred ? '' : undefined}
    data-native-view-status={status()} style={{ width: props.width ? `${props.width}px` : undefined }}>
    <span class="taxi-view-status-label">
      <span class="taxi-view-status-name">{props.label.name.slice(0, -1)}</span>
      <span class="taxi-view-status-separator">{': '}</span>
      <span class="taxi-view-status-value">{props.label.value}</span>
    </span>
    <i aria-hidden="true">×</i>
    <canvas ref={canvas} class="taxi-view-status-paint" aria-hidden="true"/>
  </span>;
}
