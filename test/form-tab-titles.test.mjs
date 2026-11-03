import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { lcdCaptionPixels } from '../webview/forms/lcd-caption.mjs';
import { fontLineMetrics } from '../webview/forms/model.mjs';
import { tabMetrics } from '../webview/forms/tab-metrics.mjs';

test('shared tab metrics and LCD pixels match native individual fonts, colors and inherited page titles', async () => {
  const reference = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-tab-appearance/metrics.json', import.meta.url)));
  const resource = name => new URL(`../resources/forms/${name}`, import.meta.url);
  const engine = createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
  try {
    const faces = await Promise.all(['Regular','Bold'].map(async name => engine.open(await readFile(resource(`fonts/LiberationSans-${name}.ttf`)))));
    for (const row of reference.rows) {
      const allocation = tabMetrics(row.captions.map(caption => caption.font));
      assert.equal(allocation.calibrated,true);
      for (const expected of row.captions) {
        const { pixels,ascent,descent } = fontLineMetrics(expected.font);
        const raster = faces[expected.font.weight===700?1:0].raster(expected.text,pixels,ascent,descent,'lcd');
        assert.equal(allocation.height,expected.tab[3],row.name);
        assert.equal(raster.advance + 2*allocation.horizontalPadding+2,expected.tab[2],row.name);
        const baseline=Math.round((allocation.height+ascent-descent)/2)-1;
        assert.equal(baseline,expected.baseline,row.name);
        const rgba=lcdCaptionPixels(raster,expected.foreground,expected.background);
        assert.deepEqual([raster.width,raster.height],expected.region.slice(2));
        const rgb=Buffer.alloc(raster.width*raster.height*3);
        for(let i=0;i<raster.width*raster.height;i++)for(let c=0;c<3;c++)rgb[i*3+c]=rgba[i*4+c];
        assert.equal(createHash('sha256').update(rgb).digest('hex'),expected.rgbSha256,`${row.name}: ${expected.text}`);
      }
    }
  } finally { engine.dispose(); }
});

test('unmeasured page title sizes retain fallback geometry without claiming calibrated placement',()=>{
  assert.equal(tabMetrics([{points:13}]).calibrated,false);
  assert.equal(tabMetrics([{points:9},{points:16}]).calibrated,false);
  assert.equal(tabMetrics([]).calibrated,true);
});
