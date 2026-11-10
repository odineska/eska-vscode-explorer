import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS, fieldWidth, inputControlHeight, inputOpenButton, inputListChoice, referenceInputButtons } from '../webview/forms/model.mjs';

const root = new URL('tests/fixtures/forms/native-reference-widths/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
const nodeFor = row => ({ kind: 'InputField',
  properties: Object.entries(row.properties).map(([name, text]) => ({ key: { namespace: FORM_NS, name }, value: { kind: 'text', text } })),
  presentation: { font: row.font, valueType: row.valueType },
});

test('reference width corpus binds 15 canonical forms and 30 complete native frames', async () => {
  assert.equal(metrics.rows.length, 15);
  for (const row of metrics.rows) {
    assert.equal(createHash('sha256').update(await readFile(new URL(row.name + '.xml', root))).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: ru, ...expected } = row.locales.ru;
    const { screenshotSha256: en, ...english } = row.locales.en;
    assert.match(ru, /^[a-f0-9]{64}$/u);
    assert.match(en, /^[a-f0-9]{64}$/u);
    assert.deepEqual(english, expected, row.name);
  }
  for (const [file, hashes] of Object.entries(metrics.metadata)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(file, root))).digest('hex'), hashes.xmlSha256, file);
  }
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(manifest.stands.reduce((n, stand) => n + stand.captures.length, 0), 30);
  assert.ok(manifest.stands.every(stand => stand.sourcesUnchanged && stand.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged)));
});

test('explicit and automatic reference widths and default buttons match native Linux controls', () => {
  const failures = [];
  for (const row of metrics.rows) {
    const node = nodeFor(row);
    const actual = { width: fieldWidth(node, 'linux'),
      open: inputOpenButton(node, 'linux'),
      list: inputListChoice(node, 'linux') };
    const expected = { width: row.locales.en.fields.Reference[2], open: row.buttons.open, list: row.buttons.list };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ name: row.name, actual, expected });
  }
  assert.deepEqual(failures, []);
});

test('enumeration button defaults are profile-scoped and explicit XML keeps priority', () => {
  const node = nodeFor(metrics.rows.find(row => row.name === 'EnumDefault12'));
  assert.equal(inputOpenButton(node, 'linux'), false);
  assert.equal(inputListChoice(node, 'linux'), true);
  assert.equal(inputOpenButton(node, 'win32'), true);
  assert.equal(inputListChoice(node, 'win32'), false);
  node.properties.push({ key: { namespace: FORM_NS, name: 'OpenButton' }, value: { kind: 'text', text: 'true' } });
  node.properties.push({ key: { namespace: FORM_NS, name: 'ListChoiceMode' }, value: { kind: 'text', text: 'false' } });
  assert.equal(inputOpenButton(node, 'linux'), true);
  assert.equal(inputListChoice(node, 'linux'), false);
});

test('native reference button order and input size match 110 recorded states', async () => {
  const directory = new URL('../native-reference-buttons/', root);
  const { forms } = JSON.parse(await readFile(new URL('metrics.json', directory), 'utf8'));
  assert.equal(forms.reduce((count, form) => count + form.fields.length, 0), 110);
  for (const form of forms) {
    const source = await readFile(new URL(form.file, directory));
    assert.equal(createHash('sha256').update(source).digest('hex'), form.sourceSha256, form.name);
    for (const field of form.fields) {
      const label = `${form.name}/${field.name}`;
      const node = nodeFor({ ...field, valueType: form.valueType });
      assert.deepEqual(referenceInputButtons(node, 'linux'), field.buttons, label);
      assert.equal(fieldWidth(node, 'linux'), field.rect[2], label);
      assert.equal(inputControlHeight(node, 'linux'), field.rect[3], label);
      assert.equal(referenceInputButtons(node, 'win32'), undefined, label);
    }
  }
});
