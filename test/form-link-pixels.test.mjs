import {formReferenceRoot} from './form-references.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { lcdCaptionPixels } from '../webview/forms/lcd-caption.mjs';
import { fontLineMetrics } from '../webview/forms/model.mjs';

test('hyperlink captions include all 2100 native LCD and underline pixels', async () => {
  const reference=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-button-types/link-pixels.json',formReferenceRoot)));
  const resource=name=>new URL(`../resources/forms/${name}`,import.meta.url);
  const engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
  try {
    const face=engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));
    let compared=0;
    for(const row of reference.rows){
      const {pixels,ascent,descent}=fontLineMetrics(row),raster=face.raster(row.text,pixels,ascent,descent,'lcd');
      const color=hex=>hex.slice(1).match(/../g).map(value=>parseInt(value,16));
      const rgba=lcdCaptionPixels(raster,color(row.foreground),color(row.background),true);
      assert.deepEqual([raster.width,raster.height],row.region.slice(2),row.name+' bitmap');
      const rgb=Buffer.alloc(raster.width*raster.height*3);for(let n=0;n<raster.width*raster.height;n++)for(let c=0;c<3;c++)rgb[n*3+c]=rgba[n*4+c];
      assert.equal(createHash('sha256').update(rgb).digest('hex'),row.rgbSha256,row.name);
      compared+=raster.width*raster.height;
    }
    assert.equal(compared,2100);assert.equal(reference.pixelTolerance,0);assert.deepEqual(reference.comparisonMasks,[]);
  } finally {engine.dispose();}
});

test('mixed button rows add six complete native LCD captions and 3330 pixels', async () => {
  const reference=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-button-rows/metrics.json',formReferenceRoot))).linkCaptions;
  const resource=name=>new URL(`../resources/forms/${name}`,import.meta.url),engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
  try {
    const face=engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));let compared=0;
    for(const row of reference.rows){
      const {pixels,ascent,descent}=fontLineMetrics(row),raster=face.raster(row.text,pixels,ascent,descent,'lcd'),color=hex=>hex.slice(1).match(/../g).map(c=>parseInt(c,16));
      const rgba=lcdCaptionPixels(raster,color(row.foreground),color(row.background),true),rgb=Buffer.alloc(raster.width*raster.height*3);
      assert.deepEqual([raster.width,raster.height],row.region.slice(2),row.name);
      for(let n=0;n<raster.width*raster.height;n++)for(let c=0;c<3;c++)rgb[n*3+c]=rgba[n*4+c];
      assert.equal(createHash('sha256').update(rgb).digest('hex'),row.rgbSha256,row.name);compared+=raster.width*raster.height;
    }
    assert.equal(compared,3330);assert.equal(reference.pixelTolerance,0);assert.deepEqual(reference.comparisonMasks,[]);
  } finally {engine.dispose();}
});
