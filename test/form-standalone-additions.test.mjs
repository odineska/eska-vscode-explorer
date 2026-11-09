import { formReferenceRoot } from './form-references.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { viewStatusChipPixels } from '../webview/forms/view-status-paint.mjs';
import { additionWidth } from '../webview/forms/addition-model.mjs';

const asset = name => new URL(`../resources/forms/${name}`, import.meta.url);
const fixture = new URL('tests/fixtures/forms/native-standalone-additions/metrics.json', formReferenceRoot);

test('standalone additions apply the measured manual caps in character units', () => {
  const properties = Object.entries({ Width: '9', AutoMaxWidth: 'false', MaxWidth: '18' }).map(([name, text]) => ({
    key: { namespace: 'http://v8.1c.ru/8.3/xcf/logform', name }, value: { kind: 'text', text },
  }));
  assert.equal(additionWidth({ kind: 'SearchStringAddition', properties }, 'linux', false, true).maximum, 190);
  assert.equal(additionWidth({ kind: 'SearchControlAddition', properties }, 'linux', false, true).maximum, 180);
  assert.equal(additionWidth({ kind: 'ViewStatusAddition', properties }, 'linux', false, true).maximum, 180);
  assert.equal(additionWidth({ kind: 'SearchStringAddition', properties: [] }, 'linux', true, true).preferred, 111);
});

test('native filter chips preserve enabled, disabled and authored colors in both locales', async () => {
  const metrics = JSON.parse(await readFile(fixture, 'utf8'));
  const engine = createFontRaster(await readFile(asset('native-text/font-raster.wasm')));
  try {
    const face = engine.open(await readFile(asset('fonts/LiberationSans-Regular.ttf')));
    for (const name of ['Stack', 'Styled', 'Disabled']) {
      const row = metrics.rows.find(row => row.name === name);
      for (const locale of ['en', 'ru']) {
        const styled = name === 'Styled';
        const chips = row.locales[locale].regions.status.chips;
        for (const [index, expected] of chips.entries()) {
          const value = index + 1;
          const caption = locale === 'en' ? `Field${value}:` : `Поле${value}:`;
          const label = caption + (locale === 'en' ? ` Value${value}` : ` Значение${value}`);
          const raster = face.raster(label, 13, 12, 3, 'lcd');
          const [, , width, height] = expected.box;
          const image = viewStatusChipPixels(width, styled ? [253, 236, 176] : [255, 255, 255],
            raster.glyphs, caption.length, styled ? [32, 64, 112] : undefined, name !== 'Disabled');
          assert.equal(image.height, height);
          const rgb = image.rgba.filter((_, index) => index % 4 !== 3);
          assert.equal(createHash('sha256').update(rgb).digest('hex'), expected.rgbSha256, `${name}/${locale}/${value}`);
        }
      }
    }
  } finally {
    engine.dispose();
  }
});
