import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FORM_NS, fieldWidth, numericLabelMetrics, textLabelMetrics } from '../webview/forms/model.mjs';
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
  assert.deepEqual(textLabelMetrics(label(true), 'linux'), { preferred: 102, height: 19 });
  assert.deepEqual(textLabelMetrics(label(false), 'linux'), { preferred: 100, height: 17 });
  assert.equal(fieldWidth(label(true), 'linux'), 102);
  assert.equal(textLabelMetrics(label(true), 'win32'), undefined);
  const numeric = label(true); numeric.presentation.valueType = { kind: 'number', digits: 8 };
  assert.equal(textLabelMetrics(numeric, 'linux'), undefined);
});

test('numeric labels quantize the formatted value width in Taxi units', () => {
  const label = {
    kind: 'LabelField',
    presentation: { titleLocation: 'Left', font: { points: 10, weight: 700 } },
    properties: [{ key: { namespace: FORM_NS, name: 'BackColor' }, value: { kind: 'text', text: '#E0FFFF' } }],
  };
  for (const [digits, fraction, preferred] of [
    [1, 0, 22], [2, 0, 32], [3, 0, 32], [4, 0, 52], [5, 0, 52], [6, 0, 62],
    [7, 0, 72], [8, 0, 82], [10, 0, 102],
    [2, 1, 32], [3, 1, 42], [4, 2, 52],
    [5, 2, 52], [10, 2, 102], [14, 2, 132], [15, 2, 152], [16, 2, 152], [20, 2, 192],
    [25, 2, 232], [38, 2, 352], [15, 0, 142], [15, 5, 142],
  ]) {
    label.presentation.valueType = { kind: 'number', digits, fraction, allowedSign: 'Any' };
    assert.equal(numericLabelMetrics(label, 'linux').preferred, preferred);
  }
  label.presentation.valueType = { kind: 'number', digits: 10, fraction: 2 };
  label.presentation.tabularTotal = 'automatic';
  assert.equal(numericLabelMetrics(label, 'linux').preferred, 92);
});
