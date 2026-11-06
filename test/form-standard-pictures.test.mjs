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

test('additional-menu pictures match the recorded white and selected Linux rows', () => {
 for (const [name, white, selected] of [
  ['PostAndClose', '4aa100412baed98331a3cf87fa964b454b0bcf06547b8b219fe5902b9ac827d4', 'b1acb1c90ca800d3b7e8800a3fbf130bce60afc449d56c7b980c46bc6cfcc7fe'],
  ['Write', 'cfb6a69bb8869f1e64b8c751fe034a22abdff0ebfc6d9004cbe14a966afb7de2'],
  ['MarkObjectForDeletion', '16b89a4e98e0bd8faae1c6193cc7853ac671d5daf5ada2b8e8a40b59902b225e', '8dd000bd08d1a3f3622a23363f8794d7d98972b5224a237618a1cd7d5672b443'],
  ['UndoPosting', 'faa8cd80aafd9445508e38e8e34d3d17f8c21aaca48484ad7a8339a9ea609f54', 'f785fcd9833678bb78ca81045cabc2011eaa71d0813c733485babeb2f454fab3'],
  ['ShowInList', '6fce299a2ecf68d6b0eadd8b5bb8bc2fc2d9d5ae5698269bc05c8bd673eec147', 'cfbdb208cbd94a4f929a8aac9eb75ee82491fb47976a23afd229e3bf86f190e2'],
  ['ChangeHistory', '70db1c221cbf9f11053692cf276951615bf7480e55f781ff23c4a4848c161030', 'cc6a696388f15b065d53523f2ac6105735abdc5a141084ba85aa23f0d6bb8382'],
  ['CustomizeForm', '343625ace762a677d58ed21abdb608b0432cb417abf92f8ab18dbe5f564f3847', '7841aa2ea3c481cc8b822c2a0cf9a3e49552acd7993190da9c72771809d474e0'],
  ['Help', '4ce995460c62e4d9b64b4b3b5aaf3053cc8c2cd8f5219f585bff168ee857e076'],
 ]) {
  const image = standardPicture(name);
  assert.deepEqual([image.width, image.height], [16, 16]);
  assert.equal(compositeHash(image, () => [255, 255, 255]), white, name + ' on white');
  if (selected) assert.equal(compositeHash(image, () => [250, 204, 31]), selected, name + ' on selection');
 }
});
