const pixels = value => parseFloat(value) || 0;

/** Used CSS dimensions stay in layout pixels across Chromium's differing zoom/DOMRect conventions. */
export function borderBoxSize(element, scale = 1) {
  const css = getComputedStyle(element), rect = element.getBoundingClientRect();
  const content = css.boxSizing !== 'border-box';
  const axis = (name, first, second) => {
    const value = parseFloat(css[name]);
    return Number.isFinite(value) ? value + (content ? pixels(css[`padding${first}`]) + pixels(css[`padding${second}`])
      + pixels(css[`border${first}Width`]) + pixels(css[`border${second}Width`]) : 0) : rect[name] / scale;
  };
  return { width: axis('width','Left','Right'), height: axis('height','Top','Bottom') };
}

export function boundingScale(element) {
  const width = borderBoxSize(element).width;
  return width > 0 ? element.getBoundingClientRect().width / width : 1;
}
