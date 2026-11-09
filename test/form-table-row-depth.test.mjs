import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { tableLayout } from '../webview/forms/table-model.mjs';

const root = new URL('tests/fixtures/forms/native-table-row-depth/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));

test('compound table corpus binds 44 canonical forms and 96 complete native frames', async () => {
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 44);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 44);
  assert.equal(manifest.captures.length, 96);
  assert.ok(manifest.captures.every(capture => capture.completeFrame && capture.completeBottomBorder));
  assert.ok(manifest.stands.every(stand => stand.sourcesUnchanged && stand.runs.every(run => run.exitCode === 0)));
  for (const row of metrics.rows) {
    assert.equal(createHash('sha256').update(await readFile(new URL(row.name + '.xml', root))).digest('hex'), row.xmlSha256);
    const { screenshotSha256: en, ...english } = row.locales.en;
    const { screenshotSha256: ru, ...russian } = row.locales.ru;
    assert.deepEqual(english, russian, row.name);
    for (const [locale, digest] of [['en', en], ['ru', ru]]) {
      assert.equal(manifest.captures.find(capture => capture.name === row.name && capture.locale === locale
        && capture.compatibility === 'Version8_3_27')?.sha256, digest);
      if (row.compatibility24) {
        const { screenshotSha256, ...geometry } = row.compatibility24.locales[locale];
        assert.deepEqual(geometry, english, row.name + ' compatibility');
        assert.equal(row.compatibility24.sameCanonicalXml, true);
      }
    }
  }
  assert.equal(metrics.rows.filter(row => row.compatibility24).length, 4);
});

test('compound column heights match independent row counts, captions, clipping and fonts', () => {
  const differences = metrics.rows.flatMap(row => {
    const actual = tableLayout(row.model, { os: 'linux' }).height;
    const expected = row.locales.en.fields.Rows[3];
    return actual === expected ? [] : [{ name: row.name, actual, expected }];
  });
  assert.deepEqual(differences, []);
});
