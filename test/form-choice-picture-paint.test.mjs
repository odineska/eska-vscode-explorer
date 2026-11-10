import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choicePictureBounds, inactiveChoicePicture } from '../webview/forms/choice-picture-paint.mjs';
import { standardPicture } from '../webview/forms/standard-pictures.mjs';

test('choice artwork fits within the native slot without enlarging small images', () => {
  for (const [width, height, buttonHeight, expected] of [
    [16, 16, 23, { x: 2, y: 2, width: 16, height: 16 }],
    [24, 16, 23, { x: 0, y: 4, width: 20, height: 13 }],
    [16, 24, 23, { x: 3, y: 0, width: 14, height: 21 }],
    [8, 8, 23, { x: 6, y: 6, width: 8, height: 8 }],
    [16, 16, 11, { x: 5, y: 0, width: 9, height: 9 }],
    [24, 16, 11, { x: 3, y: 0, width: 14, height: 9 }],
  ]) {
    assert.deepEqual(choicePictureBounds({ width, height }, buttonHeight), expected);
  }
  assert.equal(choicePictureBounds({ width: 0, height: 16 }, 23), undefined);
  assert.equal(choicePictureBounds({ width: 16, height: 16 }, 2), undefined);
});

test('inactive artwork keeps alpha and matches native opaque sample colors', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 224, 32, 32, 255, 0, 0, 0, 0]);
  inactiveChoicePicture(pixels);
  assert.deepEqual([...pixels], [144, 144, 144, 255, 207, 207, 207, 255, 180, 162, 162, 255, 0, 0, 0, 0]);
  for (const name of ['StdPicture.MoveLeft', 'StdPicture.OpenFile']) {
    const picture = standardPicture(name);
    assert.equal(picture.rgba.length, 16 * 16 * 4);
    assert.ok(picture.rgba.some(value => value === 255));
  }
});
