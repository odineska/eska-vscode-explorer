import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dendrogramSurfaceMetrics,dendrogramSurfaceRgba,dendrogramBorderColor} from '../webview/forms/dendrogram-surface.mjs';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform',base=new URL('tests/fixtures/forms/native-dendrogram/',formReferenceRoot);
async function matrix(){return JSON.parse(await readFile(new URL('metrics.json',base)));}
function node(row){return {properties:Object.entries(row.renderProperties).map(([name,text])=>({key:{namespace,name},value:{kind:'text',text}})),presentation:{font:{face:null,...row.font}}};}
test('dendrogram native dimensions ignore unsupported appearance properties',async()=>{
 const m=await matrix();assert.equal(m.rows.length,12);for(const row of m.rows){const n=node(row);if(row.requestedFont)n.presentation.font={points:Number(row.requestedFont.height),weight:row.requestedFont.bold==='true'?700:400};const actual=dendrogramSurfaceMetrics(n,'linux');assert.equal(actual.calibrated,true,row.name);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);n.presentation.border={kind:'rgb',red:0,green:0,blue:255};assert.equal(dendrogramBorderColor(n),'#'+row.outerBorder.map(v=>v.toString(16).padStart(2,'0')).join(''),row.name+' border');}
 assert.equal(dendrogramSurfaceMetrics(node(m.rows[0]),'win32').calibrated,false);const other=node(m.rows[0]);other.properties.push({key:{namespace,name:'Height'},value:{kind:'text',text:'7'}});assert.equal(dendrogramSurfaceMetrics(other,'linux').calibrated,false);
 assert.deepEqual(m.rows.filter(q=>q.droppedProperties.length).map(q=>[q.name,q.droppedProperties]),[['E_Border',['BorderColor']],['F_Background',['BackColor']],['K_Font12',['Font']],['L_Font16Bold',['Font']]]);
});
test('dendrogram axes, branches, font and elided captions match all 24 full native surfaces',async()=>{
 const m=await matrix(),engine=createFontRaster(new Uint8Array(await readFile(new URL('../resources/forms/native-text/font-raster.wasm',import.meta.url))));
 try{const face=engine.open(new Uint8Array(await readFile(new URL('../resources/forms/fonts/LiberationSans-Regular.ttf',import.meta.url)))),raster=text=>face.raster(text,13,12,3,'lcd');let pixels=0;
  for(const row of m.rows){const metrics=dendrogramSurfaceMetrics(node(row),'linux'),[w,h]=row.nativeSize;
   for(const locale of ['en','ru']){const expected=row.locales[locale],rgba=dendrogramSurfaceRgba(metrics,{culture:m.culture,element:expected.chartElement},raster),rgb=new Uint8Array(w*h*3);assert.ok(rgba,row.name);let index=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)rgb[index++]=x===0||y===0||x===w-1||y===h-1?row.outerBorder[c]:rgba[((y-1)*(w-2)+x-1)*4+c];
    assert.equal(createHash('sha256').update(rgb).digest('hex'),expected.rgbSha256,row.name+' '+locale);pixels+=w*h;
   }
  }assert.equal(pixels,m.surface.nativePixels);assert.equal(m.pixelTolerance,0);assert.deepEqual(m.comparisonMasks,[]);
  const metrics=dendrogramSurfaceMetrics(node(m.rows[0]),'linux');assert.equal(dendrogramSurfaceRgba(metrics,{date:new Date(),culture:'ru-RU'},()=>{}),undefined);
 }finally{engine.dispose();}
});
