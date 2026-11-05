import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chartSurfaceMetrics,chartSurfaceRgba,chartBorderColor,chartLayout,chartSampleValues} from '../webview/forms/chart-surface.mjs';
import {createFontRaster} from '../webview/forms/font-raster.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform',base=new URL('../../eska/tests/fixtures/forms/native-chart/',import.meta.url);
async function matrix(){return JSON.parse(await readFile(new URL('metrics.json',base)));}
function node(row){return {properties:Object.entries(row.renderProperties).map(([name,text])=>({key:{namespace,name},value:{kind:'text',text}})),presentation:{font:{face:null,...row.font}}};}
function fullRgb(row,rgba){const [w,h]=row.nativeSize,rgb=new Uint8Array(w*h*3);let index=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)rgb[index++]=x===0||y===0||x===w-1||y===h-1?row.outerBorder[c]:rgba[((y-1)*(w-2)+x-1)*4+c];return rgb;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Chart dimensions, ignored properties and inactive border follow native export',async()=>{
 const m=await matrix();assert.equal(m.rows.length,12);assert.deepEqual(chartSampleValues,m.viewerSampleValues);
 for(const row of m.rows){const n=node(row);if(row.requestedFont)n.presentation.font={points:Number(row.requestedFont.height),weight:row.requestedFont.bold==='true'?700:400};const actual=chartSurfaceMetrics(n,'linux');assert.equal(actual.calibrated,true,row.name);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);n.presentation.border={kind:'rgb',red:0,green:0,blue:255};assert.equal(chartBorderColor(n),'#'+row.outerBorder.map(v=>v.toString(16).padStart(2,'0')).join(''),row.name+' border');}
 assert.equal(chartSurfaceMetrics(node(m.rows[0]),'win32').calibrated,false);const other=node(m.rows[0]);other.properties.push({key:{namespace,name:'Height'},value:{kind:'text',text:'7'}});assert.equal(chartSurfaceMetrics(other,'linux').calibrated,false);
 assert.deepEqual(m.rows.filter(q=>q.droppedProperties.length).map(q=>[q.name,q.droppedProperties]),[['E_Border',['BorderColor']],['F_Background',['BackColor']],['K_Font12',['Font']],['L_Font16Bold',['Font']]]);
});
test('Chart matches all 24 complete native surfaces with observed sample heights and all independent viewer oracles',async()=>{
 const m=await matrix(),engine=createFontRaster(new Uint8Array(await readFile(new URL('../resources/forms/native-text/font-raster.wasm',import.meta.url))));
 try{const face=engine.open(new Uint8Array(await readFile(new URL('../resources/forms/fonts/LiberationSans-Regular.ttf',import.meta.url)))),raster=text=>face.raster(text,13,12,3,'lcd'),rotated=text=>face.rotated(text,13);let pixels=0,staticPixels=0;
  for(const row of m.rows)for(const locale of ['en','ru']){
   const metrics=chartSurfaceMetrics(node(row),'linux'),expected=row.locales[locale],labels={culture:m.culture,point:expected.chartPoint,series:expected.chartSeries},layout=chartLayout(metrics,labels),reference=chartSurfaceRgba(metrics,labels,raster,rotated,expected.referenceSampleValues),viewer=chartSurfaceRgba(metrics,labels,raster,rotated);
   assert.ok(reference,row.name);assert.equal(sha(fullRgb(row,reference)),expected.rgbSha256,row.name+' '+locale+' complete native pixels');assert.equal(sha(fullRgb(row,viewer)),expected.viewerOracle.rgbSha256,row.name+' '+locale+' independent full viewer oracle');
   for(const key of ['axisX','plotWidth','plotBottom','rotated','step','legendX','legendRowHeight'])assert.deepEqual(layout[key],expected.layout[key],row.name+' '+locale+' '+key);
   assert.equal(expected.viewerOracle.differentPixelsOutsideRandomValues,0);assert.equal(expected.viewerOracle.regions.length,16);for(const region of expected.viewerOracle.regions){assert.equal(region.unionRegion[1]+region.unionRegion[3],layout.plotBottom);assert.ok(region.nativeHeightBins>=0&&region.nativeHeightBins<=layout.plotHeight*15);assert.equal(region.viewerHeightBins,Math.round(chartSampleValues[region.point][region.series]*layout.plotHeight*15/20));}
   pixels+=expected.pixels;staticPixels+=expected.viewerOracle.staticComparedPixels;
  }
  assert.equal(pixels,m.surface.nativePixels);assert.equal(pixels,2755800);assert.equal(staticPixels,1933732);assert.equal(m.pixelTolerance,0);assert.deepEqual(m.comparisonMasks.map(q=>q.kind),['random_chart_sample_values']);
  const metrics=chartSurfaceMetrics(node(m.rows[0]),'linux');assert.equal(chartSurfaceRgba(metrics,{culture:'ru-RU'},raster,rotated),undefined);assert.equal(chartSurfaceRgba(metrics,{point:'Other'},raster,rotated),undefined);assert.equal(chartSurfaceRgba(metrics,{},raster,rotated,[[NaN]]),undefined);const invalid=chartSampleValues.map(row=>[...row]);invalid[0][0]=21;assert.equal(chartSurfaceRgba(metrics,{},raster,rotated,invalid),undefined);
 }finally{engine.dispose();}
});
