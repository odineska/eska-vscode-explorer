import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';

test('table inset corpus binds six canonical forms and twelve complete native frames', async () => {
  const root = new URL('tests/fixtures/forms/native-table-insets/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 6);
  assert.equal(manifest.captures.length, 12);
  assert.equal(manifest.sourcesUnchanged, true);
  assert.ok(manifest.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged));
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: en, ...geometry } = row.locales.en;
    const { screenshotSha256: ru, ...russian } = row.locales.ru;
    assert.match(en, /^[a-f0-9]{64}$/u);
    assert.match(ru, /^[a-f0-9]{64}$/u);
    assert.deepEqual(geometry, russian, row.name);
    assert.deepEqual(geometry.combinedGrid, geometry.fields.Rows);
  }
  const catalog = await readFile(new URL('Catalog.xml', root));
  assert.equal(createHash('sha256').update(catalog).digest('hex'), metrics.catalogSha256);
  const gridY = name => metrics.rows.find(row => row.name === name).locales.en.fields.Rows[1];
  assert.equal(gridY('StatusOnly') - gridY('StatusNone'), 30);
  assert.equal(gridY('StatusSearch') - gridY('StatusOnly'), 31);
});
