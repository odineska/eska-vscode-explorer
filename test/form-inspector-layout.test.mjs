import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectorLayout } from '../webview/forms/inspector-layout.mjs';

const ui = Object.freeze({ upper: 230, left: 40, right: 65 });
const size = (width, height, toolbar = 34, status = 23) => ({ width, height, toolbar, status });

test('a normal window preserves the existing inspector geometry and preferences', () => {
  const result = inspectorLayout(size(1000, 700), ui);
  assert.equal(result.height, 230);
  assert.equal(result.tracks, '396px 4px 246px 4px 350px');
  assert.equal(result.left, 40); assert.equal(result.right, 65);
  assert.deepEqual(ui, { upper: 230, left: 40, right: 65 });
});

test('short windows reserve preview space and account for wrapped toolbar/status height', () => {
  const compact = inspectorLayout(size(420, 320, 59, 36), ui);
  assert.equal(compact.height, 124);
  assert.equal(320 - compact.height - 59 - 36 - 5, 96);
  const tiny = inspectorLayout(size(420, 180, 59, 36), ui);
  assert.equal(tiny.height, 84); assert.equal(tiny.maximumHeight, 84);
  assert.ok(tiny.height + 59 + 36 + 5 + 96 > 180, 'an impossible fit uses shell scrolling');
});

test('narrow widths keep every inspector reachable through its own scroll area', () => {
  for (const width of [0, 180, 320, 428, 500, 1000]) {
    const result = inspectorLayout(size(width, 500), ui);
    const tracks = result.tracks.split(' ').map(parseFloat);
    assert.ok(tracks[0] >= 120); assert.ok(tracks[2] >= 120); assert.ok(tracks[4] >= 180);
    assert.equal(tracks.reduce((sum, value) => sum + value, 0), result.width);
    assert.ok(result.left >= result.leftMinimum && result.left <= result.leftMaximum);
    assert.ok(result.right >= result.rightMinimum && result.right <= result.rightMaximum);
  }
});

test('shrink, grow and return do not overwrite locally saved dimensions', () => {
  const before = inspectorLayout(size(1000, 700), ui);
  inspectorLayout(size(250, 180, 90, 50), ui);
  inspectorLayout(size(1500, 950), ui);
  assert.deepEqual(inspectorLayout(size(1000, 700), ui), before);
  assert.deepEqual(ui, { upper: 230, left: 40, right: 65 });
});

test('outdated or extreme preferences cannot create negative or overlapping tracks', () => {
  for (const preferences of [{}, { upper: -100, left: 90, right: 10 },
    { upper: 10000, left: -100, right: 200 }, { upper: NaN, left: Infinity, right: NaN }]) {
    const result = inspectorLayout(size(600, 420), preferences);
    assert.ok(result.height >= 84 && result.height <= result.maximumHeight);
    assert.ok(!result.tracks.includes('NaN') && !result.tracks.includes('Infinity'));
    assert.ok(result.tracks.split(' ').every(value => parseFloat(value) > 0));
  }
});
