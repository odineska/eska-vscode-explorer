import {formReferenceRoot} from './form-references.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {standardPicture} from '../webview/forms/standard-pictures.mjs';

test('six standard pictures preserve all 4608 native pixels on three mattes',async()=>{
 const matrix=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-standard-pictures/metrics.json',formReferenceRoot)));let pixels=0;
 for(const row of matrix.rows)for(const expected of row.pictures){
  const image=standardPicture('StdPicture.'+expected.name),rgb=Buffer.alloc(16*16*3);
  assert.deepEqual([image.width,image.height],[16,16]);
  for(let p=0;p<256;p++)for(let c=0;c<3;c++)rgb[p*3+c]=Math.round(image.rgba[p*4+c]*image.rgba[p*4+3]/255)+Math.round(row.matte[c]*(255-image.rgba[p*4+3])/255);
  assert.equal(createHash('sha256').update(rgb).digest('hex'),expected.rgbSha256,row.name+'/'+expected.name);pixels+=256;
 }
 for(const table of matrix.tableConsumers)for(const [locale,pictures]of Object.entries(table.locales))for(const expected of pictures){
  const image=standardPicture(expected.name),rgb=Buffer.alloc(16*16*3);
  for(let p=0;p<256;p++)for(let c=0;c<3;c++)rgb[p*3+c]=Math.round(image.rgba[p*4+c]*image.rgba[p*4+3]/255)+Math.round(expected.backgroundRows[Math.floor(p/16)][c]*(255-image.rgba[p*4+3])/255);
  assert.equal(createHash('sha256').update(rgb).digest('hex'),expected.rgbSha256,locale+'/'+expected.name);
 }
 assert.equal(pixels,4608);assert.equal(matrix.recovery.differingPixels,0);assert.equal(matrix.pixelTolerance,0);assert.deepEqual(matrix.comparisonMasks,[]);
 for(const name of ['Copy','Unknown','PrefixMoveUp','MoveUpSuffix',null])assert.equal(standardPicture(name),undefined);
 assert.equal(standardPicture('MoveUp','tableCommand'),undefined,'automatic table movement has a different native image');
 assert.deepEqual(standardPicture('Find'),standardPicture('SearchControl'));assert.notDeepEqual(standardPicture('CloneObject'),standardPicture('CloneListItem'));
});
