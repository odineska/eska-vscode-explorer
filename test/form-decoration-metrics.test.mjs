import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';
import { decorationCaptionProfile, fieldCaptionProfile } from '../webview/forms/font-metrics.mjs';
import { labelDecorationProfile, labelDecorationLines } from '../webview/forms/decoration-metrics.mjs';

const sample = 'AV To Юрий: Подробное пояснение.';
function node(properties = {}, font = { points: 10, weight: 400 }) {
  return { presentation: { font }, properties: Object.entries(properties).map(([name, text]) => ({
    key: { namespace: FORM_NS, name }, value: { kind: 'text', text: String(text) },
  })) };
}

test('decoration words match native widths at seven independent font sizes', () => {
  for (const [points, width] of [[8,183],[9,205],[10,218],[11,247],[12,268],[14,324],[16,357]]) {
    assert.equal(decorationCaptionProfile(sample, { points }).preferred, width, `${points}pt`);
  }
  assert.equal(decorationCaptionProfile(sample, { points: 10, face: 'Liberation Serif' }).preferred, 205);
  assert.equal(decorationCaptionProfile(sample, { points: 10, face: 'Liberation Mono' }).preferred, 256);
  assert.equal(decorationCaptionProfile(sample, { points: 10, weight: 700 }).preferred, 234);
  assert.equal(decorationCaptionProfile(sample, { points: 10, italic: true }).preferred, 217);
  // Input captions retain their separately accepted shaping rules.
  assert.equal(fieldCaptionProfile(sample, { points: 10 }).preferred, 217);
});

test('automatic width wraps at 400px and keeps the longest resulting line', () => {
  const text = 'Для некоторых введенных строк не найдено данных в приложении, либо имеется несколько вариантов.';
  const automatic = labelDecorationProfile(node(), text);
  assert.equal(automatic.width, 330);
  assert.equal(automatic.preferred.height, 30);
  assert.equal(automatic.preferred.text, 'Для некоторых введенных строк не найдено данных в\nприложении, либо имеется несколько вариантов.');
  const unlimited = labelDecorationProfile(node({ AutoMaxWidth: false }), text);
  assert.equal(unlimited.width, 634);
  assert.equal(unlimited.preferred.height, 15);
  const fixed = labelDecorationProfile(node({ Width: 20 }), text);
  assert.equal(fixed.width, 200);
  assert.equal(fixed.preferred.height, 60);
  assert.equal(labelDecorationLines(unlimited, 400).text, automatic.preferred.text);
  assert.equal(labelDecorationProfile(node({ Width: 40 }), text).preferred.height, 30);
});

test('explicit decoration line breaks keep empty content and close a terminal line', () => {
  assert.equal(labelDecorationProfile(node(), sample + '\n').preferred.height, 15);
  assert.equal(labelDecorationProfile(node(), sample + '\n' + sample).preferred.height, 30);
  for (const text of ['', ' ']) assert.equal(labelDecorationProfile(node(), text).preferred.height, 15);
  assert.equal(decorationCaptionProfile('e\u0301', { points: 10 }), undefined);
});

test('native decoration corpus retains 95 XML sources and both locale captures', async () => {
  const root = new URL('tests/fixtures/forms/native-label-layout/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 95);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 95);
  for (const row of metrics.rows) {
    const source = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(source).digest('hex'), row.xmlSha256, row.name);
    for (const locale of ['ru', 'en']) assert.match(row.nativeScreenshots[locale], /^[a-f0-9]{64}$/u);
  }
  const rows = Object.fromEntries(metrics.rows.map(row => [row.name, row]));
  assert.equal(rows.BspUnitedTrue.frame[1] - rows.BspControl.frame[1], 3);
  assert.equal(rows.BspWithAbove.frame[1] - rows.BspControl.frame[1], 32);
  assert.equal(rows.HyperlinkLines1.frame[0] - rows.LinkControl.frame[0], 2);
  assert.equal(rows.HyperlinkLines1.frame[1] - rows.LinkControl.frame[1], 2);
  assert.equal(rows.NativeDecorations.frame[1], 118);
});
