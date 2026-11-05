import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {geographicalBorderPaint} from '../webview/forms/geographical-border.mjs';
import {documentSurfaceMetrics} from '../webview/forms/document-surface.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform';
test('geographical frames preserve 720 native corner pixels and ten measured sizes',async()=>{
 const matrix=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-geographical/metrics.json',formReferenceRoot)));let compared=0;
 for(const row of matrix.rows){
  const properties=[];for(const name of ['Width','Height']){const m=row.nativeProperties.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'));if(m)properties.push({key:{namespace,name},value:{kind:'text',text:m[1]}});}
  const actual=documentSurfaceMetrics({properties,presentation:{font:{points:10,weight:400}}},'linux');assert.equal(actual.calibrated,true);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);
  const paint=geographicalBorderPaint(row.activeBorder);for(const locale of ['en','ru'])for(const [index,pixels]of paint.corners.entries()){
   assert.equal(createHash('sha256').update(Buffer.from(pixels.flat())).digest('hex'),row.locales[locale].cornerRgbSha256[index],row.name+'/'+locale+'/'+index);compared+=9;
  }
 }
 assert.equal(compared,720);assert.equal(matrix.nativeLocaleDifferences,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
});
