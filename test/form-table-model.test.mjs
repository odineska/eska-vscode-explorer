import test from 'node:test';
import assert from 'node:assert/strict';
import { tableLayout, tableTracks } from '../webview/forms/table-model.mjs';
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

test('Linux table Height counts whole table units and yields to HeightInTableRows', () => {
  const linux = { os: 'linux' }, table = fixture();
  const height = (units, ...properties) => {
    table.properties = [prop('Height', units), ...properties];
    return tableLayout(table, linux).height;
  };
  assert.equal(height(1), 36);
  assert.equal(height(2), 59);
  assert.equal(height(4), 115);
  assert.equal(height(12), 339);
  assert.equal(height(20), 563);
  assert.equal(height(4, prop('Header', false)), 113);
  assert.equal(height(4, prop('Footer', true)), 117);
  assert.equal(height(2, prop('Footer', true)), 60);
  assert.deepEqual([tableLayout(table, linux).header, tableLayout(table, linux).footer], [29, 29]);
  assert.equal(height(12, prop('HeightInTableRows', 2)), 87);
});

test('Linux constrained groups preserve the measured grid floor', () => {
  const table = fixture(), linux = { os: 'linux' };
  const height = (...properties) => {
    table.properties = properties;
    return tableLayout(table, linux).groupMinimumHeight;
  };
  assert.equal(height(), 117);
  assert.equal(height(prop('Header', false)), 87);
  assert.equal(height(prop('Header', false), prop('Footer', true)), 116);
  assert.equal(height(prop('Footer', true)), 146);
  assert.equal(height(prop('HeightInTableRows', 1)), 30);
  assert.equal(height(prop('HeightInTableRows', 2)), 59);
  assert.equal(height(prop('HeightInTableRows', 4)), 117);
  assert.equal(height(prop('Height', 4)), 88);
  table.children[0].presentation.titleFont = { points: 14 };
  assert.equal(height(), 130);
  delete table.children[0].presentation.titleFont;
  const group = { ...field('Group', 'ColumnGroup', 'unknown'), children: table.children.slice(0, 2),
    properties: [prop('Group', 'Horizontal'), prop('ShowInHeader', true)] };
  table.children = [group, table.children[2]];
  assert.equal(height(), 117);
  group.properties[0] = prop('Group', 'Vertical');
  assert.equal(height(), 146);
});

test('Linux dynamic lists use native width units and reserve the pagination edge in explicit heights', () => {
  const table = fixture(), linux = { os: 'linux' };
  table.presentation.valueType = { types: [{ namespace: 'http://v8.1c.ru/8.1/data/enterprise/current-config', name: 'DynamicList' }] };
  const measure = (...properties) => {
    table.properties = properties;
    const { preferredWidth, height, groupMinimumHeight } = tableLayout(table, linux);
    return [preferredWidth, height, groupMinimumHeight];
  };
  assert.deepEqual(measure(prop('Width', 24)), [240, 452, 118]);
  assert.deepEqual(measure(prop('Width', 43), prop('Height', 1)), [430, 37, 31]);
  assert.deepEqual(measure(prop('Width', 43), prop('Height', 4)), [430, 116, 89]);
  assert.deepEqual(measure(prop('Width', 60), prop('Height', 8), prop('HeightInTableRows', 2)), [600, 88, 60]);
  assert.deepEqual(measure(prop('Width', 43), prop('Header', false)), [430, 452, 88]);
  assert.deepEqual(measure(prop('Width', 43), prop('Footer', true)), [430, 452, 147]);
});

test('an automatic dynamic toolbar can be wider than its fixed grid', () => {
  const table = fixture(), state = { os: 'linux', locale: 'ru' };
  table.presentation.valueType = { types: [{ namespace: 'http://v8.1c.ru/8.1/data/enterprise/current-config', name: 'DynamicList' }] };
  table.properties = [prop('Width', 24), prop('HorizontalStretch', false)];
  table.auxiliary.push(field('Search', 'SearchStringAddition', 'unknown'), field('Status', 'ViewStatusAddition', 'unknown'));
  const dimensions = () => {
    const { preferredWidth, fixedGridWidth, adaptiveToolbar } = tableLayout(table, state);
    return [preferredWidth, fixedGridWidth, adaptiveToolbar];
  };
  assert.deepEqual(dimensions(), [300, 240, true]);
  table.properties.push(prop('ViewStatusLocation', 'None'));
  assert.deepEqual(dimensions(), [240, 240, true]);
  table.properties.push(prop('CommandBarLocation', 'None'));
  assert.deepEqual(dimensions(), [240, 240, false]);
});

