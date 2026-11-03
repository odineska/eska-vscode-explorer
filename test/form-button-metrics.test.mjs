import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonMetrics, buttonBackground } from '../webview/forms/model.mjs';
import { hintedTextWidth } from '../webview/forms/font-metrics.mjs';

test('raised button heights follow all sixteen native font references',async()=>{
  const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-button-metrics/metrics.json',import.meta.url)));
  for(const row of reference.rows){
    const metrics=buttonMetrics({points:row.points});
    assert.equal(Math.max(26,metrics.lineHeight+2*metrics.verticalPadding+2),row.buttons[0].height,row.name);
  }
});

test('discrete button fills match every native background row without dithering', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-button-metrics/backgrounds.json', import.meta.url)));
  for (const row of reference.rows) {
    const height = row.buttonHeight - 2, colors = Array(height);
    for (const match of buttonBackground(height).matchAll(/rgb\((\d+), (\d+), (\d+)\) (\d+)px (\d+)px/g)) {
      assert.equal(match[1], match[2]); assert.equal(match[2], match[3]);
      colors.fill(Number(match[1]), Number(match[4]), Number(match[5]));
    }
    assert.deepEqual(colors, row.grayscaleRows, `${row.buttonHeight}px button`);
  }
  for (const height of [0, -1, 1.5, 4097, Infinity, NaN]) assert.equal(buttonBackground(height), undefined);
});

test('hinted caption advances match all forty-eight native button widths', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-button-metrics/metrics.json', import.meta.url)));
  for (const row of reference.rows) {
    const pixels = Math.round(row.points * 4 / 3), padding = buttonMetrics({ points: row.points }).horizontalPadding;
    for (const [index, caption] of ['WW', 'MM', 'First command'].entries()) {
      const width = hintedTextWidth(caption, { family: 'ESKA Taxi Sans', pixels, weight: row.weight === 'bold' ? 700 : 400 });
      assert.equal(width + padding * 2 + 2, row.buttons[index].width, `${row.name}: ${caption}`);
    }
  }
});

test('rounded unattenuated kerning matches native Cyrillic and Latin caption widths', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-button-captions/metrics.json', import.meta.url)));
  for (const row of reference.rows) for (const button of row.buttons) {
    const pixels = Math.round(row.points * 4 / 3);
    assert.equal(hintedTextWidth(button.caption, { family: 'ESKA Taxi Sans', pixels, weight: row.weight === 'bold' ? 700 : 400 })
      + 2 * pixels + 2, button.width, `${row.name}: ${button.caption}`);
  }
});

test('font metrics stay tied to the bundled font hashes and bound unsupported measurements', async () => {
  const folder = new URL('../resources/forms/fonts/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', folder)));
  const metrics = JSON.parse(await readFile(new URL('advances.json', folder)));
  assert.equal(metrics.freeType, '2.13.2');
  assert.equal(metrics.interpreterVersion, 40);
  assert.equal(metrics.kerningMode, 'unfitted_round_pixels');
  assert.equal(Object.keys(metrics.faces).length, manifest.files.length);
  for (const file of manifest.files) assert.equal(metrics.faces[file.file].sha256, file.sha256);
  const font = { family: 'ESKA Taxi Sans', pixels: 21, weight: 400 };
  assert.equal(hintedTextWidth('M', font), 18);
  for (const family of ['Unbundled Font', '__proto__', 'constructor', 'toString']) {
    assert.equal(hintedTextWidth('M', { ...font, family }), undefined);
  }
  for (const pixels of [0, 129, 13.5, NaN, Infinity]) assert.equal(hintedTextWidth('M', { ...font, pixels }), undefined);
  for (const text of ['M\u{1f680}', 'e\u0301', 'a\u200d']) assert.equal(hintedTextWidth(text, font), undefined);
  assert.equal(hintedTextWidth('', font), 0);
  for (const family of ['ESKA Taxi Sans', 'ESKA Taxi Serif', 'ESKA Taxi Mono']) {
    for (const weight of [400, 700]) for (const italic of [false, true]) {
      assert.ok(hintedTextWidth('Форма WW', { ...font, family, weight, italic }) > 0);
    }
  }
});
