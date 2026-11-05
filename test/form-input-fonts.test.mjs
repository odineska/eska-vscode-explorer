import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FORM_NS,fieldWidth,inputHeight,inputRowHeight} from '../webview/forms/model.mjs';
const fixture=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-input-fonts/metrics.json',formReferenceRoot)));
test('line allocations match thirty-four native font cases, including thirteen independent normal sizes',()=>{
  let fields=0,independent=0;
  for(const form of fixture.forms)for(const field of form.fields){
    const node={kind:'InputField',properties:Object.entries(field.properties).map(([name,text])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text}})),presentation:{font:field.font,titleFont:{points:10,weight:400},titleLocation:'Left',valueType:field.type}},label=form.name+' '+field.name;
    assert.equal(inputHeight(node,'linux'),field.rect[3],label);
    assert.equal(fieldWidth(node,'linux'),field.logicalWidth,label);
    assert.equal(inputRowHeight(node,'linux'),form.fields[1].rect[1]-form.fields[0].rect[1]-7,label+' row stride');
    if(form.independentValidation)independent++;fields++;
  }
  assert.equal(fields,136);assert.equal(independent,52);
});

test('small calculator raster variants match native RGB samples before SVG rendering',async()=>{
  const {calculatorImage}=await import('../webview/forms/input-calculator.mjs');
  const {createHash}=await import('node:crypto');
  const reference=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-input-fonts/calculator-images.json',formReferenceRoot)));
  for(const sample of reference.images){
    const drawing=calculatorImage(sample.size+2,sample.inactive),rgb=Buffer.alloc(sample.size*sample.size*3,255);
    assert.equal(drawing.width,sample.size);assert.equal(drawing.height,sample.size);
    for(const [x,y,w,h,fill]of drawing.rects){const color=fill.slice(1).match(/../g).map(v=>parseInt(v,16));for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)rgb.set(color,((y+dy)*sample.size+x+dx)*3);}
    assert.equal(createHash('sha256').update(rgb).digest('hex'),sample.rgbSha256,sample.name);
  }
  assert.equal(reference.images.length,5);
});
