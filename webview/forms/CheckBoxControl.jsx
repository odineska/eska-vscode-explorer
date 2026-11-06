import { Index, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { checkboxGlyph } from './checkbox-glyph.mjs';
import { checkboxLabels, checkboxMode, checkboxTumblerLayout } from './checkbox-model.mjs';
import { linuxControlFont } from './font-metrics.mjs';
import { caption, color, flag, font } from './model.mjs';

function Tumbler(props) {
  const node = () => props.node, state = props.controller.state;
  const labels = createMemo(() => checkboxLabels(node(), state.locale, state.culture, state.model?.scriptVariant));
  const layout = createMemo(() => checkboxTumblerLayout(node(), labels(), state.os));
  const style = () => {
    const value = node().presentation;
    const { height, first, width, side } = layout();
    return {
      ...(state.os === 'linux' ? linuxControlFont(value.font) : font(value.font, state.os)),
      '--taxi-tumbler-fill': color(value.background),
      'border-color': color(value.border),
      color: color(value.foreground),
      'inline-size': width === undefined ? undefined : `${width}px`,
      'block-size': `${height}px`,
      'grid-template-columns': first === undefined ? undefined : `${first - 1}px minmax(0, 1fr)`,
      '--taxi-tumbler-padding': `${side}px`,
    };
  };
  return <span class="taxi-checkbox-tumbler" role="radiogroup" aria-label={caption(node(), state)} aria-readonly="true"
    aria-disabled={props.inactive} data-equal-width={layout().equal}
    data-sized={layout().width === undefined ? undefined : ''} style={style()}>
    <Index each={labels()}>{label => <span class="taxi-checkbox-choice" role="radio" aria-label={label()} aria-checked="false">
      <span>{label()}</span>
    </span>}</Index>
  </span>;
}

function solidBackdrop(surface) {
  for (let parent = surface.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.backgroundImage !== 'none') return;
    if (css.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css.backgroundColor)?.slice(1).map(Number);
    }
  }
}

function Mark(props) {
  let surface, canvas;
  const [painted, setPainted] = createSignal(false);
  const state = props.controller.state;
  const switcher = () => props.mode === 'Switcher';
  createEffect(on(() => [state.os, state.sequence, props.mode, props.inactive], () => {
    if (state.os !== 'linux') { setPainted(false); return; }
    const draw = requestAnimationFrame(() => {
      const backdrop = solidBackdrop(surface), context = canvas.getContext('2d');
      if (!backdrop || !context) { setPainted(false); return; }
      const image = checkboxGlyph(props.mode, props.inactive, backdrop);
      canvas.width = image.width;
      canvas.height = image.height;
      context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
      setPainted(true);
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
