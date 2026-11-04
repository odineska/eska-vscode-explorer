import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,fieldStyle,inputHeight} from '../webview/forms/model.mjs';
const fixture=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-input-stretch/metrics.json',import.meta.url)));
test('stretching retains measured intrinsic preferences before filling the native column',()=>{
  let fields=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const node={kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,valueType:field.type}},label=form.name+' '+field.name,style=fieldStyle(node,'linux');
    assert.equal(fieldWidth(node,'linux'),field.preferredLogicalWidth,label);
    assert.equal(style.width,field.preferredLogicalWidth+'px',label);
    assert.equal(style['max-width'],undefined,label);
    assert.equal(!!style['min-width'],form.name.startsWith('Stretch')||field.type.kind==='string',label);
    assert.equal(inputHeight(node,'linux'),field.rect[3],label);fields++;
  }
  assert.equal(fields,64);
});