test('a static table uses independent Linux sizes for the grid and the command and filter bands', () => {
  const table = fixture();
  table.properties = [prop('HorizontalStretch', false)];
  table.auxiliary.push(field('Search', 'SearchStringAddition', 'unknown'), field('Status', 'ViewStatusAddition', 'unknown'));
  const dimensions = (locale = 'ru') => {
    const { preferredWidth, fixedGridWidth } = tableLayout(table, { os: 'linux', locale });
    return [preferredWidth, fixedGridWidth];
  };
  assert.deepEqual(dimensions(), [415, 400]);
  assert.deepEqual(dimensions('en'), [429, 400]);
  table.children.push(field('Extra', 'InputField', 'string'));
  assert.deepEqual(dimensions(), [520, 520]);
  table.properties.push(prop('Width', 4));
  assert.deepEqual(dimensions(), [300, 40]);
  table.properties.push(prop('CommandBarLocation', 'None'));
  assert.deepEqual(dimensions(), [300, 40]);
  table.properties.push(prop('ViewStatusLocation', 'None'));
  assert.deepEqual(dimensions(), [40, 40]);
  table.properties[0] = prop('HorizontalStretch', true);
  assert.deepEqual(dimensions(), [40, undefined]);
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
  assert.equal(layout.preferredWidth, 400);
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
  assert.equal(tableLayout(root).preferredWidth, 520);
  root.presentation.valueType = {types:[{namespace:'http://v8.1c.ru/8.1/data/enterprise/current-config',name:'DynamicList'}]};
  const code = field('Code', 'InputField', 'string');code.presentation.caption = {kind:'standard',key:'attribute.Code'};code.presentation.valueType.length=9;
  const description = field('Description', 'InputField', 'string');description.presentation.valueType.length=25;
  root.children = [code, description];
  root.auxiliary.push({...field('Search', 'SearchStringAddition', 'unknown'),auxiliary:[]});
  assert.equal(tableLayout(root).height, 452);assert.equal(tableLayout(root).preferredWidth, 418);
  assert.equal(tableLayout(root, { locale: 'en' }).preferredWidth,454);
  assert.equal(tableLayout(root).columns[0].growthWeight, 0);
  const status = field('Status', 'ViewStatusAddition', 'unknown');root.auxiliary.push(status);
  assert.equal(viewStatusAddition(root), status);
  root.properties.push(prop('ViewStatusLocation', 'None'));
  assert.equal(viewStatusAddition(root), undefined);
});

const linux = { os: 'linux', locale: 'ru' };
function typedField(name, type, kind = 'InputField') {
  const result = field(name, kind, type.kind);
  result.presentation.valueType = type;
  return result;
}

test('Linux tabular sections keep column widths separate from their scrolling viewport', () => {
  const root = fixture();
  const line = typedField('Line', { kind: 'number', digits: 5 }, 'LabelField');
  line.presentation.caption = { kind: 'standard', key: 'table.LineNumber' };
  const reference = (name, type) => typedField(name, { kind: 'reference', types: [{ name: type }] });
  root.children = [
    line,
    typedField('Order', { kind: 'string', length: 50 }),
    reference('Supplier', 'CatalogRef.Partners'),
    reference('Account', 'EnumRef.Accounts'),
    reference('Charge', 'CatalogRef.Charges'),
    typedField('Amount', { kind: 'number', digits: 15, fraction: 2 }),
    typedField('Payment', { kind: 'date', dateParts: 'DateTime' }),
    reference('Transaction', 'CatalogRef.Transactions'),
    reference('Incoming', 'DocumentRef.Settlement'),
    reference('Outgoing', 'DocumentRef.Settlement'),
  ];
  const layout = tableLayout(root, linux);
  assert.deepEqual(layout.columns.map(item => item.width), [87, 314, 158, 142, 158, 189, 189, 158, 158, 158]);
  assert.equal(layout.preferredWidth, 880);
  assert.equal(layout.controlMinWidth, 400);
  assert.equal(tableTracks(layout, 1107), layout.tracks);
  root.properties.push(prop('Width', 60));
  assert.equal(tableLayout(root, linux).preferredWidth, 600);
  root.properties[0] = prop('Width', 18);
  assert.equal(tableLayout(root, linux).preferredWidth, 180);
  assert.equal(tableLayout(root, linux).controlMinWidth, 180);
});

