import { createSignal, createEffect, on, onCleanup } from 'solid-js';

/** Allocate measured Linux captions without fractional layout drift. */
export function createNativeButtonWidth(element, request) {
  const [width, setWidth] = createSignal();
  createEffect(on(request, value => {
    if (value.os !== 'linux' || !value.automatic || value.text.length > 4096) { setWidth(); return; }
    const button = element(), css = getComputedStyle(button);
    const descriptor = `${css.fontStyle} ${css.fontWeight} ${Math.round(parseFloat(css.fontSize))}px ${css.fontFamily}`;
    let current = true;
    document.fonts.load(descriptor, value.text).then(() => {
      if (!current) return;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); if (!context) return;
      context.font = descriptor;
      const textWidth = [...value.text].reduce((sum, char) => sum + Math.floor(context.measureText(char).width + .5), 0);
      // Computed widths stay in CSS units when the preview uses CSS zoom.
      const adornments = [...button.children].map(node => ({style:getComputedStyle(node)})).filter(item => parseFloat(item.style.width) > 0);
      const extra = adornments.reduce((sum, {style}) => {
        return sum + parseFloat(style.width) + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
      }, 0) + Math.max(0, adornments.length + (value.text ? 1 : 0) - 1) * (parseFloat(css.columnGap) || 0)
        + ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0);
      setWidth(`${Math.max(parseFloat(css.minWidth) || 0, Math.ceil(textWidth + extra))}px`);
    }, () => {});
    onCleanup(() => { current = false; });
  }));
  return width;
}
