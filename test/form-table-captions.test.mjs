import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
import {buttonCaptionPixels,buttonArrowPixels} from '../webview/forms/button-caption.mjs';
import {inputBorderPixels} from '../webview/forms/input-border.mjs';
import {searchClearPixels} from '../webview/forms/search-control.mjs';
import {lcdCaptionPixels} from '../webview/forms/lcd-caption.mjs';
import {segmentedTextAdvances} from '../webview/forms/font-metrics.mjs';
import {tableScrollbarGrays,tablePaginationGlyphs} from '../webview/forms/table-scrollbar.mjs';

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

test('native DynamicList pagination preserves all 198 glyph pixels in both locales',async()=>{
 const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-context-pixels/metrics.json',import.meta.url))),rows=reference.paginationGlyphs.rows;
 assert.deepEqual(reference.paginationGlyphs.nativeLocalesVerified,['en','ru']);assert.equal(tablePaginationGlyphs.length,4);let pixels=0;
 for(const [index,glyph]of tablePaginationGlyphs.entries()){
  assert.deepEqual([glyph.width,glyph.height],rows[index].region.slice(2));const rgb=Buffer.from(glyph.grays.flatMap(gray=>[gray,gray,gray]));
  assert.equal(createHash('sha256').update(rgb).digest('hex'),rows[index].rgbSha256,`pagination ${index}`);pixels+=glyph.width*glyph.height;
 }
 assert.equal(pixels,198);assert.equal(reference.pixelTolerance,0);assert.deepEqual(reference.comparisonMasks,[]);
});

test('native table menus preserve complete caption bitmaps and dropdown stencils',async()=>{
 const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-table-bars/metrics.json',import.meta.url))).menuCaptions;
 const resource=n=>new URL(`../resources/forms/${n}`,import.meta.url),engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm'))),rgb=rgba=>Buffer.from([...rgba].filter((value,index)=>index%4!==3));
 try{
  const face=engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));let pixels=0;
  for(const row of reference.rows){
   const image=buttonCaptionPixels(face.raster(row.text,13,12,3),26,[77,77,77],[255,255,255]);
   assert.deepEqual([image.width,image.height,image.top],[row.region[2],row.region[3],row.region[1]]);
   assert.equal(createHash('sha256').update(rgb(image.rgba)).digest('hex'),row.rgbSha256,row.form+'/'+row.locale);pixels+=image.width*image.height;
   assert.equal(createHash('sha256').update(rgb(buttonArrowPixels([77,77,77],[255,255,255]))).digest('hex'),row.arrowRgbSha256,row.form+'/'+row.locale+' arrow');
  }
  assert.equal(pixels,6120);assert.equal(reference.arrowPixels,144);
 }finally{engine.dispose();}
});

test('native table search preserves the complete initial 13px LCD variant',async()=>{
 const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-table-search/metrics.json',import.meta.url))),resource=n=>new URL(`../resources/forms/${n}`,import.meta.url),engine=createFontRaster(await readFile(resource('native-text/font-raster.wasm')));
 try{
  const face=engine.open(await readFile(resource('fonts/LiberationSans-Regular.ttf')));let pixels=0;
  for(const form of reference.rows)for(const [locale,row]of Object.entries(form.locales)){
   const q=face.raster(row.text,13,12,3,'lcd'),rgba=lcdCaptionPixels(q,[200,200,200],[255,255,255]),rgb=Buffer.from([...rgba].filter((value,index)=>index%4!==3));
   assert.deepEqual([q.width,q.height],row.nativeRegion.slice(2));assert.equal(createHash('sha256').update(rgb).digest('hex'),row.rgbSha256,form.name+'/'+locale);pixels+=q.width*q.height;
  }
  assert.equal(pixels,10560);assert.equal(reference.nativeVariantSelectionRuleKnown,false);assert.equal(reference.alternate11pxVariantRendered,false);assert.equal(reference.alternate11pxObservations.length,4);
 }finally{engine.dispose();}
});

test('native search fields reuse choice-input corners and preserve the clear glyph',async()=>{
 const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-table-search-fields/metrics.json',import.meta.url))),corners=reference.corners;
 assert.deepEqual(inputBorderPixels(corners.border,corners.background,corners.outside,{choice:true}).corners,corners.rgbCorners);
 const rgb=Buffer.from(searchClearPixels([77,77,77],[255,255,255]).flat());assert.equal(createHash('sha256').update(rgb).digest('hex'),reference.clearStencil.rgbSha256);
 for(const row of reference.rows)for(const entry of Object.values(row.locales))assert.equal(entry.clearRgbSha256,reference.clearStencil.rgbSha256);
 assert.equal(corners.nativeImagesVerified,8);assert.equal(reference.pixelTolerance,0);assert.deepEqual(reference.comparisonMasks,[]);
});
