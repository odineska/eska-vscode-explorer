import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {textDocumentMetrics} from '../webview/forms/text-document.mjs';
const namespace='http://v8.1c.ru/8.3/xcf/logform';
test('empty text document dimensions match eight native XML sources; font variants stay unaccepted',async()=>{
 const base=new URL('../../eska/tests/fixtures/forms/native-text-documents/',import.meta.url),matrix=JSON.parse(await readFile(new URL('metrics.json',base)));let candidates=0;
 for(const expected of matrix.rows){
  const xml=await readFile(new URL(expected.file,base),'utf8'),field=xml.match(/<TextDocumentField\b[\s\S]*?<\/TextDocumentField>/)[0],properties=[];
  for(const name of ['Width','Height']){const value=field.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'));if(value)properties.push({key:{namespace,name},value:{kind:'text',text:value[1]}});}
  const font=field.match(/<Font\b([^>]*)/),attribute=name=>font?.[1].match(new RegExp('\\b'+name+'="([^"]+)"'))?.[1];
  const node={properties,presentation:{font:{points:Number(attribute('height')??10),weight:attribute('bold')==='true'?700:400}}},actual=textDocumentMetrics(node,'linux');
  assert.equal(actual.calibrated,expected.calibrationCandidate,expected.name);
  if(actual.calibrated){assert.deepEqual([actual.width,actual.height],expected.nativeSize,expected.name);candidates++;}
  assert.equal(textDocumentMetrics(node,'win32').calibrated,false);
 }
 assert.equal(candidates,8);assert.equal(matrix.nativeLocaleDifferences,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
});
