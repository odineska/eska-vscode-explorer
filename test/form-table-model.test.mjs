import test from 'node:test';
import assert from 'node:assert/strict';
import { tableLayout } from '../webview/forms/table-model.mjs';
import { viewStatusAddition } from '../webview/forms/model.mjs';

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

test('table bands size captions independently of the empty rows', () => {
  const table = fixture();
  table.properties.push(prop('HeightInTableRows', 2), prop('Footer', true));
  const bands = () => {
    const {header, footer, height} = tableLayout(table);
    return [header, footer, height];
  };
  table.children[0].presentation.titleFont = {points: 14};
  assert.deepEqual(bands(), [38, 30, 130]);
  table.children[1].presentation.tableColumnAppearance = {footerFont: {points: 14}};
  assert.deepEqual(bands(), [38, 38, 143]);
  for (const child of table.children) {
    child.presentation.titleFont = {points: 8};
    child.presentation.tableColumnAppearance = {footerFont: {points: 8}};
  }
  assert.deepEqual(bands(), [28, 28, 117]);
});

test('an explicit table toolbar preserves its groups without adding the automatic menu', () => {
  const root = fixture(); root.presentation.autoCommandItems = [];
  const popup = field('Actions', 'Popup', 'unknown');
  const bar = { ...field('RowsBar', 'AutoCommandBar', 'unknown'), properties: [prop('Autofill', false)], children: [popup] };
  root.auxiliary.push(bar, field('Search', 'SearchStringAddition', 'unknown'));
  root.properties.push(prop('SearchStringLocation', 'None'));
  const layout = tableLayout(root);
  assert.equal(layout.toolbar, true);
  assert.equal(layout.bar.children[0], popup);
  assert.equal(layout.more, false);
  assert.equal(layout.search, undefined);
  assert.equal(layout.minWidth, 400);
  bar.properties = [];
  assert.equal(tableLayout(root).more, true);
  popup.presentation.displayed = false;
  assert.equal(tableLayout(root).toolbar, false);
});

test('native metadata and dynamic list columns retain their distinct size and addition defaults', () => {
  const root = fixture();
  root.children[0].presentation.valueType.length = 0;
  root.children[1].presentation.valueType.digits = 0;
  const line = field('Line', 'LabelField', 'number');line.presentation.caption = {kind:'standard',key:'table.LineNumber'};line.presentation.valueType.digits = 9;
  root.children.unshift(line);
  assert.deepEqual(tableLayout(root).columns.map(column => column.width), [97, 177, 176, 54]);
  assert.equal(tableLayout(root).minWidth, 520);
  root.presentation.valueType = {types:[{namespace:'http://v8.1c.ru/8.1/data/enterprise/current-config',name:'DynamicList'}]};
  const code = field('Code', 'InputField', 'string');code.presentation.caption = {kind:'standard',key:'attribute.Code'};code.presentation.valueType.length=9;
  const description = field('Description', 'InputField', 'string');description.presentation.valueType.length=25;
  root.children = [code, description];
  root.auxiliary.push({...field('Search', 'SearchStringAddition', 'unknown'),auxiliary:[]});
  assert.equal(tableLayout(root).height, 452);assert.equal(tableLayout(root).minWidth, 418);
  assert.equal(tableLayout(root,'en').minWidth,454);
  assert.equal(tableLayout(root).columns[0].flexible, false);
  const status = field('Status', 'ViewStatusAddition', 'unknown');root.auxiliary.push(status);
  assert.equal(viewStatusAddition(root), status);
  root.properties.push(prop('ViewStatusLocation', 'None'));
  assert.equal(viewStatusAddition(root), undefined);
});
