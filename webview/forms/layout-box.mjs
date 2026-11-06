export const pixels = value => parseFloat(value) || 0;

export function boxInsets(style) {
  return {
    width: pixels(style.paddingLeft) + pixels(style.paddingRight) + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth),
    height: pixels(style.paddingTop) + pixels(style.paddingBottom) + pixels(style.borderTopWidth) + pixels(style.borderBottomWidth),
  };
}

export function textWidth(element, scale) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width / scale;
}

/** Used CSS dimensions stay in layout pixels across Chromium's differing zoom/DOMRect conventions. */
export function borderBoxSize(element, scale = 1) {
  const css = getComputedStyle(element), rect = element.getBoundingClientRect();
  const insets = css.boxSizing === 'border-box' ? null : boxInsets(css);
  const axis = name => {
    const value = parseFloat(css[name]);
    return Number.isFinite(value) ? value + (insets?.[name] ?? 0) : rect[name] / scale;
  };
  return { width: axis('width'), height: axis('height') };
}

export function boundingScale(element) {
  const width = borderBoxSize(element).width;
  return width > 0 ? element.getBoundingClientRect().width / width : 1;
}
