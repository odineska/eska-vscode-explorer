const SHADES = [255, 252, 249, 247, 244, 242, 239, 237, 234, 232, 229];
const MIDDLE_ROWS = 17;
const HSV_CHANNELS = [[0, 3, 1], [2, 0, 1], [1, 0, 3], [1, 2, 0], [3, 1, 0], [0, 1, 2]];
const roundDownOnTie = value => Math.ceil(value - .5);

function tintedRamp(fill) {
  const channels = fill.map(channel => Math.fround(channel / 255));
  const high = Math.max(...channels), low = Math.min(...channels);
  const difference = Math.fround(high - low);
  if (!difference) return SHADES.map(shade => fill.map(channel => Math.floor(channel * shade / 255)));
  // Native tinting reduces HSV value in single precision before truncating RGB.
  const saturation = Math.fround(difference / high);
  const relative = channels.map(channel => Math.fround(Math.fround(high - channel) / difference));
  const strongest = channels.indexOf(high);
  const angle = strongest * 2 + relative[(strongest + 2) % 3] - relative[(strongest + 1) % 3];
  const hue = Math.fround(angle < 0 ? angle + 6 : angle);
  const sector = Math.floor(hue), fraction = hue - sector;
  const chroma = [1, Math.fround(1 - saturation), Math.fround(1 - saturation * fraction),
    Math.fround(1 - saturation * (1 - fraction))];
  const order = HSV_CHANNELS[sector % 6];
  return SHADES.map(shade => {
    const value = Math.fround(high * Math.fround(shade / 255));
    return order.map(channel => Math.floor(Math.fround(Math.fround(value * chroma[channel]) * 255)));
  });
}

function fillRow(y, height, ramp) {
  if (y < 3) return [ramp[0], ramp[0]];
  if (y >= height - 3) {
    const end = ramp[y === height - 3 ? 9 : 10];
    return [end, end];
  }
  const middle = row => ramp[1 + Math.floor(row / 2)];
  const source = (y - 2.5) * MIDDLE_ROWS / (height - 6);
  const center = middle(Math.floor(source));
  // Beyond a 2× expansion the native side strips use the center sampler.
  if (height - 6 >= 2 * MIDDLE_ROWS) return [center, center];
  const edge = Math.max(0, Math.min(MIDDLE_ROWS - 1, source - .5));
  const index = Math.floor(edge), fraction = edge - index;
  const start = middle(index), end = middle(Math.min(MIDDLE_ROWS - 1, index + 1));
  const smooth = start.map((channel, c) => roundDownOnTie(channel + (end[c] - channel) * fraction));
  // Side strips resolve midpoint ties toward mid-gray at a sixteenth-pixel phase.
  const strip = Math.round(fraction * 16) === 8 ? start.map((channel, c) =>
    channel - end[c] === 1 ? end[c] + Number(channel <= 128) : smooth[c]) : smooth;
  return [center, smooth, strip];
}

function blend(stroke, other, coverage) {
  return stroke.map((channel, index) => Math.floor(channel * coverage / 255)
    + Math.round(other[index] * (255 - coverage) / 255));
}

/** Paint one row of Linux Taxi segments with optional shared edges. */
export function tumblerPaint({ width, height, first, fill, stroke, backdrop,
  dividers = [first - 1], corners = [true, true, true, true] }) {
  if (![width, height].every(Number.isInteger) || width < 7 || height < 7 || width * height > 1_048_576
      || dividers.some((x, index) => !Number.isInteger(x) || x < 3 || width - x < 4
        || index > 0 && x - dividers[index - 1] < 3)) return;
  const ramp = tintedRamp(fill);
  const outer = backdrop.map(channel => Math.round(Math.max(...stroke) * 11 / 255) + Math.round(channel * 239 / 255));
  const outside = blend(stroke, backdrop, 178);
  const rgba = new Uint8ClampedArray(width * height * 4);
  let pixel = 0;
  for (let y = 0; y < height; y++) {
    const dy = Math.min(y, height - 1 - y);
    const [center, smooth, strip = smooth] = fillRow(y, height, ramp);
    const inner = blend(stroke, smooth, 178), adjacent = blend(stroke, smooth, 109);
    let seam = 0, left = -1, right = dividers[0] ?? width;
    for (let x = 0; x < width; x++) {
      if (x > right) {
        left = right;
        right = dividers[++seam] ?? width;
      }
      const dx = Math.min(x, width - 1 - x);
      const toDivider = Math.min(left < 0 ? Infinity : x - left, right === width ? Infinity : right - x);
      const slot = right - left;
      const corner = corners[(y * 2 < height ? 0 : 2) + Number(x * 2 >= width)];
      let color;
      if (corner && dx === 0 && dy === 0) color = outer;
      else if (corner && dx + dy === 1) color = outside;
      else if (dx === 0 || dy === 0 || toDivider === 0) color = stroke;
      else if (corner && dx === 1 && dy === 1) color = inner;
      else if (corner && dx + dy === 3 && dx < 3 && dy < 3) color = adjacent;
      else if (Math.min(dx, toDivider) <= 2) color = strip;
      else color = slot <= 40 ? smooth : center;
      rgba[pixel++] = color[0];
      rgba[pixel++] = color[1];
      rgba[pixel++] = color[2];
      rgba[pixel++] = 255;
    }
  }
  return { width, height, rgba };
}
