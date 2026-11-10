import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { buttonMetrics, caption, color, flag, font, fontLineMetrics, number, scalar, text } from './model.mjs';
import { controlCaptionWidth, wordCaptionWidth, linuxControlFont, firstFontFamily, supportsNativeSans } from './font-metrics.mjs';
import { NativeLabel } from './NativeLabel.jsx';
import { radioGlyph } from './choice-glyph.mjs';
import { paintCanvas, rgb, solidBackdrop } from './native-control-paint.js';
import { paintRadioTumbler, radioTumblerLayout } from './radio-tumbler.mjs';
import { inactiveRadioTextColor, inactiveTumblerTextColor } from './choice-colors.mjs';

export function RadioChoices(props) {
  let surface, canvas;
  const [painted, setPainted] = createSignal(false);
  const [inactiveColor, setInactiveColor] = createSignal();
  const node = () => props.node, state = props.controller.state;
  const linux = state.os === 'linux';
  const valueFont = () => node().presentation.font;
  const foreground = () => node().presentation.foreground;
  const segments = () => scalar(node(), 'RadioButtonType') === 'Tumbler';
  const inactive = () => !flag(node(), 'Enabled') || flag(node(), 'ReadOnly', false);
  const fallback = [1, 2, 3].map(value => ({ kind: 'name', text: state.strings.sampleValue.replace('{0}', value) }));
  const choices = () => node().presentation.choices.length ? node().presentation.choices : fallback;
  const columns = () => Math.min(choices().length, Math.max(0, Math.trunc(number(node(), 'ColumnsCount'))) || choices().length);
  const labels = createMemo(() => choices().map(choice => text(choice, state.locale, state.strings).trimEnd()));
  const layout = createMemo(() => linux && segments() ? radioTumblerLayout(labels(), columns(), valueFont()) : undefined);
  const positions = createMemo(() => {
    const count = choices().length, width = columns();
    if (segments()) return choices().map((_, index) => ({ row: Math.floor(index / width), column: index % width }));
    // Radio buttons balance each column before filling it from top to bottom.
    const shortest = Math.floor(count / width), taller = count % width;
    return Array.from({ length: width }, (_, column) =>
      Array.from({ length: shortest + Number(column < taller) }, (_, row) => ({ row, column }))
    ).flat();
  });
  const rows = () => Math.ceil(choices().length / columns());
  const style = () => {
    const metrics = buttonMetrics(valueFont());
    return { ...(linux ? linuxControlFont(valueFont()) : font(valueFont(), state.os)),
      color: color(foreground()),
      '--taxi-radio-inactive-text': inactiveColor(),
      '--taxi-radio-segment-fill': linux && segments() ? color(node().presentation.background) : undefined,
      '--taxi-radio-segment-border': linux && segments() ? color(node().presentation.border) : undefined,
      '--taxi-radio-height': `${Math.max(19, metrics.lineHeight + 2)}px`,
      '--taxi-segment-height': `${Math.max(24, metrics.lineHeight + 2 * metrics.verticalPadding + 3)}px` };
  };

  createEffect(on(() => [state.sequence, segments(), inactive()], () => {
    setInactiveColor(undefined);
    if (!linux || segments() || !inactive()) return;
    const frame = requestAnimationFrame(() => {
      const foreground = rgb(getComputedStyle(surface).color), backdrop = solidBackdrop(surface.parentElement);
      if (foreground && backdrop) setInactiveColor(`rgb(${inactiveRadioTextColor(foreground, backdrop).join(', ')})`);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  }));

  const runtime = props.controller.nativeText, owner = {};
  createEffect(on(() => [state.sequence, layout(), inactive(), runtime?.pixelAligned()], () => {
    setPainted(false);
    runtime?.issue(owner, false);
    const size = layout(), font = valueFont();
    if (!size || !runtime?.pixelAligned()) return;
    let current = true;
    const fail = () => { if (current) runtime.issue(owner, true); };
    const frame = requestAnimationFrame(() => {
      const css = getComputedStyle(surface), style = getComputedStyle(surface.firstElementChild);
      const family = firstFontFamily(css.fontFamily);
      const fill = rgb(style.backgroundColor), stroke = rgb(style.borderTopColor), backdrop = solidBackdrop(surface.parentElement);
      const foreground = rgb(css.color);
      if (!fill || !stroke || !backdrop || !foreground || !supportsNativeSans(family, font)) {
        fail();
        return;
      }
      const ink = inactive() ? inactiveTumblerTextColor(foreground, fill) : foreground;
      runtime.face(css.fontWeight).then(face => {
        if (!current) return;
        const image = paintRadioTumbler(size, font, face, { fill, stroke, backdrop }, ink);
        setPainted(paintCanvas(canvas, image));
      }).catch(fail);
    });
    onCleanup(() => { current = false; cancelAnimationFrame(frame); runtime.issue(owner, false); });
  }));

  return <div ref={surface} class="taxi-radios" data-representation={segments() ? 'segments' : 'buttons'} data-rows={rows()}
    data-native-segments={painted() ? 'ready' : undefined}
    role="radiogroup" aria-label={caption(node(), state)} aria-disabled={inactive()} style={style()}>
    <For each={choices()}>{(_choice, index) => {
      const label = () => labels()[index()];
      const width = createMemo(() => linux
        ? layout()?.advances[index()] ?? (segments() ? controlCaptionWidth : wordCaptionWidth)(label(), valueFont()) : undefined);
      const checked = () => !segments() && index() === 0;
      const position = () => positions()[index()];
      const edge = (match) => segments() && match ? '' : undefined;
      const optionStyle = () => {
        const { row, column } = position();
        const grid = { 'grid-row': row + 1, 'grid-column': column + 1 };
        if (!segments()) return grid;
        const padding = Math.round(fontLineMetrics(valueFont()).pixels * 9 / 13);
        // Shared native dividers leave more of the intrinsic padding at the last cell.
        const adjustment = columns() === 1 ? 0 : column === 0 ? -1 : column < columns() - 1 ? -.5 : columns() / 2;
        return { ...grid, 'padding-inline': `${padding + adjustment}px`,
          'margin-inline-start': column ? '-1px' : undefined,
          'margin-block-start': row === 1 ? '-2px' : row > 1 ? '-1px' : undefined };
      };
      return <span class="taxi-radio-option" role="radio" aria-label={label()} aria-checked={checked()} style={optionStyle()}
        data-top={edge(position().row === 0)} data-bottom={edge(index() + columns() >= choices().length)}
        data-left={edge(position().column === 0)} data-right={edge(position().column === columns() - 1 || index() === choices().length - 1)}>
        <Show when={!segments()}><RadioMark state={state} selected={checked()} inactive={inactive()} runtime={runtime}/></Show>
        <span class="taxi-radio-caption" style={{ width: width() === undefined ? undefined : `${width()}px` }}>
          <NativeLabel enabled={linux && !segments()} placement="radioChoice" text={label()} font={valueFont()}
            foreground={foreground()} runtime={props.controller.nativeText}/>
        </span>
      </span>;
    }}</For>
    <canvas ref={canvas} class="taxi-radio-segments-face" aria-hidden="true" hidden={!painted()}/>
  </div>;
}

function RadioMark(props) {
  let mark, canvas;
  const [painted, setPainted] = createSignal(false);
  createEffect(on(() => [props.state.os, props.state.sequence, props.selected, props.inactive, props.runtime?.pixelAligned()], () => {
    if (props.state.os !== 'linux' || !props.runtime?.pixelAligned()) { setPainted(false); return; }
    const frame = requestAnimationFrame(() => {
      const backdrop = solidBackdrop(mark.parentElement);
      const image = backdrop ? radioGlyph(props.selected, props.inactive, backdrop) : undefined;
      setPainted(paintCanvas(canvas, image));
    });
    onCleanup(() => cancelAnimationFrame(frame));
  }));
  return <i ref={mark} classList={{ 'taxi-radio': true, checked: props.selected }} aria-hidden="true"
    data-native-radio={painted() ? 'ready' : undefined}>
    <canvas ref={canvas} hidden={!painted()}/>
  </i>;
}
