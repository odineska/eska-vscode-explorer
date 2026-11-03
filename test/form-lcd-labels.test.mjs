import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { lcdCaptionPixels } from '../webview/forms/lcd-caption.mjs';
import { fontLineMetrics } from '../webview/forms/model.mjs';

test('colored LCD field captions match every native pixel including overlapping glyphs', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-groups/label-pixels.json', import.meta.url)));
  const resource = name => new URL(`../resources/forms/${name}`, import.meta.url);
  const engine = createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
  try {
    const face = engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));
    for (const row of reference.rows) {
      const { pixels, ascent, descent } = fontLineMetrics(row);
      const raster = face.raster(row.caption, pixels, ascent, descent, 'lcd');
      const color = rgb => rgb.slice(1).match(/../g).map(value => parseInt(value, 16));
      const rgba = lcdCaptionPixels(raster, color(row.foreground), color(row.background));
      const [, , width, height] = row.region, image = Buffer.alloc(width * height * 3, 255);
      const left = row.textOriginX + raster.originX, top = row.baseline - ascent + raster.originY;
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
        const tx = left + x, ty = top + y;
        if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
        for (let channel = 0; channel < 3; channel++) image[(ty * width + tx) * 3 + channel] = rgba[(y * raster.width + x) * 4 + channel];
      }
      assert.equal(createHash('sha256').update(image).digest('hex'), row.rgbSha256, row.caption);
    }
  } finally { engine.dispose(); }
});
