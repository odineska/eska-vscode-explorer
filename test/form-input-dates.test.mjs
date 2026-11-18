import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,inputHeight,inputChoiceButton} from '../webview/forms/model.mjs';
import {inputBorderPixels} from '../webview/forms/input-border.mjs';
const fixture=new URL('tests/fixtures/forms/native-input-dates/',formReferenceRoot);
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
