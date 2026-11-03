import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { buttonCaptionPixels } from '../webview/forms/button-caption.mjs';
import { buttonBackgroundShade, fontLineMetrics } from '../webview/forms/model.mjs';

const asset = name => new URL(`../resources/forms/${name}`, import.meta.url);
const binary = await readFile(asset('native-text/font-raster.wasm'));
const regular = await readFile(asset('fonts/LiberationSans-Regular.ttf'));
const bold = await readFile(asset('fonts/LiberationSans-Bold.ttf'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function interiorPixels(face, caption, points, width, height, foreground, background = [255, 255, 255]) {
  const { pixels, ascent, descent } = fontLineMetrics({ points });
  const raster = face.raster(caption, pixels, ascent, descent);
  const image = buttonCaptionPixels(raster, height, foreground, background);
  const left = Math.floor((width - raster.width) / 2), rgb = Buffer.alloc((width - 6) * (height - 6) * 3);
  let offset = 0;
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    const tx = x - left, ty = y - image.top;
    for (let channel = 0; channel < 3; channel++) rgb[offset++] = tx >= 0 && tx < image.width && ty >= 0 && ty < image.height
      ? image.rgba[(ty * image.width + tx) * 4 + channel] : buttonBackgroundShade(height - 2, y - 1, background[channel]);
  }
  return { rgb, textWidth: raster.width };
}

test('WASM button captions match all 275213 native interior pixels exactly', async () => {
  const fixture = new URL('../../eska/tests/fixtures/forms/native-button-metrics/', import.meta.url);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', fixture)));
  const reference = JSON.parse(await readFile(new URL('caption-interiors.json', fixture)));
  const engine = createFontRaster(binary);
  try {
    const faces = { normal: engine.open(regular), bold: engine.open(bold) };
    let compared = 0;
    for (const row of metrics.rows) {
      const expected = reference.rows.find(item => item.name === row.name);
      for (const [index, button] of row.buttons.entries()) {
        const caption = expected.buttons[index], { width, height } = button;
        const { rgb } = interiorPixels(faces[row.weight], caption.caption, row.points, width, height, [77, 77, 77]);
        assert.equal(sha(rgb), caption.rgbSha256, `${row.name}: ${caption.caption}`);
        compared += caption.width * caption.height;
      }
    }
    assert.equal(compared, 275213);
  } finally { engine.dispose(); }
});

test('kerning, Cyrillic and explicit RGB captions match all eighteen native interiors', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-button-captions/metrics.json', import.meta.url)));
  const engine = createFontRaster(binary);
  try {
    const faces = { normal: engine.open(regular), bold: engine.open(bold) };
    for (const row of reference.rows) for (const button of row.buttons) {
      const color = button.foreground.slice(1).match(/../g).map(value => parseInt(value, 16));
      const { rgb, textWidth } = interiorPixels(faces[row.weight], button.caption, row.points, button.width, button.height, color);
      const pixels = Math.round(row.points * 4 / 3);
      assert.equal(textWidth + pixels * 2 + 2, button.width, `${row.name}: ${button.caption} width`);
      assert.equal(sha(rgb), button.interiorRgbSha256, `${row.name}: ${button.caption} RGB`);
    }
  } finally { engine.dispose(); }
});

test('five Taxi style colors match native caption interiors with and without a selected style', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-style-palette/caption-interiors.json', import.meta.url)));
  const engine = createFontRaster(binary);
  try {
    const face = engine.open(regular);
    let compared = 0;
    for (const row of reference.rows) {
      const { rgb } = interiorPixels(face, reference.caption, reference.points, row.button.width, row.button.height, row.foreground);
      assert.equal(sha(rgb), row.rgbSha256, `${row.context}: ${row.name}`);
      compared += row.region.width * row.region.height;
    }
    assert.equal(compared, 9200);
  } finally { engine.dispose(); }
});

