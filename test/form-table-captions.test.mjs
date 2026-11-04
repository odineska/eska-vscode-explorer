import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
import {lcdCaptionPixels} from '../webview/forms/lcd-caption.mjs';
import {segmentedTextAdvances} from '../webview/forms/font-metrics.mjs';
import {tableScrollbarGrays} from '../webview/forms/table-scrollbar.mjs';

test('native table captions preserve fragment boundaries and all 3885 LCD pixels',async()=>{
 const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-table-pixels/metrics.json',import.meta.url)));
 const resource=n=>new URL(`../resources/forms/${n}`,import.meta.url),engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
 try{
  const face=engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));let compared=0;
  for(const row of reference.captions.rows){
   const options={family:'ESKA Taxi Sans',pixels:13,weight:400},advances=row.segments?segmentedTextAdvances(row.segments,options):undefined;
   const raster=face.raster(row.text,13,row.ascent,row.descent,'lcd',advances),color=hex=>hex.slice(1).match(/../g).map(c=>parseInt(c,16)),rgba=lcdCaptionPixels(raster,color(row.foreground),color(row.background));
   assert.deepEqual([raster.width,raster.height],row.region.slice(2),row.name);assert.equal(raster.advance,row.advance,row.name+' advance');
   const rgb=Buffer.alloc(raster.width*raster.height*3);for(let i=0;i<raster.width*raster.height;i++)for(let c=0;c<3;c++)rgb[i*3+c]=rgba[i*4+c];
   assert.equal(createHash('sha256').update(rgb).digest('hex'),row.rgbSha256,row.name);compared+=raster.width*raster.height;
  }
  assert.equal(compared,3885);assert.equal(reference.pixelTolerance,0);assert.deepEqual(reference.comparisonMasks,[]);
  const arrow=Buffer.from(tableScrollbarGrays.flatMap(gray=>[gray,gray,gray]));assert.equal(createHash('sha256').update(arrow).digest('hex'),reference.scrollbar.upperRgbSha256);assert.equal(reference.scrollbar.nativeImagesVerified,18);
 }finally{engine.dispose();}
});
