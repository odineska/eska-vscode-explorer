import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pdfSurfaceMetrics,pdfSurfaceRgba} from '../webview/forms/pdf-surface.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform',base=new URL('../../eska/tests/fixtures/forms/native-pdf/',import.meta.url);
async function matrix(){return JSON.parse(await readFile(new URL('metrics.json',base)));}
function node(row){const properties=[];for(const name of ['Width','Height']){const m=row.nativeProperties.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'));if(m)properties.push({key:{namespace,name},value:{kind:'text',text:m[1]}});}return {properties,presentation:{font:{points:10,weight:400}},auxiliary:[{kind:'ViewStatusAddition',presentation:{displayed:row.viewStatusVisible},properties:[]}]};}
test('PDF dimensions respect the measured view-status minimum and short height axes',async()=>{
 const m=await matrix();assert.equal(m.rows.length,18);
 for(const row of m.rows){const actual=pdfSurfaceMetrics(node(row),'linux');assert.equal(actual.calibrated,true,row.name);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);assert.equal(pdfSurfaceMetrics(node(row),'win32').calibrated,false);}
 const unseen=node({nativeProperties:'<Width>21</Width>',viewStatusVisible:false});assert.equal(pdfSurfaceMetrics(unseen,'linux').calibrated,false);assert.equal(pdfSurfaceRgba(210,243),undefined);assert.equal(pdfSurfaceRgba(500,120),undefined);assert.equal(m.surface.generalThumbRuleAccepted,false);
});
test('shared PDF scrollbar fragments reproduce every pixel of eighteen native source surfaces',async()=>{
 const m=await matrix();let pixels=0;
 for(const row of m.rows){const [w,h]=row.nativeSize,rgba=pdfSurfaceRgba(w,h,row.name!=='D_Disabled'),rgb=new Uint8Array(w*h*3);let n=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++)rgb[n++]=x===0||y===0||x===w-1||y===h-1?row.outerBorder[c]:rgba[((y-1)*(w-2)+x-1)*4+c];
  const hash=createHash('sha256').update(rgb).digest('hex');for(const locale of ['en','ru'])assert.equal(hash,row.locales[locale].rgbSha256,row.name+' '+locale);pixels+=w*h*2;
 }
 assert.equal(pixels,3103860);assert.equal(m.surface.nativeCompletePixelsVerified,pixels);assert.equal(m.nativeLocaleDifferences,0);assert.equal(m.pixelTolerance,0);assert.deepEqual(m.comparisonMasks,[]);
});
