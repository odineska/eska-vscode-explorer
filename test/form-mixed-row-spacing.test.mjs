import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FORM_NS, fieldWidth, stringLabelMetrics } from '../webview/forms/model.mjs';
import { formReferenceRoot } from './form-references.mjs';

const root = new URL('tests/fixtures/forms/native-mixed-row-spacing/', formReferenceRoot);

test('mixed row corpus binds 21 canonical forms and 42 independent native captures', async () => {
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 21);
  assert.equal(manifest.captures.length, 42);
  assert.ok(manifest.stands.every(stand => stand.sourcesUnchanged
    && stand.runs.length === 2 && stand.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged)));
  for (const row of metrics.rows) {
    assert.equal(createHash('sha256').update(await readFile(new URL(row.name + '.xml', root))).digest('hex'), row.xmlSha256);
    const { screenshotSha256: enDigest, ...en } = row.locales.en;
    const { screenshotSha256: ruDigest, ...ru } = row.locales.ru;
    assert.deepEqual(en, ru, row.name);
    for (const [locale, digest] of [['en', enDigest], ['ru', ruDigest]]) {
      assert.equal(manifest.captures.find(c => c.name === row.name && c.locale === locale)?.sha256, digest);
    }
  }
  const rows = Object.fromEntries(metrics.rows.map(row => [row.name, row.locales.en]));
  for (const pair of ['RootButtonDecor', 'RootButtonField', 'RootBspCaption', 'PageButtonDecor', 'PageButtonField', 'PageBspCaption']) {
    assert.equal(rows[pair].frame[0] - rows['Plain' + pair].frame[0], 2, pair + ' background inset');
  }
  assert.equal(rows.RootButtonField.labelColumns.Label[1], 102);
  assert.equal(rows.RootDouble.frame[0] - rows.RootNone.frame[0], 20);
  assert.equal(rows.RootSingle.frame[0] - rows.RootNone.frame[0], 10);
});

test('explicit text label geometry retains native background insets without changing numeric labels', () => {
  const label = painted => ({ kind: 'LabelField',
    presentation: { valueType: { kind: 'string' }, titleLocation: 'None', font: { points: 10 } },
    properties: Object.entries({ Width: '10', ...(painted ? { BackColor: '#C9E6F2' } : {}) })
      .map(([name, text]) => ({ key: { namespace: FORM_NS, name }, value: { kind: 'text', text } })),
  });
  assert.deepEqual(stringLabelMetrics(label(true), 'linux'), { preferred: 102, height: 19 });
  assert.deepEqual(stringLabelMetrics(label(false), 'linux'), { preferred: 100, height: 17 });
  assert.equal(fieldWidth(label(true), 'linux'), 102);
  assert.equal(stringLabelMetrics(label(true), 'win32'), undefined);
  const numeric = label(true); numeric.presentation.valueType = { kind: 'number', digits: 8 };
  assert.equal(stringLabelMetrics(numeric, 'linux'), undefined);
});