test('ordinary button backgrounds and captions match twenty-eight native RGB and font interiors', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-button-colors/metrics.json', import.meta.url)));
  const engine = createFontRaster(binary);
  try {
    const face = engine.open(regular);
    let compared = 0;
    for (const row of reference.rows) {
      const button = row.buttons[reference.ordinaryButtonIndex], background = row.background.slice(1).match(/../g).map(value => parseInt(value,16));
      const { rgb } = interiorPixels(face, button.caption, row.points, button.width, button.height, [77,77,77], background);
      assert.equal(sha(rgb),button.interiorRgbSha256,row.name);
      compared += button.interior.width * button.interior.height;
    }
    assert.equal(compared,60752);
  } finally { engine.dispose(); }
});

test('predefined and named fonts match all twenty-one native mixed-row button interiors', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-font-roles/metrics.json', import.meta.url)));
  const engine = createFontRaster(binary);
  try {
    const faces = { regular:engine.open(regular), bold:engine.open(bold) };
    let compared = 0;
    for (const row of reference.rows) for (const button of row.buttons) {
      const { rgb } = interiorPixels(faces[button.weight],button.caption,button.points,button.width,button.height,[77,77,77]);
      assert.equal(sha(rgb),button.interiorRgbSha256,`${row.name}: ${button.caption}`);
      compared += button.interior.width * button.interior.height;
    }
    assert.equal(compared,39117);
  } finally { engine.dispose(); }
});

test('rasterizer validates unsupported text and releases owned faces idempotently', () => {
  const engine = createFontRaster(binary), face = engine.open(regular);
  for (const text of ['e\u0301', 'a\u200d', '\n', 'مرحبا', '🚀', 'a'.repeat(4097)]) {
    assert.throws(() => face.raster(text, 13, 12, 3), /font-raster-(text|glyph)/);
  }
  for (const pixels of [0, 129, 13.5, Infinity, NaN]) assert.throws(() => face.raster('M', pixels, 12, 3), /font-raster-text/);
  assert.throws(() => face.raster('M'.repeat(1000), 128, 116, 28), /font-raster-width/);
  assert.equal(face.raster('', 13, 12, 3).alpha.length, 0);
  assert.ok(face.raster('Форма № 123', 13, 12, 3).width > 0);
  assert.throws(() => engine.open(new Uint8Array(10)), /font-raster-font/);
  assert.throws(() => engine.open(new Uint8Array(4 * 1024 * 1024 + 1)), /font-raster-input/);
  face.dispose(); face.dispose();
  assert.throws(() => face.raster('M', 13, 12, 3), /font-raster-disposed/);
  engine.dispose(); engine.dispose();
  assert.throws(() => engine.open(regular), /font-raster-disposed/);
});

test('memory growth preserves existing font data and refreshes glyph views', () => {
  const engine = createFontRaster(binary);
  try {
    const first = engine.open(regular), before = first.raster('Форма MM', 43, 39, 10);
    // Font bytes alone exceed the initial 16 MiB linear memory.
    for (let i = 0; i < 48; i++) engine.open(regular);
    assert.deepEqual(first.raster('Форма MM', 43, 39, 10), before);
  } finally { engine.dispose(); }
});

test('pinned rasterizer has no filesystem, environment or network imports', async () => {
  const manifest = JSON.parse(await readFile(asset('native-text/manifest.json')));
  assert.equal(sha(binary), manifest.wasmSha256);
  assert.equal(sha(await readFile(new URL('../scripts/form-font-raster.c', import.meta.url))), manifest.bridgeSha256);
  assert.equal(manifest.freeType, '2.13.2'); assert.equal(manifest.interpreterVersion, 40);
  const module = new WebAssembly.Module(binary);
  assert.deepEqual(WebAssembly.Module.imports(module).map(item => `${item.module}.${item.name}`).sort(),
    ['env.emscripten_notify_memory_growth', 'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_read']);
});
