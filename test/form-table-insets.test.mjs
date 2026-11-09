import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';

for (const [directory, forms] of [['native-table-insets', 6], ['native-table-toolbar-insets', 8]]) {
  test(`${directory} binds ${forms} canonical forms and ${forms * 2} complete native frames`, async () => {
    const root = new URL(`tests/fixtures/forms/${directory}/`, formReferenceRoot);
    const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
    const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
    assert.equal(metrics.rows.length, forms);
    assert.equal(manifest.captures.length, forms * 2);
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
    const geometry = name => metrics.rows.find(row => row.name === name).locales.en;
    if (directory === 'native-table-insets') {
      assert.equal(geometry('StatusOnly').fields.Rows[1] - geometry('StatusNone').fields.Rows[1], 30);
      assert.equal(geometry('StatusSearch').fields.Rows[1] - geometry('StatusOnly').fields.Rows[1], 31);
    } else {
      assert.equal(geometry('SearchAuto').fields.Rows[1], geometry('SearchFixed').fields.Rows[1]);
      assert.equal(geometry('SearchTop').fields.Rows[1] - geometry('SearchAuto').fields.Rows[1], 31);
      assert.deepEqual(geometry('RootOnly').frame, [634, 204]);
      assert.equal(geometry('RootOnly').fields.Above, null);
      assert.equal(geometry('RootOnly').fields.Below, null);
    }
  });
}

test('retained table references bind nine XML sources and eighteen complete outer frames', async () => {
  const root = new URL('tests/fixtures/forms/native-tables/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('frame-metrics.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 9);
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    for (const expected of Object.values(row.locales)) {
      assert.match(expected.screenshotSha256, /^[a-f0-9]{64}$/u);
      const [left, top, right, bottom] = expected.blueBounds;
      assert.deepEqual(expected.frame, [right - left + 2, bottom - top + 2]);
      assert.ok(expected.grid[0] >= 0 && expected.grid[1] >= 0);
      assert.ok(expected.grid[0] + expected.grid[2] <= expected.frame[0]);
      assert.ok(expected.grid[1] + expected.grid[3] <= expected.frame[1]);
    }
  }
});
