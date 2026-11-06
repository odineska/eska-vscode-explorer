import test from 'node:test';
import assert from 'node:assert/strict';
import { FORM_NS, fieldValue, fieldWidth, inputChoiceButton, inputHeight } from '../webview/forms/model.mjs';

const field = (kind, extra = {}) => ({kind:'InputField',properties:[],presentation:{valueType:{kind,...extra}}});

test('native empty numeric and date inputs use a zero and the regional input mask', () => {
  assert.equal(fieldValue(field('number',{digits:9,fraction:2}),'en-US'),'0');
  assert.equal(fieldValue(field('date',{dateParts:'Date'}),'en-US'),'  /  /    ');
  assert.equal(fieldValue(field('date',{dateParts:'Date'}),'ru-RU'),'  .  .    ');
  assert.equal(fieldValue(field('date',{dateParts:'DateTime'}),'en-US'),'  /  /       :  :   AM');
  assert.equal(fieldValue(field('date',{dateParts:'DateTime'}),'ru-RU'),'  .  .       :  :  ');
});

test('native numeric and date widths include their automatic choice button', () => {
  assert.equal(fieldWidth(field('number',{digits:9,fraction:2})),121);
  assert.equal(fieldWidth(field('date',{dateParts:'Date'})),121);
  assert.equal(fieldWidth(field('date',{dateParts:'DateTime'})),181);
  assert.equal(fieldWidth(field('date',{dateParts:'Time'})),91);
});

test('Linux read-only fields omit the automatic picker and its date width', () => {
  const readOnly = {key:{namespace:FORM_NS,name:'ReadOnly'},value:{kind:'text',text:'true'}};
  const date = field('date', {dateParts:'Date'});
  const reference = field('reference');
  date.properties.push(readOnly);
  reference.properties.push(readOnly);
  assert.equal(fieldWidth(date, 'linux'), 101);
  assert.equal(inputChoiceButton(reference, 'linux'), false);
  assert.equal(inputChoiceButton(reference, 'win32'), true);
  reference.properties.push({key:{namespace:FORM_NS,name:'Width'},value:{kind:'text',text:'8'}});
  assert.equal(fieldWidth(reference, 'linux'), 113);
  date.properties.push({key:{namespace:FORM_NS,name:'ChoiceButton'},value:{kind:'text',text:'true'}});
  assert.equal(fieldWidth(date, 'linux'), 121);
});

test('native input metrics follow the effective font height while bold keeps the same allocation', () => {
  for (const [points,width,height] of [[10,161,23],[12,199,29],[14,236,35],[16,261,38]]) {
    const node=field('string',{length:0});node.presentation.font={points,weight:400};
    assert.equal(fieldWidth(node),width);assert.equal(inputHeight(node),height);
    node.presentation.font.weight=700;assert.equal(fieldWidth(node),width);
  }
  const numeric=field('number',{digits:9,fraction:2});numeric.presentation.font={points:14};
  assert.equal(fieldWidth(numeric),166);
});
