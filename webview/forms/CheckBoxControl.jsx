import { Index, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { checkboxGlyph } from './checkbox-glyph.mjs';
import { checkboxLabels, checkboxMode, checkboxTumblerLayout } from './checkbox-model.mjs';
import { linuxControlFont } from './font-metrics.mjs';
import { caption, color, flag, font } from './model.mjs';
import { inactiveTumblerTextColor, paintTumblerCaptions } from './tumbler-caption.mjs';
import { tumblerPaint } from './tumbler-paint.mjs';

function Tumbler(props) {
  let surface, canvas;
  const node = () => props.node, state = props.controller.state;
  const [painted, setPainted] = createSignal(false);
  const [captionsPainted, setCaptionsPainted] = createSignal(false);
  const runtime = props.controller.nativeText, owner = {};
  const labels = createMemo(() => checkboxLabels(node(), state.locale, state.culture, state.model?.scriptVariant));
  const layout = createMemo(() => checkboxTumblerLayout(node(), labels(), state.os));
  const style = () => {
    const value = node().presentation;
    const { height, first, width, side } = layout();
    return {
      ...(state.os === 'linux' ? linuxControlFont(value.font) : font(value.font, state.os)),
      '--taxi-tumbler-fill': color(value.background),
      'background-color': color(value.background),
      'border-color': color(value.border),
      color: color(value.foreground),
      '--taxi-tumbler-label-color': props.inactive ? '#808080' : undefined,
      'inline-size': width === undefined ? undefined : `${width}px`,
      'block-size': `${height}px`,
      'grid-template-columns': first === undefined ? undefined : `${first - 1}px minmax(0, 1fr)`,
      '--taxi-tumbler-padding': `${side}px`,
    };
  };
  createEffect(on(() => [state.os, state.sequence, layout(), props.inactive], () => {
    setCaptionsPainted(false);
    runtime?.issue(owner, false);
    if (state.os !== 'linux' || layout().width === undefined) { setPainted(false); return; }
    let current = true;
    const fail = () => { if (current) runtime?.issue(owner, true); };
    const frame = requestAnimationFrame(() => {
      const css = getComputedStyle(surface), backdrop = solidBackdrop(surface);
      const fill = rgb(css.backgroundColor), stroke = rgb(css.borderTopColor);
      const { segments, ...size } = layout();
      const image = fill && stroke && backdrop ? tumblerPaint({ ...size, fill, stroke, backdrop }) : undefined;
      const visible = paintCanvas(canvas, image);
      setPainted(visible);
      if (!visible || !labels().some(Boolean)) return;
      const font = node().presentation.font, foreground = rgb(css.color), weight = css.fontWeight;
      const family = css.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (!runtime || !segments || !foreground || family !== 'ESKA Taxi Sans' || font?.italic || font?.underline || font?.strikeout) {
        fail();
        return;
      }
      const ink = props.inactive ? inactiveTumblerTextColor(foreground, fill) : foreground;
      runtime.face(weight).then(face => {
        if (!current) return;
        paintTumblerCaptions(image, segments, font, face, ink);
        setCaptionsPainted(paintCanvas(canvas, image));
      }).catch(fail);
    });
    onCleanup(() => { current = false; cancelAnimationFrame(frame); runtime?.issue(owner, false); });
  }));
  return <span ref={surface} class="taxi-checkbox-tumbler" role="radiogroup" aria-label={caption(node(), state)} aria-readonly="true"
    aria-disabled={props.inactive} data-equal-width={layout().equal}
    data-native-tumbler={painted() ? 'ready' : undefined}
    data-native-tumbler-captions={captionsPainted() ? 'ready' : undefined}
    data-sized={layout().width === undefined ? undefined : ''} style={style()}>
    <Index each={labels()}>{label => <span class="taxi-checkbox-choice" role="radio" aria-label={label()} aria-checked="false">
      <span>{label()}</span>
    </span>}</Index>
    <canvas ref={canvas} class="taxi-tumbler-face" aria-hidden="true" hidden={!painted()}/>
  </span>;
}

const rgb = value => /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);

function solidBackdrop(surface) {
  for (let parent = surface.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.backgroundImage !== 'none') return;
    if (css.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return rgb(css.backgroundColor);
    }
  }
}

function paintCanvas(canvas, image) {
  const context = image && canvas.getContext('2d');
  if (!context) return false;
  if (canvas.width !== image.width) canvas.width = image.width;
  if (canvas.height !== image.height) canvas.height = image.height;
  context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return true;
}

function Mark(props) {
  let surface, canvas;
  const [painted, setPainted] = createSignal(false);
  const state = props.controller.state;
  const switcher = () => props.mode === 'Switcher';
  createEffect(on(() => [state.os, state.sequence, props.mode, props.inactive], () => {
    if (state.os !== 'linux') { setPainted(false); return; }
    const draw = requestAnimationFrame(() => {
      const backdrop = solidBackdrop(surface);
      const image = backdrop ? checkboxGlyph(props.mode, props.inactive, backdrop) : undefined;
      setPainted(paintCanvas(canvas, image));
    });
    onCleanup(() => cancelAnimationFrame(draw));
  }));
  return <span ref={surface} class={switcher() ? 'taxi-checkbox-switch' : 'taxi-checkbox'}
    role={switcher() ? 'switch' : 'checkbox'} aria-label={caption(props.node, state)} aria-checked="false"
    aria-disabled={props.inactive} data-inactive={props.inactive} data-native-mark={painted() ? 'ready' : undefined}>
    <Show when={switcher() && !painted()}>
      <svg width="34" height="20" viewBox="0 0 34 20" aria-hidden="true">
        <rect class="taxi-checkbox-switch-track" x="9.5" y="3" width="24.5" height="13" rx="6.5"/>
        <ellipse class="taxi-checkbox-switch-shadow" cx="9.5" cy="10.5" rx="9" ry="9.5"/>
        <circle class="taxi-checkbox-switch-knob" cx="9.5" cy="9.5" r="9"/>
      </svg>
    </Show>
    <canvas ref={canvas} aria-hidden="true" hidden={!painted()}/>
  </span>;
}

export function CheckBoxControl(props) {
  const mode = () => checkboxMode(props.node);
  const inactive = () => !flag(props.node, 'Enabled') || flag(props.node, 'ReadOnly', false);
  return <Show when={mode() === 'Tumbler'} fallback={<Mark {...props} mode={mode()} inactive={inactive()}/>}>
    <Tumbler {...props} inactive={inactive()}/>
  </Show>;
}
