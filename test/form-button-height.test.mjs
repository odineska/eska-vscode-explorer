import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS, buttonControlHeight } from '../webview/forms/model.mjs';

const root = new URL('tests/fixtures/forms/native-button-heights/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
const nodeFor = row => ({ kind: 'Button', presentation: { font: row.font },
  properties: Object.entries(row.properties).map(([name, text]) => ({
    key: { namespace: FORM_NS, name }, value: { kind: 'text', text },
  })),
});

test('authored button height corpus binds 22 canonical forms and 44 complete native frames', async () => {
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 22);
  assert.equal(manifest.captures.length, 44);
  assert.equal(manifest.sourcesUnchanged, true);
  assert.ok(manifest.runs.every(stand => stand.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged)));
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    assert.equal(Number(row.properties.Height ?? 0), row.canonicalHeight ?? 0, row.name);
    const { screenshotSha256: english, ...en } = row.locales.en;
    const { screenshotSha256: russian, ...ru } = row.locales.ru;
    assert.deepEqual(en, ru, row.name);
    for (const [locale, digest] of [['en', english], ['ru', russian]]) {
      assert.equal(manifest.captures.find(capture => capture.name === row.name && capture.locale === locale)?.sha256, digest);
    }
  }
});

test('ordinary button border height and shadow match every native authored height', () => {
  for (const row of metrics.rows) {
    assert.equal(buttonControlHeight(nodeFor(row), 'linux') + 1, row.locales.en.fields.TargetButton[3], row.name);
  }
});

test('shared button height preserves all existing native automatic font sizes', async () => {
  const source = new URL('tests/fixtures/forms/native-button-metrics/metrics.json', formReferenceRoot);
  const reference = JSON.parse(await readFile(source, 'utf8'));
  for (const row of reference.rows) {
    const font = { points: row.points, weight: row.weight === 'bold' ? 700 : 400 };
    const node = { kind: 'Button', properties: [], presentation: { font } };
    assert.equal(buttonControlHeight(node, 'linux'), row.buttons[0].height, row.name);
    assert.equal(buttonControlHeight(node, 'win32'), row.buttons[0].height, row.name + '/Windows formula unchanged');
  }
});
