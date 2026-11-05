import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {calendarSurfaceMetrics,calendarSurfaceRgba,calendarTextAdvances} from '../webview/forms/calendar-surface.mjs';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform',base=new URL('tests/fixtures/forms/native-calendar/',formReferenceRoot);
async function matrix(){return JSON.parse(await readFile(new URL('metrics.json',base)));}
function node(row){return {properties:Object.entries(row.renderProperties).map(([name,text])=>({key:{namespace,name},value:{kind:'text',text}})),presentation:{font:{face:null,...row.font}}};}
test('calendar month counts and recorded fonts size every full native control',async()=>{
 const m=await matrix();assert.equal(m.rows.length,22);for(const row of m.rows){const actual=calendarSurfaceMetrics(node(row),'linux');assert.equal(actual.calibrated,true,row.name);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);}
 const first=node(m.rows[0]);assert.equal(calendarSurfaceMetrics(first,'win32').calibrated,false);first.presentation.font.points=14;assert.equal(calendarSurfaceMetrics(first,'linux').calibrated,false);
 assert.deepEqual(m.rows.filter(q=>q.droppedProperties.length).map(q=>q.droppedProperties),[['BackColor']]);assert.equal(m.referenceLocalDate,'2026-11-05');
});
test('calendar text, grid, selected date and months panel match all 44 full native surfaces',async()=>{
 const m=await matrix(),engine=createFontRaster(new Uint8Array(await readFile(new URL('../resources/forms/native-text/font-raster.wasm',import.meta.url))));
 try{const faces=new Map();for(const [weight,name]of [[400,'Regular'],[700,'Bold']])faces.set(weight,engine.open(new Uint8Array(await readFile(new URL('../resources/forms/fonts/LiberationSans-'+name+'.ttf',import.meta.url)))));let pixels=0;
  for(const row of m.rows){const metrics=calendarSurfaceMetrics(node(row),'linux'),raster=text=>faces.get(metrics.profile.weight).raster(text,metrics.pixels,metrics.ascent,metrics.descent,'lcd',calendarTextAdvances(text,metrics)),[w,h]=row.nativeSize;
   for(const locale of ['en','ru']){const rgba=calendarSurfaceRgba(metrics,{date:new Date(m.referenceLocalDate+'T12:00:00'),culture:m.culture,todayLabel:row.locales[locale].todayLabel,inactive:row.renderProperties.Enabled==='false'||row.renderProperties.ReadOnly==='true'},raster),rgb=new Uint8Array(w*h*3);assert.ok(rgba,row.name);let index=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)rgb[index++]=x===0||y===0||x===w-1||y===h-1?row.outerBorder[c]:rgba[((y-1)*(w-2)+x-1)*4+c];
    assert.equal(createHash('sha256').update(rgb).digest('hex'),row.locales[locale].rgbSha256,row.name+' '+locale);pixels+=w*h;
   }
  }assert.equal(pixels,m.surface.nativePixels);assert.equal(m.pixelTolerance,0);assert.deepEqual(m.comparisonMasks,[]);
  const metrics=calendarSurfaceMetrics(node(m.rows[0]),'linux');assert.equal(calendarSurfaceRgba(metrics,{date:new Date(),culture:'ru-RU'},()=>{}),undefined);
 }finally{engine.dispose();}
});
