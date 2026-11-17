import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { referenceButtonBackground, webInputGlyphCenters } from '../webview/forms/reference-button-paint.mjs';

const assets = new URL('../resources/forms/web-client-input/', import.meta.url);
const entry = fileURLToPath(new URL('../webview/forms/web-input-button-atlas.mjs', import.meta.url));
const { outputFiles } = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', loader: { '.png': 'dataurl' } });
const { webInputButtonAtlas, webInputButtonTile } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

test('original input atlases retain their bytes and nine columns', async () => {
  const checksums = (await readFile(new URL('SHA256SUMS', assets), 'utf8')).trim().split('\n');
  const sizes = { 85: 14, 100: 16, 125: 20, 150: 24, 175: 28, 200: 32, 300: 48, 400: 64 };
  assert.equal(checksums.length, Object.keys(sizes).length);
  for (const line of checksums) {
    const [expected, file] = line.split('  ');
    const bytes = await readFile(new URL(file, assets));
    const size = sizes[/_(\d+)\.png$/.exec(file)[1]];
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    assert.equal(bytes.readUInt32BE(16), 9 * size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test('non-native zoom chooses the atlas by effective density and preserves native zoom', () => {
  for (const dpr of [1, 1.25, 2, 4]) assert.equal(webInputButtonAtlas(100, dpr), undefined);
  for (const [zoom, dpr, expected] of [[50, 1, 85], [75, 1, 85], [75, 1.25, 100], [75, 2, 150], [125, 1, 125], [150, 1.5, 200], [200, 3, 400]]) {
    assert.equal(webInputButtonAtlas(zoom, dpr).atlas[0], expected);
  }
  for (const [zoom, expected] of [[84, 85], [91, 85], [92, 100], [110, 100], [112, 125], [243, 200], [244, 300]]) {
    assert.equal(webInputButtonAtlas(zoom, 1).atlas[0], expected);
  }
  assert.equal(webInputButtonAtlas(75, Infinity), undefined);
});

test('open and both spinner arrows use native pixel dimensions without losing the divider', () => {
  const source = webInputButtonAtlas(75, 1);
  const [role, x, y] = webInputGlyphCenters('open', 23)[0];
  const tile = webInputButtonTile(source, role, x, y, 20, 21);
  assert.equal(parseFloat(tile.width) * source.density, 14);
  assert.equal(parseFloat(tile.height) * source.density, 14);
  assert.match(tile.background, /-74\.66666666666667px 0 \/ 168px/);
  const centers = webInputGlyphCenters('spin', 23);
  assert.deepEqual(centers.map(([kind]) => kind), ['spin-up', 'spin-down']);
  assert.ok(centers[0][2] < 10 && centers[1][2] > 10);
  assert.match(referenceButtonBackground('spin', 23, false, true), /^linear-gradient/);
  assert.match(referenceButtonBackground('spin', 23, true), /^url/);
});

test('large ink fits the 50 percent field slot without changing the slot dimensions', () => {
  const source = webInputButtonAtlas(50, 1);
  for (const kind of ['calculator', 'calendar']) {
    const [role, x, y] = webInputGlyphCenters(kind, 23)[0];
    const tile = webInputButtonTile(source, role, x, y, 20, 21);
    const [, top, , bottom] = source.atlas[3][kind === 'calculator' ? 0 : 1];
    const factor = parseFloat(tile.height) / source.atlas[2];
    assert.ok(parseFloat(tile.top) + top * factor >= 0);
    assert.ok(parseFloat(tile.top) + bottom * factor <= 21);
  }
});
