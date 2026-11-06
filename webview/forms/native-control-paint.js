export const rgb = value => /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);

export function solidBackdrop(element) {
  for (let parent = element; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    if (css.backgroundImage !== 'none') return;
    if (css.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return rgb(css.backgroundColor);
    }
  }
}

export function paintCanvas(canvas, image) {
  const context = image && canvas.getContext('2d');
  if (!context) return false;
  if (canvas.width !== image.width) canvas.width = image.width;
  if (canvas.height !== image.height) canvas.height = image.height;
  context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return true;
}
