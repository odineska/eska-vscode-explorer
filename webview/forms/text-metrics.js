import { createSignal, createEffect, on, onCleanup } from 'solid-js';
import { firstFontFamily, hintedTextWidth, wordTextAdvances } from './font-metrics.mjs';

/** Share font loading and discrete advances across captions and button footprints. */
function createNativeWidth(element, request, measure) {
  const [width, setWidth] = createSignal();
  createEffect(on(request, value => {
    if (value.os !== 'linux' || !value.automatic || value.text.length > 4096) { setWidth(); return; }
    const target = element(), css = getComputedStyle(target);
    const descriptor = `${css.fontStyle} ${css.fontWeight} ${Math.round(parseFloat(css.fontSize))}px ${css.fontFamily}`;
    let current = true;
    document.fonts.load(descriptor, value.text).then(() => {
      if (!current) return;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); if (!context) return;
      context.font = descriptor;
      const options = { family: firstFontFamily(css.fontFamily), pixels: Math.round(parseFloat(css.fontSize)),
        weight: css.fontWeight, italic: css.fontStyle === 'italic' };
      const words = value.wordCaption && Number(css.fontWeight) <= 500 && !options.italic
        ? wordTextAdvances(value.text, options) : undefined;
      const textWidth = words?.reduce((sum, advance) => sum + advance, 0) ?? hintedTextWidth(value.text, options)
        ?? [...value.text].reduce((sum, char) => sum + Math.floor(context.measureText(char).width + .5), 0);
      setWidth(measure(target, css, textWidth, value.text));
    }, () => {});
    onCleanup(() => { current = false; });
  }));
  return width;
}

export function createNativeTextWidth(element, request) {
  return createNativeWidth(element, request, (_element, _css, textWidth) => textWidth);
}

/** Allocate measured Linux captions without fractional layout drift. */
export function createNativeButtonWidth(element, request) {
  return createNativeWidth(element, request, (button, css, textWidth, text) => {
    // Computed widths stay in CSS units when the preview uses CSS zoom.
    const adornments = [...button.children].filter(node => !node.hasAttribute('data-native-caption') && !node.classList.contains('taxi-native-caption')
      && !node.hasAttribute('data-native-label') && !node.classList.contains('taxi-native-label'))
      .map(node => ({style:getComputedStyle(node)})).filter(item => parseFloat(item.style.width) > 0);
    const extra = adornments.reduce((sum, {style}) => {
      return sum + parseFloat(style.width) + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
    }, 0) + Math.max(0, adornments.length + (text ? 1 : 0) - 1) * (parseFloat(css.columnGap) || 0)
      + ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0);
    const minimum = css.minWidth.endsWith('px') ? parseFloat(css.minWidth) || 0 : 0;
    return `${Math.max(minimum, Math.ceil(textWidth + extra))}px`;
  });
}
