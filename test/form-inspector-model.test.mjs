import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectorType, inspectorTypeDetails, technicalType } from '../webview/forms/inspector-type.mjs';
import { attributeFor, commandFor, dataRows, indexInspector, inspectorTerms, treeRows } from '../webview/forms/inspector-model.mjs';
import { prepare, FORM_NS } from '../webview/forms/model.mjs';

const schema = 'http://www.w3.org/2001/XMLSchema';
const config = 'http://v8.1c.ru/8.1/data/enterprise/current-config';
const core = 'http://v8.1c.ru/8.1/data/core';
const source = 'a'.repeat(64);
const strings = { form: 'Форма', 'dataType.string': 'Строка', 'dataType.number': 'Число', 'dataType.boolean': 'Булево',
  'dataType.date': 'Дата', 'dataType.time': 'Время', 'dataType.dateTime': 'Дата и время', 'dataType.composite': 'Составной',
  'dataType.CatalogRef': 'СправочникСсылка', 'dataType.DocumentObject': 'ДокументОбъект', 'dataType.EnumRef': 'ПеречислениеСсылка',
  'dataType.ValueTable': 'Таблица значений', 'dataType.unknown': 'Неизвестный тип' };
const qname = (name, namespace = schema) => ({ name, namespace });
const field = (name, value, namespace = FORM_NS, qualifiers = []) => ({
  key: { name, namespace }, qualifiers, value: typeof value === 'string' ? { kind: 'text', text: value } : { kind: 'record', fields: value },
});
const type = (name, qualifiers = []) => field('Type', [field('Type', name, core), ...qualifiers]);
const q = (name, values) => field(name, Object.entries(values).map(([key, value]) => field(key, value, core)), core);
const describe = (field, types, rest) => inspectorType(field, types && { types, ...rest }, 'ru-RU', strings);

test('compact types keep categories, precision and date parts distinct', () => {
  assert.equal(describe(type('x:string', [q('StringQualifiers', { Length: '100', AllowedLength: 'Fixed' })]), [qname('string')]).label, 'Строка (100)');
  const decimal = type('xs:decimal', [q('NumberQualifiers', { Digits: '15', FractionDigits: '0', AllowedSign: 'Nonnegative' })]);
  assert.equal(describe(decimal).label, 'Число (15, 0)');
  assert.match(technicalType(decimal), /AllowedSign = Nonnegative/u);
  assert.equal(describe(type('xs:boolean')).label, 'Булево');
  assert.equal(describe(type('xs:dateTime', [q('DateQualifiers', { DateFractions: 'Time' })])).label, 'Время');
  assert.equal(describe(type('xs:dateTime', [q('DateQualifiers', { DateFractions: 'Date' })])).label, 'Дата');
  assert.equal(describe(type('xs:dateTime')).label, 'Дата и время');
  assert.deepEqual([describe(type('local:DocumentObject.Receipt'), [qname('DocumentObject.Receipt', config)]).label,
    describe(type('local:DocumentObject.Receipt'), [qname('DocumentObject.Receipt', config)]).category], ['Receipt', 'ДокументОбъект']);
  const enumeration = describe(type('cfg:EnumRef.Kind'));
  assert.equal(enumeration.category, 'ПеречислениеСсылка');
  assert.match(enumeration.search, /ПеречислениеСсылка\.Kind/u);
  assert.equal(describe(type('v8:ValueTable')).label, 'Таблица значений');
});

test('composite and partially unknown type descriptions remain searchable and copyable', () => {
  const description = field('Type', [field('Type', 'xs:string', core), field('Type', 'cfg:CatalogRef.Partners', core),
    field('TypeSet', 'foreign:Choice', core), q('StringQualifiers', { Length: '25', AllowedLength: 'Variable' })]);
  const summary = describe(description, [qname('string'), qname('CatalogRef.Partners', config)]);
  assert.equal(summary.label, 'Составной');
  assert.equal(summary.count, 3);
  assert.match(summary.search, /Строка \(25\).*Partners.*СправочникСсылка.*foreign:Choice/u);
  assert.match(technicalType(description), /TypeSet = foreign:Choice[\s\S]*AllowedLength = Variable/u);
  assert.equal(describe(type('ext:string'), [qname('string', 'urn:vendor')]).label, 'ext:string');
  assert.equal(describe(type('x:Future'), [qname('Future', 'urn:future')]).label, 'x:Future');
});

