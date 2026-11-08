import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';

test('unlabeled checkbox column corpus binds eight forms and sixteen complete native frames', async () => {
  const root = new URL('tests/fixtures/forms/native-unlabeled-checkbox-columns/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 8);
  assert.equal(manifest.captures.length, 16);
  assert.equal(manifest.sourcesUnchanged, true);
  assert.ok(manifest.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged));
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: ru, ...expected } = row.locales.ru;
    const { screenshotSha256: en, ...english } = row.locales.en;
    assert.match(ru, /^[a-f0-9]{64}$/u);
    assert.match(en, /^[a-f0-9]{64}$/u);
    assert.deepEqual(english, expected, row.name);
    assert.equal(expected.checkboxPaint.length, 2);
  }
  const separate = metrics.rows.find(row => row.name === 'RowsSeparate').locales.en.fields;
  const combined = metrics.rows.find(row => row.name === 'RowsCombined').locales.en.fields;
  assert.equal(separate.Minimum[0], separate.Maximum[0]);
  assert.notEqual(combined.Minimum[0], combined.Maximum[0]);
});
