import {formReferenceRoot} from './form-references.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonBorderShade, buttonBorderTail, buttonBorderPaint } from '../webview/forms/button-border.mjs';
const fixture = name => readFile(new URL(`tests/fixtures/forms/native-button-borders/${name}.json`,formReferenceRoot),'utf8').then(JSON.parse);

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

test('button border follows native Cairo raster coordinates in the table toolbar profile', () => {
  // Cairo 1.17.6 from the 8.3.27.2342 Linux stand. Samples cover the
  // two toolbar poses, odd/even heights, colored edges and device offsets.
  const samples = [
    [26, [178, 178, 178], [274, 0, 51], [[173, 173, 173], [164, 164, 164], [155, 155, 155]]],
    [26, [178, 178, 178], [274, 279, 51], [[173, 173, 173], [164, 164, 164], [155, 155, 155]]],
    [26, [178, 178, 178], [274, 397, 51], [[174, 174, 174], [165, 165, 165], [155, 155, 155]]],
    [26, [178, 178, 178], [274, 414, 51], [[174, 174, 174], [165, 165, 165], [156, 156, 156]]],
    [26, [178, 178, 178], [274, 453, 51], [[174, 174, 174], [165, 165, 165], [156, 156, 156]]],
    [26, [178, 178, 178], [274, 549, 51], [[174, 174, 174], [165, 165, 165], [156, 156, 156]]],
    [25, [255, 0, 1], [274, 279, 51], [[249, 0, 1], [236, 0, 1], [223, 0, 0]]],
    [25, [54, 55, 56], [274, 279, 51], [[53, 54, 55], [50, 51, 52], [47, 48, 49]]],
    [27, [147, 148, 149], [274, 549, 51], [[143, 144, 145], [136, 136, 137], [129, 129, 130]]],
    [18, [201, 202, 203], [274, 712, 51], [[196, 197, 198], [186, 187, 188], [176, 176, 177]]],
    [68, [213, 214, 215], [274, 1024, 51], [[208, 209, 209], [197, 198, 198], [186, 187, 187]]],
    [57, [177, 178, 179], [274, 453, 51], [[172, 173, 174], [163, 164, 165], [154, 155, 156]]],
    [34, [78, 79, 80], [274, 0, 51], [[76, 77, 78], [72, 73, 74], [68, 69, 70]]],
    [26, [178, 178, 178], [79, 202, 50], [[173, 173, 173], [164, 164, 164], [155, 155, 155]]],
    [26, [178, 178, 178], [181, 548, 115], [[174, 174, 174], [165, 165, 165], [156, 156, 156]]],
  ];
  for (const [height,top,[x,y,width],tail] of samples) {
    assert.deepEqual(buttonBorderTail(height,top,{x,y,width}),tail,`${x},${y} ${width}x${height}`);
  }
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
