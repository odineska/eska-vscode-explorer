export const rgb = value => /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);

/** Resolve opaque CSS backgrounds. A single paint pass can share measured ancestors. */
export function solidBackdrop(element, cache) {
  if (!element) return;
  if (cache?.has(element)) return cache.get(element);
  const css = getComputedStyle(element);
  let background;
  if (css.backgroundImage === 'none') {
    background = css.backgroundColor === 'rgba(0, 0, 0, 0)'
      ? solidBackdrop(element.parentElement, cache) : rgb(css.backgroundColor);
  }
  cache?.set(element, background);
  return background;
}

export function paintCanvas(canvas, image) {
  const context = image && canvas.getContext('2d');
  if (!context) return false;
  if (canvas.width !== image.width) canvas.width = image.width;
  if (canvas.height !== image.height) canvas.height = image.height;
  context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return true;
}
