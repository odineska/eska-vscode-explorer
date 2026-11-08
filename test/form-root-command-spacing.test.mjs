import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';

test('root command spacing binds two canonical forms and four complete native frames', async () => {
  const root = new URL('tests/fixtures/forms/native-root-command-spacing/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 2);
  assert.equal(manifest.captures.length, 4);
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
  }
  for (const locale of ['en', 'ru']) {
    const plain = metrics.rows.find(row => row.name === 'RootNone').locales[locale];
    const commands = metrics.rows.find(row => row.name === 'RootOnlyMenu').locales[locale];
    assert.equal(commands.frame[1] - plain.frame[1], 27);
    for (const name of ['Above', 'Below']) assert.equal(commands.fields[name][1] - plain.fields[name][1], 27);
  }
});
