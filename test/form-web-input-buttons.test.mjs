import test from 'node:test';
import assert from 'node:assert/strict';
import { inputButtonGlyphs } from '../webview/forms/reference-button-paint.mjs';
import { referenceButtonSlotWidth } from '../webview/forms/model.mjs';

test('built-in input button symbols use fixed logical dimensions', () => {
  const sizes = {
    open: [11, 11], choice: [9, 3], dropdown: [7, 5],
    clear: [9, 9], calendar: [11, 11], calculator: [9, 11],
  };
  for (const [kind, size] of Object.entries(sizes)) {
    const [glyph] = inputButtonGlyphs(kind);
    assert.equal(glyph.role, kind);
    assert.deepEqual([glyph.width, glyph.height], size);
    assert.ok(glyph.fill || glyph.stroke);
    assert.ok(glyph.width < referenceButtonSlotWidth - 1);
  }
});

test('the spin button contains two different arrows in top-to-bottom order', () => {
  const [up, down] = inputButtonGlyphs('spin');
  assert.deepEqual([up.role, down.role], ['spin-up', 'spin-down']);
  assert.deepEqual([up.width, up.height], [5, 3]);
  assert.deepEqual([down.width, down.height], [5, 3]);
  assert.notEqual(up.fill, down.fill);
});
