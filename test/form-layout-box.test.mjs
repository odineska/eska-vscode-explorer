import { test } from 'node:test';
import assert from 'node:assert/strict';
import { borderBoxSize, boundingScale } from '../webview/forms/layout-box.mjs';
const styles = new WeakMap();
globalThis.getComputedStyle = element => styles.get(element);
function element(css, rectangle) {
  const node = { getBoundingClientRect: () => rectangle };
  styles.set(node, { boxSizing:'border-box',paddingLeft:'0px',paddingRight:'0px',paddingTop:'0px',paddingBottom:'0px',borderLeftWidth:'0px',borderRightWidth:'0px',borderTopWidth:'0px',borderBottomWidth:'0px',...css });
  return node;
}
test('border-box allocation is independent of DOMRect zoom conventions',()=>{
  for (const scale of [1,1.25,2]) {
    const node=element({width:'250px',height:'40px'},{width:250*scale,height:40*scale});
    assert.deepEqual(borderBoxSize(node),{width:250,height:40});assert.equal(boundingScale(node),scale);
  }
});
test('content-box dimensions include padding and borders once',()=>{
  const node=element({boxSizing:'content-box',width:'245px',height:'126px',borderLeftWidth:'2px',borderRightWidth:'2px',borderTopWidth:'2px',borderBottomWidth:'2px'},{width:249,height:130});
  assert.deepEqual(borderBoxSize(node),{width:249,height:130});assert.equal(boundingScale(node),1);
  styles.set(node,{...styles.get(node),paddingLeft:'5px',paddingRight:'7px',paddingTop:'2px',paddingBottom:'3px'});
  assert.deepEqual(borderBoxSize(node),{width:261,height:135});
});
test('fractional CSS allocations are retained and unresolved inline boxes fall back to their rectangle',()=>{
  assert.deepEqual(borderBoxSize(element({width:'321.328125px',height:'70.5px'},{width:1,height:1})),{width:321.328125,height:70.5});
  assert.deepEqual(borderBoxSize(element({width:'auto',height:'auto'},{width:91,height:23})),{width:91,height:23});
  assert.deepEqual(borderBoxSize(element({width:'auto',height:'auto'},{width:113.75,height:28.75}),1.25),{width:91,height:23});
});