test('full type details attach the qualified facts only to the matching composite members', () => {
  const qualifiers = {
    'typeQualifier.Length': 'Длина', 'typeQualifier.Length.0': 'Без ограничения',
    'typeQualifier.AllowedLength.Variable': 'Переменная',
    'typeQualifier.AllowedSign.Nonnegative': 'Неотрицательный',
    'typeQualifier.DateFractions.Time': 'Время',
  };
  const declaration = field('Type', [
    field('Type', 'x:string', core), field('Type', 'xs:decimal', core), field('Type', 'xs:dateTime', core),
    field('Type', 'cfg:CatalogRef.Partners', core), field('TypeSet', 'ext:Opaque', core),
    q('StringQualifiers', { Length: '0', AllowedLength: 'Variable' }),
    q('NumberQualifiers', { Digits: '15', FractionDigits: '0', AllowedSign: 'Nonnegative' }),
    q('DateQualifiers', { DateFractions: 'Time' }),
    q('FutureQualifiers', { Extra: 'kept' }),
  ]);
  const normalized = { types: [qname('string'), qname('decimal'), qname('dateTime'), qname('CatalogRef.Partners', config)] };
  assert.deepEqual(inspectorTypeDetails(declaration, normalized, 'ru-RU', {...strings, ...qualifiers}), [
    { label: 'Строка', facts: [{ label: 'Длина', value: 'Без ограничения' }, { label: 'AllowedLength', value: 'Переменная' }] },
    { label: 'Число', facts: [
      { label: 'Digits', value: '15' }, { label: 'FractionDigits', value: '0' }, { label: 'AllowedSign', value: 'Неотрицательный' },
    ] },
    { label: 'Дата', facts: [{ label: 'DateFractions', value: 'Время' }] },
    { label: 'Partners', category: 'СправочникСсылка', facts: [] },
    { label: 'ext:Opaque', facts: [] },
  ]);
  assert.match(technicalType(declaration), /FutureQualifiers[\s\S]+Extra = kept/u);
  assert.deepEqual(inspectorTypeDetails(undefined, { kind: 'number', digits: 11, fraction: 0 }, 'ru-RU', strings), [
    { label: 'Число', facts: [{ label: 'Digits', value: '11' }, { label: 'FractionDigits', value: '0' }] },
  ]);
});

function node(id, kind, name, properties = [], children = [], caption = name) {
  return { identity: { source, part: 'current', key: id === 'root' ? { kind: 'root' } : { kind: 'xml', value: id } },
    kind, name, properties, children, auxiliary: [], presentation: { caption: { kind: 'name', text: caption }, displayed: true, valueType: { kind: 'unknown', types: [] } } };
}
function fixture() {
  return prepare({
    root: node('root', 'Form', '', [], [
      node('1', 'UsualGroup', 'Header', [], [
        node('2', 'InputField', 'Left', [field('DataPath', 'Object.Amount')], [], 'Номер договора'),
        node('3', 'InputField', 'Right', [field('DataPath', 'Object.Amount')]),
        node('4', 'InputField', 'Independent', [field('DataPath', 'Amount')]),
        node('5', 'Button', 'Save', [field('CommandName', 'Form.Command.Save')]),
      ]),
    ]),
    attributes: [
      { name: 'Object', xmlName: qname('Attribute', FORM_NS), properties: [field('MainAttribute', 'true'), type('cfg:DocumentObject.Receipt')] },
      { name: 'Amount', xmlName: qname('Attribute', FORM_NS), properties: [type('xs:string')] },
      { name: 'Table', xmlName: qname('Attribute', FORM_NS), properties: [
        field('Columns', [field('Column', [type('xs:boolean')], FORM_NS, [{key:qname('name',null), value:'Flag'}])]),
      ] },
    ],
    commands: [{ name: 'Save', xmlName: qname('Command', FORM_NS), properties: [field('Action', 'SaveAction')] }],
    parameters: [],
    dataFields: [
      { path: ['Object', 'Amount'], valueType: { kind: 'number', digits: 15, fraction: 2, types: [qname('decimal')] } },
      { path: ['Object', 'Lines'], valueType: { kind: 'table', types: [] } },
      { path: ['Object', 'Lines', 'Quantity'], valueType: { kind: 'number', types: [qname('decimal')] } },
    ],
  });
}

test('form paths and command uses index every reference with the original hierarchy', () => {
  const index = indexInspector(fixture(), 'ru-RU', strings);
  assert.notEqual(attributeFor(index, 'Object.Amount'), attributeFor(index, 'Amount'));
  assert.equal(attributeFor(index, 'Object.Amount').type.label, 'Число (15, 2)');
  assert.equal(attributeFor(index, 'Object.Lines.Quantity').depth, 2);
  assert.equal(attributeFor(index, 'Table.Flag').type.label, 'Булево');
  assert.deepEqual(index.usages.get('Object.Amount').map(row => row.label), ['Left', 'Right']);
  assert.deepEqual(index.usages.get('Amount').map(row => row.label), ['Independent']);
  assert.equal(commandFor(index, 'Save').action, 'SaveAction');
  assert.equal(index.commandUses.get('Save')[0].label, 'Save');
  const folded = { [`${source}:current:1`]: true };
  const visible = query => treeRows(index, folded, inspectorTerms(query, 'ru-RU')).map(row => row.label);
  assert.deepEqual(visible(''), ['Форма', 'Header']);
  assert.deepEqual(visible('номер договора'), ['Форма', 'Header', 'Left']);
  assert.deepEqual(visible('object.amount'), ['Форма', 'Header', 'Left', 'Right']);
  assert.deepEqual(visible('missing'), []);
  assert.deepEqual(dataRows(index, 'attributes', { 'attributes:Object': true }, ['quantity'])
    .filter(row => !row.heading).map(row => row.path), ['Object', 'Object.Lines', 'Object.Lines.Quantity']);
});
