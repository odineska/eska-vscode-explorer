import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { controlCaptionWidth, wordCaptionWidth } from '../webview/forms/font-metrics.mjs';
import { formReferenceRoot } from './form-references.mjs';

const root = new URL('tests/fixtures/forms/native-checkbox-auto-spacing/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));

test('checkbox spacing corpus binds sixteen canonical forms and thirty-two native frames', async () => {
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 16);
  assert.equal(manifest.captures.length, 32);
  assert.equal(manifest.sourcesUnchanged, true);
  assert.ok(manifest.runs.every(stand => stand.sourcesUnchanged && stand.runs.every(run => run.exitCode === 0)));
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const { screenshotSha256: english, ...en } = row.locales.en;
    const { screenshotSha256: russian, ...ru } = row.locales.ru;
    assert.deepEqual(en, ru, row.name);
    for (const [locale, digest] of [['en', english], ['ru', russian]]) {
      assert.equal(manifest.captures.find(capture => capture.name === row.name && capture.locale === locale)?.sha256, digest);
    }
  }
});

test('word caption measurement matches the independent native displacement of a numeric neighbor', () => {
  const font = { points: 10, weight: 400 };
  for (const place of ['Root', 'Page']) for (const mode of ['Default', 'Always']) {
    const short = metrics.rows.find(row => row.name === `Gap${place}${mode}Checkbox`);
    const long = metrics.rows.find(row => row.name === `GapLong${place}${mode}Long`);
    const displacement = long.locales.en.fields.Value[0] - short.locales.en.fields.Value[0];
    assert.equal(wordCaptionWidth(long.checkboxCaption, font) - wordCaptionWidth(short.checkboxCaption, font), displacement);
    assert.notEqual(controlCaptionWidth(long.checkboxCaption, font) - controlCaptionWidth(short.checkboxCaption, font), displacement);
  }
});
