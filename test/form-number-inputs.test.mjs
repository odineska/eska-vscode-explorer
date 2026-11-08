import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS, fieldWidth, inputHeight, inputChoiceButton } from '../webview/forms/model.mjs';

const root = new URL('tests/fixtures/forms/native-number-inputs/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));

test('numeric geometry corpus binds fifty-three forms to both native locales and a repeated capture', async () => {
  assert.equal(metrics.rows.length, 53);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 53);
  let controls = 0;
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: ru, ...geometry } = row.locales.ru;
    const { screenshotSha256: en, ...english } = row.locales.en;
    assert.match(ru, /^[a-f0-9]{64}$/u);
    assert.match(en, /^[a-f0-9]{64}$/u);
    assert.deepEqual(english, geometry, row.name);
    for (const repeat of row.repeats ?? []) for (const locale of ['ru', 'en']) {
      const { screenshotSha256, ...measured } = repeat.locales[locale];
      assert.match(screenshotSha256, /^[a-f0-9]{64}$/u);
      assert.deepEqual(measured, geometry, row.name + '/repeat');
    }
    controls += Object.keys(row.controls).length;
  }
  assert.equal(controls, 270);
});

test('numeric width, sign, value buttons and fonts match 270 native controls', () => {
  for (const row of metrics.rows) for (const [name, field] of Object.entries(row.controls)) {
    const node = { kind: 'InputField', properties: Object.entries(field.properties).map(([name, text]) => ({
      key: { namespace: FORM_NS, name }, value: { kind: 'text', text },
    })), presentation: { valueType: field.type, font: field.font } };
    const label = row.name + '/' + name;
    assert.equal(inputChoiceButton(node, 'linux'), field.choice, label + '/choice');
    assert.equal(fieldWidth(node, 'linux'), field.logicalWidth, label + '/width');
    assert.equal(inputHeight(node, 'linux'), field.height, label + '/height');
  }
});
