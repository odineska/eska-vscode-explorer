import { For, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { color, flag, font as fontStyle, fontPixels, number, property } from './model.mjs';
import { controlCaptionWidth } from './font-metrics.mjs';
import { inputBorderPixels } from './input-border.mjs';
import { searchClearPixels, searchHintGray } from './search-control.mjs';
import { NativeInputCorners } from './NativeInputCorners.jsx';
import { NativeLabel } from './NativeLabel.jsx';
import { rgb, solidBackdrop } from './native-control-paint.js';
import { observeRasterPaint } from './raster-position.js';
import { useFormLayout } from './responsive-layout.js';

function fitHint(text, font, available) {
  const width = controlCaptionWidth(text, font);
  if (width === undefined || width <= available) return text;
  const chars = [...text];
  while (chars.length && controlCaptionWidth(chars.join('') + '…', font) > available) chars.pop();
  return chars.length ? chars.join('') + '…' : '';
}

export function TableSearch(props) {
  let surface, clear, input;
  const state = props.controller.state, layout = useFormLayout(), owner = {};
  const [paint, setPaint] = createSignal();
  const standalone = () => props.placement === 'standalone';
  const font = () => standalone() || property(props.node, 'Font') ? props.node.presentation.font : state.model.root.presentation.font;
  const enabled = () => !standalone() || flag(props.node, 'Enabled');
  const authoredText = () => standalone() && property(props.node, 'TextColor');
  const calibrated = () => font().points === 10 && font().weight === 400;
  // Native toolbar hints use the smaller face until this preview pane is laid out again.
  const compact = () => state.os === 'linux' && !props.placement && calibrated() && layout && !layout.viewportResized();
  const placeholder = () => state.strings.searchShortcut;
  const style = () => {
    const limit = !flag(props.node, 'AutoMaxWidth') ? number(props.node, 'MaxWidth') : 0;
    if (!standalone()) return !props.placement && state.os === 'linux' && limit > 0
      ? { 'max-width': `${limit * 10 + 10}px` } : undefined;
    return {
      ...fontStyle(font(), state.os),
      ...(state.os === 'linux' ? { 'font-size': `${fontPixels(font())}px` } : {}),
      'background-color': enabled() && property(props.node, 'BackColor') ? color(props.node.presentation.background) : undefined,
      'border-color': !enabled() ? '#d7d7d7' : property(props.node, 'BorderColor') ? color(props.node.presentation.border) : undefined,
      color: paint()?.hintColor,
      '--taxi-search-hint': paint()?.hintColor,
    };
  };
  createEffect(on(() => [state.os, state.sequence, compact()], () => {
    const runtime = props.controller.nativeText;
    runtime?.issue(owner, false);
    setPaint();
    if (state.os !== 'linux') return;
    const draw = () => {
      const css = getComputedStyle(surface);
      const border = rgb(css.borderTopColor), background = rgb(css.backgroundColor);
      const outside = solidBackdrop(surface.parentElement), foreground = rgb(getComputedStyle(clear).color);
      if (parseFloat(css.height) !== 23 || !standalone() && surface.closest('.taxi-disabled')
          || !border || !background || !outside || !foreground) {
        setPaint();
        runtime?.issue(owner, true);
        return;
      }
      const inactive = !enabled();
      const shade = standalone() ? searchHintGray(background, authoredText() && rgb(getComputedStyle(input).color)) : undefined;
      setPaint({
        ...inputBorderPixels(border, background, outside, { choice: true, inactive }),
        clear: searchClearPixels(foreground, standalone() ? [255, 255, 255] : background, inactive),
        hint: standalone() || !props.placement && surface.closest('[data-table-width-bounded]')
          ? fitHint(placeholder(), compact() ? { ...font(), points: 8.25 } : font(), parseFloat(css.width) - 26)
          : placeholder(),
        hintColor: shade === undefined ? undefined : `rgb(${shade}, ${shade}, ${shade})`,
      });
      runtime?.issue(owner, false);
    };
    onCleanup(observeRasterPaint(surface, draw));
  }));
  onCleanup(() => props.controller.nativeText?.issue(owner, false));
  return <div ref={surface} class="taxi-table-search" classList={{
    'taxi-table-search--top': props.placement === 'top', 'taxi-table-search--compact': compact(),
    'taxi-table-search--standalone': standalone(),
  }} data-native-search-field={paint() ? 'ready' : 'fallback'} data-element={props.node.key} style={style()}
    onClick={event => { event.stopPropagation(); props.controller.select(props.node); }}>
    <input ref={input} readOnly tabIndex="-1" placeholder={placeholder()} aria-label={state.strings.search}
      style={{ color: authoredText() ? color(props.node.presentation.foreground) : undefined }}/>
    <span ref={clear} class="taxi-search-clear" style={{ color: state.os === 'linux' ? color(state.model.root.presentation.foreground) : undefined }}>
      <span style={{ visibility: paint() ? 'hidden' : undefined }}>×</span>
      <Show when={paint()}><svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true" shape-rendering="crispEdges">
        <For each={paint().clear}>{(pixel, index) => <rect x={index() % 7} y={Math.floor(index() / 7)}
          width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>}</For>
      </svg></Show>
    </span>
    <NativeLabel text={paint()?.hint ?? placeholder()} placement="tableSearch" enabled={state.os === 'linux'} calibrated={calibrated()}
      font={compact() ? { ...font(), points: 8.25 } : font()} runtime={props.controller.nativeText}/>
    <NativeInputCorners paint={paint()} rightOffset="-1px"/>
  </div>;
}