test('Linux sizing accounts for native width units and numeric, date and reference edit affordances', () => {
  const root = fixture();
  const string = (name, length) => typedField(name, { kind: 'string', length });
  const number = (name, digits, fraction) => typedField(name, { kind: 'number', digits, fraction });
  const widths = () => tableLayout(root, linux).columns.map(item => item.width);
  const explicit = string('W8', 50);
  explicit.properties.push(prop('Width', 8));
  root.children = [
    string('S1', 1), string('S10', 10), string('S11', 11), string('S25', 25), string('S80', 80), explicit,
    number('N1', 1, 0), number('N4', 4, 0), number('N12', 12, 0), number('N15', 15, 2),
    typedField('Cat', { kind: 'reference', types: [{ name: 'CatalogRef.Products' }] }),
    typedField('Enum', { kind: 'reference', types: [{ name: 'EnumRef.Levels' }] }),
    ...['Date', 'Time', 'DateTime'].map(dateParts => typedField(dateParts, { kind: 'date', dateParts })),
  ];
  assert.deepEqual(widths(), [33, 118, 96, 201, 314, 73, 38, 68, 128, 189, 158, 142, 129, 98, 189]);
  root.children[9].properties.push(prop('SpinButton', true));
  root.children[12].properties.push(prop('ChoiceButton', false));
  assert.deepEqual(widths().slice(9), [210, 158, 142, 108, 98, 189]);
  root.properties.push(prop('ReadOnly', true));
  assert.deepEqual(widths().slice(9), [168, 142, 126, 108, 98, 168]);
});

test('Linux grids distribute surplus without shrinking columns or stretching fixed controls', () => {
  const root = fixture();
  root.children = [
    typedField('SA', { kind: 'string', length: 20 }),
    typedField('SB', { kind: 'string', length: 40 }),
    typedField('On', { kind: 'boolean' }, 'CheckBoxField'),
  ];
  let layout = tableLayout(root, linux);
  assert.equal(tableTracks(layout, 804), '264px 506px 34px');
  assert.equal(tableTracks(layout, 384), '164px 314px 34px');
  root.children[0].properties.push(prop('Width', 12));
  root.children[1].presentation.valueType.length = 20;
  layout = tableLayout(root, linux);
  assert.equal(tableTracks(layout, 604), '220px 350px 34px');
  root.children[0].properties = [];
  root.children[0].presentation.valueType.length = 0;
  root.children[1].presentation.valueType = { kind: 'number', digits: 0 };
  layout = tableLayout(root, linux);
  assert.equal(tableTracks(layout, 387), '177px 176px 34px');
});

test('Linux columns use the authored stretch mode for base widths and surplus', () => {
  const root = fixture(), [text, amount, check] = root.children;
  amount.presentation.valueType = { kind: 'number', digits: 9, fraction: 2 };
  check.presentation.caption = { kind: 'name', text: 'On' };
  const second = typedField('SB', { kind: 'string', length: 20 });
  root.children = [text, second, check];
  text.properties = [prop('HorizontalStretch', false)];
  assert.equal(tableTracks(tableLayout(root, linux), 604), '218px 352px 34px');
  text.properties.push(prop('Width', 16));
  assert.equal(tableTracks(tableLayout(root, linux), 604), '177px 393px 34px');
  text.properties = [prop('HorizontalStretch', true)];
  text.presentation.valueType.length = 5;
  assert.equal(tableTracks(tableLayout(root, linux), 604), '136px 434px 34px');
  amount.properties = [prop('HorizontalStretch', true)];
  check.properties = [prop('HorizontalStretch', true)];
  root.children[0] = amount;
  assert.equal(tableTracks(tableLayout(root, linux), 604), '212px 358px 34px');
});

test('a dynamic list retains More when all inline actions are excluded', () => {
  const table=fixture();
  table.presentation.autoCommandItems=[];
  table.presentation.tableCommandMenu=[[{key:'Table.StandardCommand.ListSettings'}]];
  assert.equal(tableLayout(table,{os:'linux'}).toolbar,true);
  assert.equal(tableLayout(table,{os:'linux'}).more,true);
  table.properties.push(prop('CommandBarLocation','None'));
  assert.equal(tableLayout(table,{os:'linux'}).toolbar,false);
});
