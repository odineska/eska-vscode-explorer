import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inputBorderPixels,disabledInputForeground} from '../webview/forms/input-border.mjs';
import {calculatorRects,calculatorFill} from '../webview/forms/input-calculator.mjs';
import {FORM_NS,inputChoiceButton,fieldWidth,inputHeight} from '../webview/forms/model.mjs';

const fixture=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-input-borders/metrics.json',import.meta.url)));
const node=field=>({kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,valueType:field.type}});

test('input palette and all 6228 corner pixels match forty-eight native forms',()=>{
  let pixels=0,fields=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const value=inputBorderPixels(field.border,field.background,field.outside,field);
    assert.deepEqual(value.border,field.actualBorder,form.name+' '+field.name+' border');
    assert.deepEqual(value.background,field.actualBackground,form.name+' '+field.name+' background');
    for(const [index,name] of ['topLeft','topRight','bottomLeft','bottomRight'].entries()){
      assert.equal(Buffer.from(value.corners[index].flat()).toString('hex'),field.cornersRgb[name],form.name+' '+field.name+' '+name);pixels+=9;
    }
    fields++;
  }
  assert.equal(fields,173);assert.equal(pixels,6228);
});

test('automatic and explicit numeric choices keep native logical sizes in each state',()=>{
  for(const form of fixture.forms)for(const field of form.fields){
    const value=node(field);
    assert.equal(inputChoiceButton(value,'linux'),field.choice,form.name+' '+field.name+' choice');
    assert.equal(fieldWidth(value,'linux'),field.logicalWidth,form.name+' '+field.name+' width');
    assert.equal(inputHeight(value),field.rect[3],form.name+' '+field.name+' height');
  }
});

test('calculator button interiors include native inactive marks, separators and corner pixels',()=>{
  let pixels=0,buttons=0;
  for(const form of fixture.forms)for(const field of form.fields){
    if(field.button?.kind!=='calculator')continue;
    const palette=inputBorderPixels(field.border,field.background,field.outside,field),height=field.rect[3],width=field.rect[2];
    const image=Buffer.alloc(20*(height-2)*3,255),left=width-22,top=1,markTop=Math.round((height-13)/2);
    const set=(x,y,color)=>{if(x>=0&&x<20&&y>=0&&y<height-2)image.set(color,(y*20+x)*3);};
    for(let y=0;y<height-2;y++)set(0,y,field.inactive?[215,215,215]:field.border);
    for(const [x,y,w,h,source] of calculatorRects){
      const color=calculatorFill(source,field.inactive).slice(1).match(/../g).map(v=>parseInt(v,16));
      for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)set(6+x+dx,markTop-top+y+dy,color);
    }
    for(const [index,[x,y]] of [[0,0],[width-3,0],[0,height-3],[width-3,height-3]].entries()){
      for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)set(x+dx-left,y+dy-top,palette.corners[index][dy*3+dx]);
    }
    assert.equal(createHash('sha256').update(image).digest('hex'),field.button.rgbSha256,form.name+' '+field.name);
    pixels+=20*(height-2);buttons++;
  }
  assert.equal(buttons,56);assert.equal(pixels,23760);
});

test('disabled numeric text matches nineteen measured foregrounds independently of the parent fill',()=>{
  let fields=0;
  for(const form of fixture.forms)for(const field of form.fields)if(field.actualForeground){
    assert.deepEqual(disabledInputForeground(field.background),field.actualForeground,form.name);fields++;
  }
  assert.equal(fields,19);
});
