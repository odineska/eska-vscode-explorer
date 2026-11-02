import test from 'node:test';
import assert from 'node:assert/strict';
import { tableLayout } from '../webview/forms/table-model.mjs';

const ns = 'http://v8.1c.ru/8.3/xcf/logform';
const prop = (name, text) => ({ key: { namespace: ns, name }, value: { kind: 'text', text: String(text) } });
const field = (name, kind, type) => ({ key: name, kind, children: [], properties: [], presentation: { displayed: true, caption: { kind: 'name', text: name }, valueType: { kind: type, length: type === 'string' ? 20 : null } } });
function fixture() {
  const nodes = [field('Text', 'InputField', 'string'), field('Amount', 'InputField', 'number'), field('Active', 'CheckBoxField', 'boolean')];
  return { key: 'table', kind: 'Table', children: nodes, properties: [], auxiliary: [], presentation: { autoCommandItems: ['Add', 'MoveUp', 'MoveDown'].map(key => ({ key })) } };
}

test('table headers follow native Horizontal, Vertical, InCell and ShowInHeader geometry', () => {
  const root = fixture(), [text, amount, active] = root.children;
  const group = { ...field('Group', 'ColumnGroup', 'unknown'), children: [text, amount], properties: [prop('Group', 'Horizontal')] };
  root.children = [group, active];
  assert.equal(tableLayout(root).depth, 1); assert.equal(tableLayout(root).columns.length, 3);
  group.properties.push(prop('ShowInHeader', true));
  assert.equal(tableLayout(root).depth, 2);
  group.properties[0] = prop('Group', 'Vertical');
  assert.equal(tableLayout(root).depth, 3); assert.equal(tableLayout(root).columns.length, 2);
  group.properties[0] = prop('Group', 'InCell');
  const layout = tableLayout(root);
  assert.equal(layout.depth, 2); assert.deepEqual(layout.columns[0].fields.map(field => field.key), ['Text', 'Amount']);
});

test('native table metrics preserve row units, footer and readonly edit affordance', () => {
  const root = fixture(); let layout = tableLayout(root);
  assert.equal(layout.height, 227); assert.equal(layout.columns[1].width, 129); assert.equal(layout.columns[2].width, 54);
  root.properties.push(prop('ReadOnly', true));
  assert.equal(tableLayout(root).columns[1].width, 108);
  root.properties.push(prop('HeightInTableRows', 3), prop('Footer', true));
  layout = tableLayout(root); assert.equal(layout.height, 145); assert.equal(layout.footer, 30);
  root.children[0].properties.push(prop('Visible', false));
  assert.equal(tableLayout(root).columns.length, 2);
});
