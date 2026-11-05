import assert from 'node:assert/strict';
import test from 'node:test';
import { inputControlHeight, fieldWidth } from '../webview/forms/model.mjs';

const namespace = 'http://v8.1c.ru/8.3/xcf/logform';
const property = (name, text) => ({ key: {namespace,name}, value: {kind:'text',text:String(text)} });

function input(points, rows, multiline = true) {
  return {
    presentation:{font:{points}},
    properties:[property('MultiLine',multiline),...(rows === undefined ? [] : [property('Height',rows)])],
  };
}

test('multiline controls use the measured Linux line allocation', () => {
  for (const [points,one,two] of [
    [8,20,45],[9,22,49],[10,23,51],[11,28,61],
    [12,29,64],[14,35,76],[16,38,82],[20,48,102],
  ]) {
    assert.equal(inputControlHeight(input(points,1),'linux'),one);
    assert.equal(inputControlHeight(input(points,2),'linux'),two);
  }
  for (const rows of [undefined,0]) assert.equal(inputControlHeight(input(10,rows),'linux'),51);
  assert.equal(inputControlHeight(input(10,5),'linux'),135);
  assert.equal(inputControlHeight(input(14,4),'linux'),158);
  assert.equal(inputControlHeight(input(10,5,false),'linux'),23);
});

test('a standalone multiline string uses the fixed Designer width unit', () => {
  const field = {
    kind:'InputField',
    presentation:{font:{points:10},valueType:{kind:'string'}},
    properties:[property('MultiLine',true),property('Width',12)],
  };
  assert.equal(fieldWidth(field,'linux'),131);
});
