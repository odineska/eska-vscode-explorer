import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonBorderShade, buttonBorderTail, buttonBorderPaint } from '../webview/forms/button-border.mjs';
const fixture = name => readFile(new URL(`../../eska/tests/fixtures/forms/native-button-borders/${name}.json`,import.meta.url),'utf8').then(JSON.parse);

test('button border colors match 384 native exported blend results',async () => {
  const oracle = await fixture('color-vectors');
  assert.equal(oracle.rows.length,384);
  for (const row of oracle.rows) {
    assert.deepEqual(buttonBorderShade(row.input),row.lower);
    assert.deepEqual(buttonBorderPaint({height:26,background:row.input,outside:[255,255,255],primary:true}).top,row.primaryTop);
  }
});

test('button lower scanlines match 3402 independent Pixman samples',async () => {
  const oracle = await fixture('gradient-vectors');
  assert.equal(oracle.rows.length,1134);
  for (const row of oracle.rows) assert.deepEqual(buttonBorderTail(row.height,row.top),row.lastRows,`${row.height}:${row.top}`);
});

test('all corners and straight edge colors match 153 native buttons',async () => {
  const oracle = await fixture('metrics');
  for (const form of oracle.rows) for (const button of form.buttons) {
    const background = button.background.slice(1).match(/../g).map(value => parseInt(value,16));
    const paint = buttonBorderPaint({height:button.height,background,outside:button.outside,primary:button.primary});
    assert.deepEqual(paint.top,button.topBorder,form.name+' top');
    assert.deepEqual(paint.bottom,button.bottomBorder,form.name+' bottom');
    assert.deepEqual(paint.shadow,button.shadow,form.name+' shadow');
    assert.deepEqual(paint.corners,button.corners,form.name+' corners');
  }
});

test('button border rejects invalid colors and unbounded raster heights',() => {
  for (const top of [null,[],[0,1],[256,0,0],[0,-1,0],[0,0,.5],[NaN,0,0]]) assert.throws(() => buttonBorderShade(top),/button-border-color/);
  for (const height of [0,6,4097,26.5,NaN,Infinity]) assert.throws(() => buttonBorderTail(height,[178,178,178]),/button-border-height/);
});
