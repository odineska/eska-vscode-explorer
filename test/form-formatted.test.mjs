import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {documentSurfaceMetrics} from '../webview/forms/document-surface.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform';
test('formatted document dimensions and empty surface match ten native XML inputs',async()=>{
 const base=new URL('tests/fixtures/forms/native-formatted/',formReferenceRoot),matrix=JSON.parse(await readFile(new URL('metrics.json',base)));
 for(const row of matrix.rows){const properties=[];for(const name of ['Width','Height']){const m=row.nativeProperties.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'));if(m)properties.push({key:{namespace,name},value:{kind:'text',text:m[1]}});}
  const node={properties,presentation:{font:{points:10,weight:400}}},actual=documentSurfaceMetrics(node,'linux');assert.equal(actual.calibrated,true);assert.deepEqual([actual.width,actual.height],row.nativeSize,row.name);assert.equal(documentSurfaceMetrics(node,'win32').calibrated,false);
 }
 assert.equal(matrix.rows.length,10);assert.deepEqual(matrix.rows.filter(q=>q.droppedProperties.length).map(q=>q.droppedProperties),[['ShowToolbar'],['ShowToolbar']]);
 const background=matrix.rows.find(q=>q.name==='F_Background'),xml=await readFile(new URL(background.nativeExport,base),'utf8');assert.match(xml,/<BackColor>web:Black<\/BackColor>/);assert.deepEqual(background.visuallyIgnoredProperties,['BackColor']);assert.deepEqual(matrix.surface.backgroundRgb,[255,255,255]);assert.equal(matrix.surface.toolbarVisible,false);assert.equal(matrix.nativeLocaleDifferences,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
});
