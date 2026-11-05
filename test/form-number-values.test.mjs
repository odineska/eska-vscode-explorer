import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
import {lcdCaptionPixels} from '../webview/forms/lcd-caption.mjs';
import {fontLineMetrics} from '../webview/forms/model.mjs';

test('numeric value pixels match native normal, enlarged and explicitly colored inputs',async()=>{
 const reference=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-state-variants/number-value-pixels.json',formReferenceRoot)));
 const resource=name=>new URL(`../resources/forms/${name}`,import.meta.url);
 const engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
 try{
  const face=engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));
  for(const row of reference.rows){
   const {pixels,ascent,descent}=fontLineMetrics(row.font),raster=face.raster(row.caption,pixels,ascent,descent,'lcd');
   assert.deepEqual([raster.width,raster.height],row.region.slice(2));
   const rgba=lcdCaptionPixels(raster,row.foreground,row.background),rgb=Buffer.alloc(raster.width*raster.height*3);
   for(let i=0;i<raster.width*raster.height;i++)for(let c=0;c<3;c++)rgb[i*3+c]=rgba[i*4+c];
   assert.equal(createHash('sha256').update(rgb).digest('hex'),row.rgbSha256,row.name);
  }
 }finally{engine.dispose();}
});
