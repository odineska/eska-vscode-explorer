import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inputBorderPixels,disabledInputForeground} from '../webview/forms/input-border.mjs';
import {FORM_NS,inputChoiceButton,fieldWidth,inputHeight} from '../webview/forms/model.mjs';

const fixture=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-input-borders/metrics.json',formReferenceRoot)));
const node=field=>({kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,valueType:field.type}});

test('input palette and all 6228 corner pixels match forty-eight native forms',()=>{
  let pixels=0,fields=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const value=inputBorderPixels(field.border,field.background,field.outside,field);
    assert.deepEqual(value.border,field.actualBorder,form.name+' '+field.name+' border');
    assert.deepEqual(value.background,field.actualBackground,form.name+' '+field.name+' background');
    for(const [index,name] of ['topLeft','topRight','bottomLeft','bottomRight'].entries()){
      assert.equal(Buffer.from(value.corners[index].flat()).toString('hex'),field.cornersRgb[name],form.name+' '+field.name+' '+name);pixels+=9;
    }
    fields++;
  }
  assert.equal(fields,173);assert.equal(pixels,6228);
});

test('automatic and explicit numeric choices keep native logical sizes in each state',()=>{
  for(const form of fixture.forms)for(const field of form.fields){
    const value=node(field);
    assert.equal(inputChoiceButton(value,'linux'),field.choice,form.name+' '+field.name+' choice');
    assert.equal(fieldWidth(value,'linux'),field.logicalWidth,form.name+' '+field.name+' width');
    assert.equal(inputHeight(value,'linux'),field.rect[3],form.name+' '+field.name+' height');
  }
});

test('disabled numeric text matches nineteen measured foregrounds independently of the parent fill',()=>{
  let fields=0;
  for(const form of fixture.forms)for(const field of form.fields)if(field.actualForeground){
    assert.deepEqual(disabledInputForeground(field.background),field.actualForeground,form.name);fields++;
  }
  assert.equal(fields,19);
});
