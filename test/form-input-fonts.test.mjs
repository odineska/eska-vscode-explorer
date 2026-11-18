import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,inputHeight,inputRowHeight} from '../webview/forms/model.mjs';
const fixture=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-input-fonts/metrics.json',formReferenceRoot)));
test('line allocations match thirty-four native font cases, including thirteen independent normal sizes',()=>{
  let fields=0,independent=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const node={kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,titleFont:{points:10,weight:400},titleLocation:'Left',valueType:field.type}},label=form.name+' '+field.name;
    assert.equal(inputHeight(node,'linux'),field.rect[3],label);
    assert.equal(fieldWidth(node,'linux'),field.logicalWidth,label);
    assert.equal(inputRowHeight(node,'linux'),form.fields[1].rect[1]-form.fields[0].rect[1]-7,label+' row stride');
    if(form.independentValidation)independent++;fields++;
  }
  assert.equal(fields,136);assert.equal(independent,52);
});
