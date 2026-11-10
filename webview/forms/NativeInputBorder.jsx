import { batch, createEffect, on, onCleanup } from 'solid-js';
import { color, flag, property } from './model.mjs';
import { inputBorderPixels, disabledInputForeground } from './input-border.mjs';
import { NativeInputCorners, inputCornerBackground } from './NativeInputCorners.jsx';

function rgb(value) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  return match?.slice(1).map(Number);
}

function backdrop(element, colors) {
  const parent = element.parentElement;
  if (!parent) return;
  if (colors.has(parent)) return colors.get(parent);
  const style = getComputedStyle(parent);
  const background = style.backgroundImage !== 'none' ? undefined
    : style.backgroundColor === 'rgba(0, 0, 0, 0)' ? backdrop(parent, colors) : rgb(style.backgroundColor);
  colors.set(parent, background);
  return background;
}

function inputColors(source, shared) {
  const { color, backgroundColor } = source.style;
  // The preview's color roles are scoped to the webview. Empty declarations can inherit field ink.
  const key = color && backgroundColor && `${color}|${backgroundColor}`;
  if (key && shared.has(key)) return shared.get(key);
  const css = getComputedStyle(source);
  const colors = { border: rgb(css.color), background: rgb(css.backgroundColor) };
  if (key) shared.set(key, colors);
  return colors;
}

/** Read every palette before committing styles so the next field can reuse the current layout. */
export function createInputBorderPaintQueue() {
  const pending = new Set();
  let scheduled;
  return read => {
    pending.add(read);
    if (scheduled === undefined) scheduled = requestAnimationFrame(() => {
      scheduled = undefined;
      const frame = { colors: new Map(), declarations: new Map(), palettes: new Map() };
      const updates = [...pending].map(measure => measure(frame));
      pending.clear();
      batch(() => { for (const update of updates) update?.(); });
    });
    return () => {
      pending.delete(read);
      if (!pending.size && scheduled !== undefined) {
        cancelAnimationFrame(scheduled);
        scheduled = undefined;
      }
    };
  };
}

export function NativeInputBorder(props) {
  let source, lastKey;
  const node = () => props.node, state = props.controller.state;
  const reset = () => {
    lastKey = undefined;
    return () => props.setPaint(undefined);
  };
  // A parent's background can change while reconciliation retains the child node.
  createEffect(on(() => [state.sequence, state.os, props.choice, props.referenceButtons,
    JSON.stringify(node().presentation.border), JSON.stringify(node().presentation.background)], () => {
    onCleanup(props.controller.scheduleInputBorderPaint(({ colors, declarations, palettes }) => {
      if (state.os !== 'linux') return reset();
      const surface = props.surface(), kind = node().presentation.valueType.kind;
      const reference = props.referenceButtons;
      const buttons = reference ?? [...surface.querySelectorAll('.taxi-input-button')];
      const supported = reference || !flag(node(), 'MultiLine', false) && ['string', 'number', 'date'].includes(kind)
        && buttons.length <= 1 && buttons.every(button => button.classList.contains('taxi-input-button--choice'));
      if (!supported || surface.getBoundingClientRect().height < 6) return reset();
      const disabled = !!surface.closest('.taxi-disabled'), inactive = flag(node(), 'ReadOnly', false) || disabled;
      const { border, background } = inputColors(source, declarations);
      const outside = backdrop(surface, colors);
      if (!border || !background || !outside) return reset();
      const choice = buttons.length > 0, outset = Number(choice && !reference);
      const explicitBorder = !!property(node(), 'BorderColor');
      const key = JSON.stringify([border, background, outside, inactive, disabled, choice, outset, explicitBorder]);
      if (key === lastKey) return;
      lastKey = key;
      if (!palettes.has(key)) {
        const pixels = inputBorderPixels(border, background, outside, { inactive, choice, explicitBorder });
        const foreground = disabled ? disabledInputForeground(background) : undefined;
        const buttonBorder = inactive ? [215, 215, 215] : border;
        palettes.set(key, { ...pixels, outside, inactive, disabled, outset, foreground, buttonBorder,
          cornerBackground: inputCornerBackground(pixels.corners) });
      }
      const paint = palettes.get(key);
      return () => props.setPaint(paint);
    }));
  }));
  const multilineReference = () => props.referenceButtons && flag(node(), 'MultiLine', false);
  return <><span ref={source} hidden aria-hidden="true" style={{
    color: color(node().presentation.border), 'background-color': color(node().presentation.background),
  }}/><NativeInputCorners paint={multilineReference() ? undefined : props.paint}/></>;
}
