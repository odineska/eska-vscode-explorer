import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,fieldStyle,inputHeight} from '../webview/forms/model.mjs';
import {inputBorderPixels} from '../webview/forms/input-border.mjs';
import {calculatorRects} from '../webview/forms/input-calculator.mjs';

const fixture=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-input-dimensions/metrics.json',formReferenceRoot)));
const node=field=>({kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,valueType:field.type}});

test('explicit input widths and conflicting non-stretching bounds match forty native forms',()=>{
  let fields=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const input=node(field),style=fieldStyle(input,'linux'),label=form.name+' '+field.name;
    assert.equal(fieldWidth(input,'linux'),field.logicalWidth,label);
    assert.equal(style.width,field.logicalWidth+'px',label);
    assert.equal(style['min-width'],undefined,label);assert.equal(style['max-width'],undefined,label);
    assert.equal(inputHeight(input,'linux'),field.rect[3],label);fields++;
  }
  assert.equal(fields,160);
});

test('fixed width calculator interiors match native clipping at five value fonts',()=>{
  let buttons=0;
  for(const form of fixture.forms)for(const field of form.fields){
    if(!field.button)continue;
    const height=field.rect[3],width=field.rect[2],left=width-22,top=1,image=Buffer.alloc(20*(height-2)*3,255);
    const set=(x,y,color)=>{if(x>=0&&x<20&&y>=0&&y<height-2)image.set(color,(y*20+x)*3);};
    for(let y=0;y<height-2;y++)set(0,y,field.border);
    for(const [x,y,w,h,source] of calculatorRects){
      const color=source.slice(1).match(/../g).map(v=>parseInt(v,16));
      for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)set(6+x+dx,Math.round((height-13)/2)-top+y+dy,color);
    }
    const palette=inputBorderPixels(field.border,field.background,field.outside,field);
    for(const [index,[x,y]] of [[0,0],[width-3,0],[0,height-3],[width-3,height-3]].entries()){
      for(let dy=0;dy<3;dy++)for(let dx=0;dx<3;dx++)set(x+dx-left,y+dy-top,palette.corners[index][dy*3+dx]);
    }
    assert.equal(createHash('sha256').update(image).digest('hex'),field.button.rgbSha256,form.name);buttons++;
  }
  assert.equal(buttons,40);
});
