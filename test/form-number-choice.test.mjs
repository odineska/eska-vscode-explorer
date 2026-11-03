import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {calculatorRects} from '../webview/forms/input-calculator.mjs';

test('numeric-choice mark and separator match native normal and enlarged inputs',async()=>{
 const reference=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-state-variants/number-choice-pixels.json',import.meta.url)));
 for(const row of reference.rows){
  const [,,w,h]=row.region,image=Buffer.alloc(w*h*3,255);
  for(let y=0;y<h;y++)image.set(reference.separator,y*w*3);
  for(const [x,y,width,height,fill]of calculatorRects){
   const color=fill.slice(1).match(/../g).map(channel=>parseInt(channel,16));
   for(let j=0;j<height;j++)for(let i=0;i<width;i++)image.set(color,((y+j+Math.floor((h-11)/2)-1)*w+x+i+6)*3);
  }
  assert.equal(createHash('sha256').update(image).digest('hex'),row.rgbSha256,row.name);
 }
});
