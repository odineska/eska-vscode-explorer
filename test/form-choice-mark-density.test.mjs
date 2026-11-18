import test from 'node:test';
import assert from 'node:assert/strict';
import { checkboxGlyph, radioGlyph } from '../webview/forms/choice-glyph.mjs';

const blue = [34, 68, 102];

function pixel(image, x, y) {
  const offset = 4 * (y * image.width + x);
  return [...image.rgba.subarray(offset, offset + 4)];
}

test('scaled Linux mark rasters retain the disabled face, selected dot and switch silhouette', () => {
  for (const [zoom, dpr, circleSize, switchWidth, switchHeight] of [
    [75, 1, 11, 26, 15],
    [125, 1, 19, 43, 25],
    [75, 2, 23, 51, 30],
    [125, 2, 38, 85, 50],
  ]) {
    const scale = zoom * dpr / 100, middle = Math.floor(circleSize / 2);
    const checkbox = checkboxGlyph('CheckBox', true, blue, scale);
    const selected = radioGlyph(true, true, blue, scale);
    const unselected = radioGlyph(false, true, blue, scale);
    const switcher = checkboxGlyph('Switcher', false, blue, scale);
    for (const mark of [checkbox, selected, unselected]) {
      assert.deepEqual([mark.width, mark.height], [circleSize, circleSize]);
    }
    assert.deepEqual([switcher.width, switcher.height], [switchWidth, switchHeight]);
    assert.deepEqual(pixel(checkbox, middle, middle), [143, 160, 178, 255]);
    assert.deepEqual(pixel(selected, middle, middle), [209, 209, 209, 255]);
    assert.deepEqual(pixel(unselected, middle, middle), [255, 255, 255, 255]);
    assert.deepEqual(pixel(switcher, 0, 0), [...blue, 255]);
  }
  // The 1 px calibrated edge must still appear in the undersampled first row.
  const small = checkboxGlyph('CheckBox', true, blue, .75);
  assert.deepEqual(pixel(small, 5, 0), [109, 126, 144, 255]);
});
