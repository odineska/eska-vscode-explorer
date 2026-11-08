import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';

test('native radio layout corpus binds thirteen XML forms and four compatibility probes', async () => {
  const root = new URL('tests/fixtures/forms/native-radio-layout/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 13);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 13);
  assert.equal(metrics.rows.filter(row => row.compatibility24).length, 4);
  for (const row of metrics.rows) {
    const source = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(source).digest('hex'), row.xmlSha256, row.name);
    for (const locale of ['ru', 'en']) {
      const { screenshotSha256, ...geometry } = row.locales[locale];
      assert.match(screenshotSha256, /^[a-f0-9]{64}$/u);
      for (const profile of [row.compatibility24, row.repeat27].filter(Boolean)) {
        const { screenshotSha256: probeHash, ...probe } = profile.locales[locale];
        assert.equal(profile.sameParsedXml, true);
        assert.match(probeHash, /^[a-f0-9]{64}$/u);
        assert.deepEqual(probe, geometry, row.name + '/' + locale);
      }
      const count = row.name === 'FirstTumbler' ? 0 : row.radioNames.length;
      assert.equal(geometry.marks.selected.length, count);
      assert.equal(geometry.marks.unselected.length, count);
    }
  }
  const pair = metrics.rows.find(row => row.name === 'PairExact');
  assert.deepEqual(pair.locales.ru.frame, [811, 133]);
  assert.deepEqual(pair.locales.ru.marks.selected, [[219, 72, 15, 15], [604, 72, 15, 15]]);
  assert.match((await readFile(new URL('PairExact.xml', root), 'utf8')), /Создавать  <\/v8:content>/u);
});
