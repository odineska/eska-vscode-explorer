import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { wordCaptionWidth } from '../webview/forms/font-metrics.mjs';
import { buttonMetrics } from '../webview/forms/model.mjs';
import { formReferenceRoot } from './form-references.mjs';

const root = new URL('tests/fixtures/forms/native-help-command/', formReferenceRoot);

test('native Help command binds thirteen canonical forms, twenty-six frames and an explicit empty-picture control', async () => {
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 13);
  assert.equal(manifest.captures.length, 26);
  assert.ok(manifest.sourcesUnchanged && manifest.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged));
  for (const row of metrics.rows) {
    assert.equal(createHash('sha256').update(await readFile(new URL(row.name + '.xml', root))).digest('hex'), row.xmlSha256);
    for (const locale of ['en', 'ru']) {
      assert.equal(manifest.captures.find(capture => capture.name === row.name && capture.locale === locale)?.sha256,
        row.locales[locale].screenshotSha256);
    }
  }
  const row = name => metrics.rows.find(row => row.name === name);
  assert.equal(row('HelpEmpty').pictureRef, '0');
  for (const locale of ['en', 'ru']) {
    assert.equal(row('HelpAuto').locales[locale].buttonRgbSha256, row('HelpText').locales[locale].buttonRgbSha256);
    assert.deepEqual(row('HelpEmpty').locales[locale].fields.TargetButton, row('HelpPicture').locales[locale].fields.TargetButton);
    assert.notEqual(row('HelpEmpty').locales[locale].buttonRgbSha256, row('HelpPicture').locales[locale].buttonRgbSha256);
    assert.notEqual(row('HelpOverride').locales[locale].buttonRgbSha256, row('HelpPicture').locales[locale].buttonRgbSha256);
  }
});


test('regular word advances match both standard and local native captions at 10 and 16 pt', async () => {
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  for (const row of metrics.rows) for (const native of Object.values(row.locales)) {
    const content = native.buttonContent.TargetButton;
    if (!content.text) continue;
    const font = { points: row.name.endsWith('16') ? 16 : 10, weight: 400 };
    const width = native.fields.TargetButton[2] - 2 * buttonMetrics(font).horizontalPadding - 2 - (content.picture ? 16 : 0);
    assert.equal(wordCaptionWidth(content.text, font), width, row.name);
  }
});


test('native command-bar controls keep a picture-only command caption hidden when no image exists', async () => {
  const base = new URL('bar-negative-controls/', root);
  const observations = JSON.parse(await readFile(new URL('observations.json', base), 'utf8'));
  assert.ok(observations.sourcesUnchanged && observations.runs.every(run => run.exitCode === 0));
  assert.equal(observations.sources.length, 2);
  assert.equal(observations.captures.length, 4);
  for (const source of observations.sources) {
    assert.equal(createHash('sha256').update(await readFile(new URL(source.file, base))).digest('hex'), source.xmlSha256);
  }
  assert.ok(observations.captures.every(capture => capture.redCaptionPixels === 0));
});
