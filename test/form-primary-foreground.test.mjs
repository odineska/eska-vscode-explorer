import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { primaryForeground } from '../webview/forms/primary-foreground.mjs';

test('primary contrast matches 4096 independent native results including a complete gray ramp', async () => {
  const oracle = JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-primary-buttons/contrast-vectors.json', import.meta.url)));
  for (const row of oracle.vectors) {
    const rgb = row.background.slice(1).match(/../g).map(value => parseInt(value,16));
    assert.equal(primaryForeground(rgb), parseInt(row.foreground.slice(1,3),16), row.background);
  }
  assert.equal(oracle.vectors.length, 4096);
  assert.equal(primaryForeground([255,225,0]),71);
  for (const invalid of [null,[],[1,2],[256,0,0],[-1,0,0],[0,0,.5],[0,0,NaN]]) assert.throws(() => primaryForeground(invalid),/primary-button-color/);
});
