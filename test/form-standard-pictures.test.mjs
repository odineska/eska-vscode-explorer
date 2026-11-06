import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {standardPicture} from '../webview/forms/standard-pictures.mjs';

function compositeHash(image, matteAt) {
 const rgb = Buffer.alloc(16 * 16 * 3);
 for (let pixel = 0; pixel < 256; pixel++) {
  const matte = matteAt(Math.floor(pixel / 16)), alpha = image.rgba[pixel * 4 + 3];
  for (let channel = 0; channel < 3; channel++) {
   rgb[pixel * 3 + channel] = Math.round(image.rgba[pixel * 4 + channel] * alpha / 255)
    + Math.round(matte[channel] * (255 - alpha) / 255);
  }
 }
 return createHash('sha256').update(rgb).digest('hex');
}

test('standard pictures preserve native pixels on three mattes',async()=>{
 const matrix=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-standard-pictures/metrics.json',formReferenceRoot)));let pixels=0;
 for(const row of matrix.rows)for(const expected of row.pictures){
  const image=standardPicture('StdPicture.'+expected.name);
  assert.deepEqual([image.width,image.height],[16,16]);
  assert.equal(compositeHash(image, () => row.matte),expected.rgbSha256,row.name+'/'+expected.name);pixels+=256;
 }
 for(const table of matrix.tableConsumers)for(const [locale,pictures]of Object.entries(table.locales))for(const expected of pictures){
  const image=standardPicture(expected.name);
  assert.equal(compositeHash(image, row => expected.backgroundRows[row]),expected.rgbSha256,locale+'/'+expected.name);
 }
 assert.equal(pixels,matrix.pixels);assert.equal(matrix.recovery.differingPixels,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
 for(const name of ['Copy','Unknown','PrefixMoveUp','MoveUpSuffix',null])assert.equal(standardPicture(name),undefined);
 assert.equal(standardPicture('MoveUp','tableCommand'),undefined,'automatic table movement has a different native image');
 assert.deepEqual(standardPicture('Find'),standardPicture('SearchControl'));assert.notDeepEqual(standardPicture('CloneObject'),standardPicture('CloneListItem'));
});

test('the exchange-plan picture matches Linux Configurator on three mattes', () => {
 const image = standardPicture('StdPicture.ExchangePlan');
 assert.deepEqual([image.width, image.height], [16, 16]);
 for (const [matte, expected] of [
  [[255, 255, 255], 'd12622c367d2d62c224f1b813215ff17c20f65bb65e17889599250cc12cbb594'],
  [[0, 0, 0], '1e46c749c1ff45a837f2ccaa47d91fb5ed17e74ccd386aa6d1522c25f5c0a658'],
  [[255, 0, 0], '9eba85ddb1d441de8ef9bb8e841451b0fde41dfad1fec0aa2677281a2d85b1ee'],
 ]) {
  assert.equal(compositeHash(image, () => matte), expected);
 }
});
