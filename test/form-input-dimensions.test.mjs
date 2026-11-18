import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,fieldStyle,inputHeight} from '../webview/forms/model.mjs';

const fixture=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-input-dimensions/metrics.json',formReferenceRoot)));
const node=field=>({kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,valueType:field.type}});

test('explicit input widths and conflicting non-stretching bounds match forty native forms',()=>{
  let fields=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const input=node(field),style=fieldStyle(input,'linux'),label=form.name+' '+field.name;
    assert.equal(fieldWidth(input,'linux'),field.logicalWidth,label);
    assert.equal(style.width,field.logicalWidth+'px',label);
    assert.equal(style['min-width'],undefined,label);assert.equal(style['max-width'],undefined,label);
    assert.equal(inputHeight(input,'linux'),field.rect[3],label);fields++;
  }
  assert.equal(fields,160);
});
