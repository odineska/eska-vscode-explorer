import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkboxLabels, checkboxMode, checkboxTumblerLayout } from '../webview/forms/checkbox-model.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';
import { tumblerPaint } from '../webview/forms/tumbler-paint.mjs';

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

test('Linux tumbler corners, divider and fill match native blank surfaces', () => {
  const white = [255, 255, 255], border = [160, 160, 160];
  const surfaces = [
    [243, 24, 120, white, border, white,
      'c169cf96e4f28cd69a89b3027f9773cfa002767aa21cb52d73bf068547042a4d'],
    [23, 24, 10, white, border, white,
      '258506e5ea18e44cb699c273b2f02629fef4f4317f936a99d81000c4a0d88a30'],
    [243, 23, 120, white, border, white,
      'cb7190c9822a8f3baa952c022b7d0c3bbfe64f56aa84ec7e0ff76e403aa545a9'],
    [243, 46, 120, white, border, white,
      '71aeedd26653d0c54bbc86b69439d8725f6f7245944e0778c01b5e466702eb1b'],
    [243, 69, 120, white, border, white,
      'f44b24675c0414b4cff7ddfb2f44c39041273faf4ffcfe11feb3d40c4f1f561c'],
    [243, 38, 120, white, border, white,
      'fec83fe7616637c926945ab8f3ac3867b1c2ab91be57bc0c7d72fc2f5845d44b'],
    [243, 24, 120, [144, 238, 144], border, white,
      '7ec11ff9128ebe16955271288fffae93dbb2442973b0b5cae876779f1c53db30'],
    [243, 46, 120, [144, 238, 144], border, white,
      '805e7000b584fcfb1e8afc194ebccdf29eb339bd9997a409e1b6c1de526eb7a2'],
    [243, 24, 120, [34, 102, 204], [255, 0, 0], white,
      'db2714d266bf323fdb2338a815665f5905d024dddf0e301481323de7d290f52b'],
    [243, 24, 120, [0, 0, 0], border, white,
      'f61c418084cfbf78173682d5b39b7dd5b59704bcb8b9d7fefdff848fd53db1cc'],
    [243, 24, 120, white, border, [0, 0, 0],
      'a90ea9871b650848a27eee81ab65afd011ad498ec41405d0576ac7f6bd385eb1'],
    [243, 24, 120, [144, 238, 144], border, [34, 102, 204],
      '58f16c923970dc055d1f0abca1ed266c350dcfb946a797c26e80711edc9129b6'],
  ];
  for (const [width, height, first, fill, stroke, backdrop, expected] of surfaces) {
    const { rgba } = tumblerPaint({ width, height, first, fill, stroke, backdrop });
    assert.equal(createHash('sha256').update(rgba).digest('hex'), expected, `${width}×${height}, fill ${fill}`);
  }
});

test('Linux tumbler face matches the complete native gray and chromatic grids', () => {
  const white = [255, 255, 255], border = [160, 160, 160];
  const shades = [
    [24, '8130b3226998a7ffb2799d603e2ef4df673b9e5a555d4b2277bdee1576691200'],
    [38, '70dddf11ea7cd1d8f904f373fb7388f493db216ee0d7da339b7b9501967cf23b'],
  ];
  const colors = [
    [21, '2756116df472c2b580c5c4c50e5c73218a9ea9425c00f307d83e31cd124909ca'],
    [24, '691bd37b4f082d507906d6880af6207c2bfb061f1f4ace173f4e17744b2eb30c'],
    [29, '6af9dde25167b173a24eb5e9b2e412a973fd1f3538a35bb5425121c2576a22f1'],
    [38, 'eba37aa75569bd49fab7c8ff5c32ab5d317098ae9b66aa797b6ee9dcac6c7ec6'],
    [47, '26ad559ba52269d5948d5cee75492842bec088be8d174a1ac95a9bb24af08fa8'],
  ];
  const verify = (samples, count, fill) => {
    for (const [height, expected] of samples) {
      const hash = createHash('sha256');
      for (let value = 0; value < count; value++) {
        hash.update(tumblerPaint({ width: 23, height, first: 10, fill: fill(value), stroke: border, backdrop: white }).rgba);
      }
      assert.equal(hash.digest('hex'), expected, `${count} surfaces at ${height}px`);
    }
  };
  verify(shades, 256, value => [value, value, value]);
  verify(colors, 128, value => [value, (value * 73 + 33) % 256, (value * 117 + 101) % 256]);
});
