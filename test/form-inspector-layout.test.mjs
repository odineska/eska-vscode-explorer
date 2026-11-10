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

test('available webview width selects compact or stacked tracks without horizontal overflow', () => {
  for (const width of [180, 320, 428, 474]) {
    const compact = inspectorLayout(size(width, 500), ui);
    assert.equal(compact.mode, 'compactStacked');
    assert.equal(compact.tracks, 'minmax(0, 1fr)');
  }
  for (const width of [475, 500, 650, 739]) {
    const compact = inspectorLayout(size(width, 500), ui);
    const tracks = compact.tracks.split(' ').map(parseFloat);
    assert.equal(compact.mode, 'compact');
    assert.equal(tracks.length, 3);
    assert.equal(tracks.reduce((sum, value) => sum + value, 0), width);
    assert.ok(compact.right >= compact.rightMinimum && compact.right <= compact.rightMaximum);
  }
  assert.equal(inspectorLayout(size(740, 500), ui).mode, 'columns');
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


test('detached inspectors fill the space after actual toolbar and status without reserving preview or splitter', () => {
  for (const [width, height, toolbar, status] of [[1000,700,34,23],[420,360,59,36],[420,180,90,50]]) {
    const result = inspectorLayout(size(width,height,toolbar,status), ui, true);
    assert.equal(result.height, Math.max(84,height-toolbar-status));
    assert.equal(result.mode, 'columns');
    const tracks = result.tracks.split(' ').map(parseFloat);
    assert.equal(tracks.length, 5);
    assert.equal(tracks.reduce((sum, value) => sum + value, 0), Math.max(width, 504));
    assert.deepEqual(ui, { upper:230,left:40,right:65 });
  }
});

test('dock restores the saved split and clamps it only for the current available height', () => {
  const normal=inspectorLayout(size(1000,700),ui);
  inspectorLayout(size(1000,700),ui,true);
  inspectorLayout(size(420,320,59,36),ui,true);
  assert.equal(inspectorLayout(size(420,320,59,36),ui).height,124);
  assert.deepEqual(inspectorLayout(size(1000,700),ui),normal);
  assert.deepEqual(ui, { upper:230,left:40,right:65 });
});
