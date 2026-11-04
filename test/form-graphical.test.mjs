import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {documentSurfaceMetrics} from '../webview/forms/document-surface.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform';
test('graphical schema dimensions match ten native inputs including ignored properties',async()=>{
 const matrix=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-graphical/metrics.json',import.meta.url)));
 for(const row of matrix.rows){const properties=[];for(const name of ['Width','Height']){const m=row.nativeProperties.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'));if(m)properties.push({key:{namespace,name},value:{kind:'text',text:m[1]}});}
  const actual=documentSurfaceMetrics({properties,presentation:{font:{points:10,weight:400}}},'linux');assert.equal(actual.calibrated,true);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);
 }
 assert.equal(matrix.rows.length,10);assert.deepEqual(matrix.rows.filter(q=>q.droppedProperties.length).map(q=>q.droppedProperties),[['BackColor'],['ShowGrid'],['ShowGrid']]);assert.equal(matrix.grid.step,20);assert.equal(matrix.nativeLocaleDifferences,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
});
