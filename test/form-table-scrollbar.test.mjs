import test from 'node:test';
import assert from 'node:assert/strict';
import { horizontalScrollbarGeometry, scrollTableByColumn } from '../webview/forms/table-scrollbar.mjs';

const columns = [126, 118, 164, 314, 158, 158, 142, 1213].map(width => ({ width }));
const viewport = 584;
const grid = columns.reduce((total, column) => total + column.width, 0);
const geometry = offset => horizontalScrollbarGeometry(viewport, grid, offset);

test('the native horizontal thumb rounds the edges independently as the table scrolls', () => {
  const track = geometry(0);
  assert.deepEqual([track.trackLeft, track.trackRight, track.maximum], [23, 561, 1809]);
  const ends = offset => {
    const { thumbLeft, thumbRight } = geometry(offset);
    return [thumbLeft, thumbRight];
  };
  assert.deepEqual(ends(-20), [23, 154]);
  assert.deepEqual(ends(138), [54, 185]);
  assert.deepEqual(ends(296), [89, 220]);
  assert.deepEqual(ends(880), [220, 352]);
  assert.deepEqual(ends(1180), [288, 419]);
  assert.deepEqual(ends(2500), [429, 561]);
});

test('a dynamic list preserves its scroll range when the rail shares space with navigation', () => {
  const { trackLeft, trackRight, maximum, thumbLeft, thumbRight } = horizontalScrollbarGeometry(238, 309, 0, 123);
  assert.deepEqual([trackLeft, trackRight, maximum, thumbLeft, thumbRight], [23, 100, 71, 23, 82]);
  assert.equal(horizontalScrollbarGeometry(238, 309, maximum, 123).thumbRight, 100);
});

test('a very wide grid preserves the minimum thumb at either end', () => {
  const minimum = offset => horizontalScrollbarGeometry(164, 9704, offset);
  const initial = minimum(0), end = minimum(9540);
  assert.deepEqual([initial.thumbLeft, initial.thumbRight, end.thumbLeft, end.thumbRight], [23, 31, 133, 141]);
  assert.equal(end.maximum, 9540);
});

test('arrow and track steps align the next column at the respective viewport edge', () => {
  const advance = (position, direction) => scrollTableByColumn(columns, viewport, position, direction);
  assert.equal(advance(0, -1), 0);
  assert.equal(advance(0, 1), 138);
  assert.equal(advance(138, 1), 296);
  assert.equal(advance(137.6, 1), 296);
  assert.equal(advance(1809, -1), 1180);
  assert.equal(advance(891, -1), 880);
  assert.equal(advance(880, -1), 722);
  assert.equal(advance(1809, 1), 1809);
});
