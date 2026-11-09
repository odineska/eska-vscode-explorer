import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS, fieldWidth, fieldStyle, inputHeight, inputChoiceButton, inputPaintedOutset, textInputWidthBounds } from '../webview/forms/model.mjs';
import { stretches, horizontalInputMaximum } from '../webview/forms/layout-model.mjs';

const root = new URL('tests/fixtures/forms/native-text-inputs/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
const nodeFor = field => ({ kind: 'InputField', properties: Object.entries(field.properties).map(([name, text]) => ({
  key: { namespace: FORM_NS, name }, value: { kind: 'text', text },
})), presentation: { valueType: field.type, font: field.font } });

test('text geometry corpus binds 78 canonical forms and 286 controls to 156 native captures', async () => {
  assert.equal(metrics.rows.length, 78);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 78);
  let controls = 0;
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: ru, ...geometry } = row.locales.ru;
    const { screenshotSha256: en, ...english } = row.locales.en;
    assert.match(ru, /^[a-f0-9]{64}$/u);
    assert.match(en, /^[a-f0-9]{64}$/u);
    assert.deepEqual(english, geometry, row.name);
    controls += Object.keys(row.controls).length;
  }
  assert.equal(controls, 286);
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(manifest.stands.reduce((sum, stand) => sum + stand.captures.length, 0), 156);
  assert.ok(manifest.stands.every(stand => stand.sourcesUnchanged));
  for (const row of metrics.rows) for (const locale of ['ru', 'en']) {
    const captures = manifest.stands.flatMap(stand => stand.captures).filter(capture => capture.name === row.name && capture.locale === locale);
    assert.equal(captures.length, 1, row.name + '/' + locale);
    assert.equal(captures[0].screenshotSha256, row.locales[locale].screenshotSha256);
  }
});

test('text preferences, growth caps, choice visibility and fonts match 286 native controls', () => {
  for (const row of metrics.rows) for (const [name, field] of Object.entries(row.controls)) {
    const node = nodeFor(field), label = row.name + '/' + name;
    const bounds = textInputWidthBounds(node, 'linux');
    assert.equal(inputChoiceButton(node, 'linux'), field.choice, label + '/choice');
    assert.equal(inputPaintedOutset(node, 'linux'), row.locales.ru.fields[name][2] - field.logicalWidth, label + '/paint outset');
    assert.equal(inputHeight(node, 'linux'), field.height, label + '/height');
    assert.equal(stretches(node, 'x'), !field.intrinsic, label + '/stretch');
    assert.equal(bounds.stretch, !field.intrinsic, label + '/profile stretch');
    const measured = field.intrinsic ? fieldWidth(node, 'linux') : horizontalInputMaximum(node, 'linux');
    assert.equal(measured, field.logicalWidth, label + '/width');
    assert.equal(fieldStyle(node, 'linux').width, bounds.preferred + 'px', label + '/preferred style');
    if (!field.intrinsic) assert.equal(bounds.maximumPaint, row.locales.ru.fields[name][2], label + '/painted maximum');
  }
});

test('authored maximum is ignored in automatic mode and does not mutate the source properties', () => {
  const field = metrics.rows.find(row => row.name === 'StringMax12Automatic').controls.Value;
  const node = nodeFor(field), properties = JSON.stringify(node.properties);
  assert.equal(textInputWidthBounds(node, 'linux').maximum, 411);
  assert.equal(JSON.stringify(node.properties), properties);
  assert.equal(textInputWidthBounds(node, 'win32'), undefined);
});

test('automatic maximum is independent of the string length once the input stretches', () => {
  for (const [length, properties, preferred, maximum] of [
    [36, {}, 371, 410],
    [100, { MaxWidth: '4' }, 411, 411],
    [10, { HorizontalStretch: 'true' }, 111, 410],
    [10, { HorizontalStretch: 'true', ChoiceButton: 'true' }, 132, 410],
    [10, { HorizontalStretch: 'true', AutoMaxWidth: 'false', MaxWidth: '19' }, 111, 200],
    [10, {}, 111, undefined],
  ]) {
    const field = nodeFor({ properties, type: { kind: 'string', length }, font: { points: 10 } });
    const bounds = textInputWidthBounds(field, 'linux');
    assert.equal(bounds.preferredPaint, preferred);
    assert.equal(bounds.maximumPaint, maximum);
    assert.equal(horizontalInputMaximum(field, 'linux'),
      maximum === undefined ? undefined : maximum - bounds.outset);
  }
});

test('single-line threshold preserves multiline stretch and actual choice outset follows allocation', () => {
  const field = metrics.rows.find(row => row.name === 'ChoiceMax1').controls.Value;
  const node = nodeFor(field), before = JSON.stringify(node);
  assert.equal(inputChoiceButton(node, 'linux'), false);
  assert.equal(textInputWidthBounds(node, 'linux', true).outset, 1);
  assert.equal(textInputWidthBounds(node, 'linux', false).outset, 0);
  assert.equal(JSON.stringify(node), before);
  node.properties.push({key:{namespace:FORM_NS,name:'MultiLine'},value:{kind:'text',text:'true'}});
  node.presentation.valueType.length = 8;
  assert.equal(stretches(node, 'x'), true);
  assert.equal(textInputWidthBounds(node, 'linux'), undefined);
});
