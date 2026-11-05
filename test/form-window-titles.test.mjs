import {formReferenceRoot} from './form-references.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { lcdCaptionPixels } from '../webview/forms/lcd-caption.mjs';
import { designTextAdvances } from '../webview/forms/font-metrics.mjs';

test('window captions match native Latin, Cyrillic, kerning, diacritics and clipped long text', async()=>{
  const reference=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-form-titles/metrics.json',formReferenceRoot)));
  const resource=name=>new URL(`../resources/forms/${name}`,import.meta.url);
  const engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
  try {
    const face=engine.open(await readFile(resource('fonts/LiberationSans-Bold.ttf')));
    for(const row of reference.rows) {
      const advances=designTextAdvances(row.caption,{family:'ESKA Taxi Sans',pixels:11,weight:700});
      const raster=face.raster(row.caption,11,10,3,'lcd',advances),rgba=lcdCaptionPixels(raster,row.foreground,row.background);
      const [rx,ry,w,h]=row.region,image=Buffer.alloc(w*h*3);
      for(let i=0;i<w*h;i++)image.set(row.background,i*3);
      for(let y=0;y<raster.height;y++)for(let x=0;x<raster.width;x++){
        const tx=row.titleBounds[0]+row.leftInTitle+raster.originX+x-rx;
        const ty=row.titleBounds[1]+row.baselineInTitle-10+raster.originY+y-ry;
        if(tx<0||tx>=w||ty<0||ty>=h)continue;
        for(let c=0;c<3;c++)image[(ty*w+tx)*3+c]=rgba[(y*raster.width+x)*4+c];
      }
      assert.equal(createHash('sha256').update(image).digest('hex'),row.rgbSha256,row.name);
    }
    for(const advances of [[1],[-1,1],[1,Infinity],Array(2)])
      assert.throws(()=>face.raster('AV',11,10,3,'lcd',advances),/font-raster-advances/);
    assert.equal(designTextAdvances('AV',{family:'Other',pixels:11,weight:700}),undefined);
  } finally {engine.dispose();}
});
