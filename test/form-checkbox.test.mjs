import assert from 'node:assert/strict';
import test from 'node:test';
import { checkboxLabels, checkboxMode, checkboxTumblerLayout } from '../webview/forms/checkbox-model.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';

function field(properties, kind = 'boolean') {
  return {
    properties: Object.entries(properties).map(([name, value]) => ({
      key: { namespace: FORM_NS, name },
      value: typeof value === 'string' ? { kind: 'text', text: value } : value,
    })),
    presentation: { valueType: { kind }, font: { points: 10, weight: 400 } },
  };
}

test('only a Boolean field uses the two alternate checkbox modes', () => {
  assert.equal(checkboxMode(field({})), 'CheckBox');
  assert.equal(checkboxMode(field({ CheckBoxType: 'Tumbler' })), 'Tumbler');
  assert.equal(checkboxMode(field({ CheckBoxType: 'Switcher' })), 'Switcher');
  assert.equal(checkboxMode(field({ CheckBoxType: 'Switcher' }, 'composite')), 'CheckBox');
});

test('checkbox captions use regional defaults and the chosen localization of EditFormat', () => {
  assert.deepEqual(checkboxLabels(field({}), 'en-US', 'ru-RU'), ['Истина', 'Ложь']);
  assert.deepEqual(checkboxLabels(field({}), 'ru-RU', 'en-US'), ['True', 'False']);
  assert.deepEqual(checkboxLabels(field({}), 'en-US', 'en-US', 'russian'), ['Истина', 'Ложь']);
  assert.deepEqual(checkboxLabels(field({}), 'ru-RU', 'ru-RU', 'english'), ['True', 'False']);
  assert.deepEqual(checkboxLabels(field({ EditFormat: 'Л=ru_RU' }), 'en-US', 'en-US'), ['Да', 'Нет']);
  assert.deepEqual(checkboxLabels(field({ EditFormat: 'L=en_US' }), 'ru-RU', 'ru-RU', 'russian'), ['Yes', 'No']);
  assert.deepEqual(checkboxLabels(field({ EditFormat: 'BT=; BF=' }), 'en-US', 'en-US'), ['', '']);
  const EditFormat = { kind: 'localized', items: [
    { language: 'ru', content: 'БИ="Да; дальше"; БЛ=Нет' },
    { language: 'en', content: 'BT="On; now"; BF=\'Off\'\'line\'' },
  ] };
  assert.deepEqual(checkboxLabels(field({ EditFormat }), 'en-US', 'ru-RU'), ['On; now', "Off'line"]);
  assert.deepEqual(checkboxLabels(field({ EditFormat }), 'ru-RU', 'en-US'), ['Да; дальше', 'Нет']);
  const localizedField = (name, value) => ({key: {namespace: 'http://v8.1c.ru/8.1/data/core', name}, qualifiers: [], value});
  const rawFormat = {kind: 'record', fields: [localizedField('item', {kind: 'record', fields: [
    localizedField('lang', {kind: 'text', text: 'ru'}),
    localizedField('content', {kind: 'text', text: 'БИ=Вкл; БЛ=Выкл'}),
  ]})]};
  assert.deepEqual(checkboxLabels(field({ EditFormat: rawFormat }), 'en-US', 'en-US'), ['Вкл', 'Выкл']);
});

test('native tumbler width follows equal or independent labels and the manual height unit', () => {
  const labels = ['Вкл', 'Выключено'];
  const unequal = field({ EqualItemsWidth: 'false', ItemWidth: '12' });
  assert.deepEqual(checkboxTumblerLayout(unequal, labels, 'linux'),
    { height: 24, equal: false, side: 9, first: 41, width: 131 });
  const manual = field({ ItemWidth: '12', ItemHeight: '2' });
  assert.deepEqual(checkboxTumblerLayout(manual, labels, 'linux'),
    { height: 46, equal: true, side: 9, first: 120, width: 243 });
  const automatic = field({ ItemWidth: '-2' });
  assert.equal(checkboxTumblerLayout(automatic, labels, 'win32').width, undefined);
});
