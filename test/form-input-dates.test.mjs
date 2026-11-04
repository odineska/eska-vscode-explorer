import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,inputHeight,inputChoiceButton} from '../webview/forms/model.mjs';
import {inputBorderPixels} from '../webview/forms/input-border.mjs';
import {calendarImage} from '../webview/forms/input-calendar.mjs';
const fixture=new URL('../../eska/tests/fixtures/forms/native-input-dates/',import.meta.url);
test('native date geometry, automatic choices and inactive corners match twenty-six forms',async()=>{
  const reference=JSON.parse(await readFile(new URL('metrics.json',fixture)));let dates=0;
  for(const form of reference.forms)for(const field of form.fields.filter(f=>f.type.kind==='date')){
    const node={kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,valueType:field.type}},label=form.name;
    assert.equal(inputChoiceButton(node,'linux'),field.choice,label+' choice');
    assert.equal(fieldWidth(node,'linux'),field.logicalWidth,label+' width');
    assert.equal(inputHeight(node,'linux'),field.rect[3],label+' height');
    const paint=inputBorderPixels(field.border,field.background,field.outside,{inactive:field.inactive,choice:field.choice,explicitBorder:field.explicitBorder});
    for(const [index,key]of ['topLeft','topRight','bottomLeft','bottomRight'].entries())assert.equal(Buffer.from(paint.corners[index].flat()).toString('hex'),field.cornersRgb[key],label+' '+key);
    dates++;
  }
  assert.equal(dates,26);
});
test('all ten active and inactive calendar image sizes match native RGB samples',async()=>{
  const reference=JSON.parse(await readFile(new URL('calendar-images.json',fixture)));
  for(const sample of reference.images){
    const drawing=calendarImage(sample.size+2,sample.inactive),rgb=Buffer.alloc(sample.size*sample.size*3,255);
    assert.equal(drawing.size,sample.size);
    for(const [x,y,w,h,fill]of drawing.rects){const color=fill.slice(1).match(/../g).map(v=>parseInt(v,16));for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)rgb.set(color,((y+dy)*sample.size+x+dx)*3);}
    assert.equal(createHash('sha256').update(rgb).digest('hex'),sample.rgbSha256,sample.name);
  }
  assert.equal(reference.images.length,10);
  assert.equal(calendarImage(8,false),undefined);
});
