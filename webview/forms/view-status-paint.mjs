import { paintLcdGlyphs } from './lcd-caption.mjs';

const fill = [254, 242, 199];
const side = [203, 193, 159];
const rim = [228, 217, 178];
const joint = [229, 226, 217];
const mix = (background, foreground, alpha) => background.map(
  (value, index) => Math.round((value * (255 - alpha) + foreground[index] * alpha) / 255),
);

// The same native close stencil is drawn on each filter chip.
const closeColors = [
  fill, [251,239,197], [201,192,158], [159,152,125], [137,131,108],
  [241,230,189], [155,148,122], [132,126,104], [138,132,108], [154,147,121],
  [202,193,158], [139,133,109], [242,231,190], [171,163,134], [172,164,135],
  [249,237,195], [248,236,194], [135,129,106], [200,191,157], [156,149,123],
];
const closeStencil = [
  '001234432100',
  '056777777650',
  '167877774791',
  'a7bcd77ec87a',
  '377efeege773',
  'h777egfe777h',
  'h777egfe7774',
  '377efeege773',
  '27bcd77ec872',
  '197877774791',
  '056777777950',
  '001ij44ji100',
];

export function viewStatusChipPixels(width, background, glyphs, nameLength, foreground, enabled) {
  const height = 22;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const topLight = mix(background, [218, 214, 204], 125);
  const topDark = mix(background, [218, 215, 205], 228);
  const bottomLight = mix(background, [218, 216, 205], 123);
  const bottomDark = mix(background, [218, 216, 206], 228);
  const bottomJoint = mix(background, [219, 215, 206], 232);
  const edges = [
    [background, topLight, topDark],
    [topLight, joint, rim],
    [topDark, rim, fill],
    [bottomJoint, rim, fill],
    [topLight, joint, rim],
    [background, bottomLight, bottomDark],
  ];
  function pixel(x, y, color) {
    const index = (y * width + x) * 4;
    rgba.set(color, index);
    rgba[index + 3] = 255;
  }
  for (let y = 0; y < height; y++) {
    const edge = y < 3 ? edges[y] : y >= 19 ? edges[y - 16] : undefined;
    for (let x = 0; x < width; x++) {
      const distance = Math.min(x, width - 1 - x);
      pixel(x, y, edge ? edge[Math.min(distance, 2)] : distance ? fill : side);
    }
  }
  for (const [y, row] of closeStencil.entries()) {
    for (let x = 0; x < row.length; x++) pixel(width - 18 + x, 5 + y, closeColors[parseInt(row[x], 36)]);
  }
  const nameInk = enabled ? foreground ? [152, 141, 114] : [110, 107, 94] : [183, 180, 169];
  const valueInk = enabled ? foreground ?? [80, 79, 72] : [168, 166, 159];
  const image = { rgba, width, height };
  const clip = [2, 3, width - 18, height - 3];
  paintLcdGlyphs(image, glyphs.slice(0, nameLength), nameInk, 6, 16, clip);
  paintLcdGlyphs(image, glyphs.slice(nameLength), valueInk, 6, 16, clip);
  return image;
}
