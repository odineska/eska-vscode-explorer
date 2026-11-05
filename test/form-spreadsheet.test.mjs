import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {documentSurfaceMetrics} from '../webview/forms/document-surface.mjs';
import {spreadsheetSurfaceRgba,spreadsheetSurfaceSize} from '../webview/forms/spreadsheet-surface.mjs';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform',base=new URL('../../eska/tests/fixtures/forms/native-spreadsheet/',import.meta.url);
async function matrix(){return JSON.parse(await readFile(new URL('metrics.json',base)));}
test('spreadsheet dimensions and omitted defaults match twelve native XML inputs',async()=>{
 const m=await matrix();assert.equal(m.rows.length,12);
 for(const row of m.rows){const properties=[];for(const name of ['Width','Height']){const value=row.nativeProperties.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'));if(value)properties.push({key:{namespace,name},value:{kind:'text',text:value[1]}});}const actual=documentSurfaceMetrics({properties,presentation:{font:{points:10,weight:400}}},'linux');assert.equal(actual.calibrated,true);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);}
 assert.deepEqual(m.rows.filter(q=>q.droppedProperties.length).map(q=>q.droppedProperties),[['BackColor']]);assert.deepEqual(m.rows.filter(q=>q.omittedDefaultProperties.length).map(q=>q.omittedDefaultProperties),[['ShowGrid'],['ShowHeaders']]);
 assert.equal(spreadsheetSurfaceSize(4096,4096),false);assert.equal(spreadsheetSurfaceSize(500,4097),false);assert.equal(spreadsheetSurfaceRgba(500.5,243),undefined);assert.equal(spreadsheetSurfaceRgba(500,243,false,true),undefined);
});
test('spreadsheet paint, tabular LCD digits and premultiplied bevel text match every native pixel',async()=>{
 const m=await matrix(),engine=createFontRaster(new Uint8Array(await readFile(new URL('../resources/forms/native-text/font-raster.wasm',import.meta.url))));
 try{const regular=engine.open(new Uint8Array(await readFile(new URL('../resources/forms/fonts/LiberationSans-Regular.ttf',import.meta.url)))),bold=engine.open(new Uint8Array(await readFile(new URL('../resources/forms/fonts/LiberationSans-Bold.ttf',import.meta.url)))),raster=(text,selected)=>(selected?bold:regular).raster(text,11,10,3,'lcd',[...text].map(()=>6));let pixels=0;
  for(const row of m.rows){const [w,h]=row.nativeSize,rgba=spreadsheetSurfaceRgba(w,h,row.showGrid,row.showHeaders,raster),rgb=new Uint8Array(w*h*3);let n=0;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)rgb[n++]=x===0||y===0||x===w-1||y===h-1?row.outerBorder[c]:rgba[((y-1)*(w-2)+x-1)*4+c];
   const hash=createHash('sha256').update(rgb).digest('hex');for(const locale of ['en','ru'])assert.equal(hash,row.locales[locale].rgbSha256,row.name+' '+locale);pixels+=w*h*2;
  }assert.equal(pixels,2629800);assert.equal(m.surface.nativePixels,pixels);assert.equal(m.nativeLocaleDifferences,0);assert.equal(m.pixelTolerance,0);assert.deepEqual(m.comparisonMasks,[]);
 }finally{engine.dispose();}
});
