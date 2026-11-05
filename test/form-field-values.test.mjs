import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldValue, fieldWidth, inputHeight } from '../webview/forms/model.mjs';

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

test('native input metrics follow the effective font height while bold keeps the same allocation', () => {
  for (const [points,width,height] of [[10,161,23],[12,199,29],[14,236,35],[16,261,38]]) {
    const node=field('string',{length:0});node.presentation.font={points,weight:400};
    assert.equal(fieldWidth(node),width);assert.equal(inputHeight(node),height);
    node.presentation.font.weight=700;assert.equal(fieldWidth(node),width);
  }
  const numeric=field('number',{digits:9,fraction:2});numeric.presentation.font={points:14};
  assert.equal(fieldWidth(numeric),166);
});
