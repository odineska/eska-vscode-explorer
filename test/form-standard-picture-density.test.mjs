import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { scaleRaster } from '../webview/forms/raster-scale.mjs';
import { selectStandardPictureVariant } from '../webview/forms/standard-picture-density.mjs';
import { standardPicture, usesStandardPictureArtwork } from '../webview/forms/standard-pictures.mjs';

const scales = [85, 100, 125, 150, 175, 200, 300, 400];
const variants = scales.map(scale => ({ scale }));

test('standard pictures select density using form zoom and DPR', () => {
  for (const scale of scales.filter(scale => scale !== 100)) {
    assert.equal(selectStandardPictureVariant(variants, scale, 1).scale, scale);
  }
  for (const [zoom, ratio, expected] of [[75, 1, 85], [110, 1, 100], [125, 1.2, 150], [150, 2, 300], [250, 2, 400]]) {
    assert.equal(selectStandardPictureVariant(variants, zoom, ratio).scale, expected);
  }
  assert.equal(selectStandardPictureVariant(variants, Math.sqrt(125 * 150), 1).scale, 150);
  for (const ratio of [1, 1.25, 2, 4]) {
    assert.equal(selectStandardPictureVariant(variants, 100, ratio), undefined);
  }
  assert.equal(selectStandardPictureVariant(undefined, 125, 1), undefined);
  assert.equal(selectStandardPictureVariant(variants, 125, NaN), undefined);
});

test('coverage resampling preserves thin native strokes without blending transparent ink', () => {
  const image = { width: 4, height: 1, rgba: Uint8ClampedArray.from([
    255, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 128, 255, 0, 0, 0,
  ]) };
  assert.equal(scaleRaster(image, 4, 1), image);
  const resized = scaleRaster(image, 3, 1);
  assert.deepEqual([...resized.rgba], [0, 0, 255, 64, 0, 0, 255, 192, 0, 0, 255, 32]);
  const integer = scaleRaster(image, 8, 2);
  assert.deepEqual([...integer.rgba.slice(8, 16)], [0, 0, 255, 255, 0, 0, 255, 255]);
});

test('table menus use regular web artwork only when there is no desktop menu override', () => {
  for (const name of ['MarkObjectForDeletion', 'DeleteListItemDirectly', 'Refresh', 'Find', 'Post']) {
    assert.equal(usesStandardPictureArtwork(`StdPicture.${name}`, 'tableMenu'), false);
    assert.notDeepEqual(standardPicture(name, 'tableMenu'), standardPicture(name));
  }
  for (const name of ['OpenFile', 'CheckAll', 'ExchangePlan']) {
    assert.equal(usesStandardPictureArtwork(`StdPicture.${name}`, 'tableMenu'), true);
    assert.deepEqual(standardPicture(name, 'tableMenu'), standardPicture(name));
  }
  assert.equal(usesStandardPictureArtwork('MoveUp', 'tableCommand'), false);
});

test('the bundle includes only desktop-verified standard PNGs at their original densities', async () => {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL('../webview/forms/web-standard-pictures.mjs', import.meta.url))],
    bundle: true, format: 'esm', write: false, loader: { '.png': 'dataurl' },
  });
  const { webStandardPictures } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
  const names = ['CheckAll', 'DeleteListItemDirectly', 'EventLog', 'ExchangePlan', 'MoveLeft', 'OpenFile', 'Post', 'Refresh', 'UncheckAll'];
  assert.deepEqual(Object.keys(webStandardPictures), names);
  const checksums = new Map((await readFile(new URL(
    '../resources/forms/web-client-pictures/SHA256SUMS', import.meta.url,
  ), 'utf8')).trim().split('\n').map(line => line.split('  ').reverse()));
  assert.equal(checksums.size, names.length * scales.length);
  for (const name of names) {
    assert.deepEqual(webStandardPictures[name].map(variant => variant.scale), scales);
    for (const { scale, source } of webStandardPictures[name]) {
      assert.match(source, /^data:image\/png;base64,/);
      const png = Buffer.from(source.split(',')[1], 'base64');
      const size = Math.round(16 * scale / 100);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], `${name}/${scale}`);
      assert.equal(createHash('sha256').update(png).digest('hex'), checksums.get(`${name}/${scale}.png`));
    }
  }
});
