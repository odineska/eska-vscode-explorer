import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { designCaptionWidth } from '../webview/forms/font-metrics.mjs';
import { inputCaptionInset } from '../webview/forms/field-caption-layout.js';
import { FORM_NS, fieldWidth, inputPaintedOutset, linuxReferenceInput, nativeReferenceInput } from '../webview/forms/model.mjs';

const root = new URL('tests/fixtures/forms/native-input-choice-size/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
const nodeFor = row => ({ kind: 'InputField', properties: Object.entries(row.properties).map(([name, text]) => ({
  key: { namespace: FORM_NS, name }, value: { kind: 'text', text },
})), presentation: { font: row.font, valueType: row.type } });

test('choice size corpus binds eight canonical forms and sixteen native captures', async () => {
  assert.equal(metrics.rows.length, 8);
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(manifest.captures.length, 16);
  assert.equal(manifest.sourcesUnchanged, true);
  assert.ok(manifest.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged));
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: en, ...english } = row.locales.en;
    const { screenshotSha256: ru, ...russian } = row.locales.ru;
    assert.match(en, /^[a-f0-9]{64}$/u);
    assert.match(ru, /^[a-f0-9]{64}$/u);
    assert.deepEqual(english, russian, row.name);
  }
  for (const [file, digest] of [['Catalog.xml', metrics.catalogSha256], ['Enum.xml', metrics.enumSha256]]) {
    assert.equal(createHash('sha256').update(await readFile(new URL(file, root))).digest('hex'), digest);
  }
});

test('multiline choice allocation matches the complete native width', () => {
  for (const row of metrics.rows.filter(row => row.name.startsWith('Multiline'))) {
    const node = nodeFor(row);
    assert.equal(fieldWidth(node, 'linux') + inputPaintedOutset(node, 'linux'), row.locales.en.fields.Reference[2], row.name);
  }
});

test('no-open enumeration captions use the common native reference profile and inset', () => {
  for (const row of metrics.rows.filter(row => row.type.kind === 'reference')) {
    const node = nodeFor(row);
    assert.equal(linuxReferenceInput(node, 'linux'), true, row.name);
    assert.equal(nativeReferenceInput(node, 'linux'), false, row.name + '/open-button bounds unchanged');
    assert.equal(linuxReferenceInput(node, 'win32'), false);
    if (row.label) {
      const titleAndGap = row.locales.en.fields.Reference[0] - row.locales.en.fields.Above[0];
      assert.equal(designCaptionWidth(row.label, row.font) + inputCaptionInset + 4, titleAndGap, row.name);
    }
  }
});
