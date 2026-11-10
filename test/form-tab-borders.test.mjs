import {formReferenceRoot} from './form-references.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sideTabCornerPixels,tabBackground,tabCornerPixels} from '../webview/forms/tab-border.mjs';
import {inactiveTabTextColor} from '../webview/forms/choice-colors.mjs';
const fixture=JSON.parse(await readFile(new URL('tests/fixtures/forms/native-tab-borders/metrics.json',formReferenceRoot)));

test('native active and inactive tab fills include explicit colors and inherited backdrops',()=>{
  let tabs=0;
  for(const form of fixture.forms)for(const state of form.states)for(const tab of state.tabs){
    assert.deepEqual(tabBackground(tab.ownBackground,tab.active),tab.background,form.name+' '+state.selected+' '+tab.name);tabs++;
  }
  assert.equal(tabs,105);
});
test('all native tab corner pixels match at different fonts, fills and adjacent selections',()=>{
  let pixels=0;
  for(const form of fixture.forms)for(const state of form.states)for(const [index,tab] of state.tabs.entries()){
    const corners=tabCornerPixels({outside:state.outside,background:tab.background,pageBackground:state.pageBackground,active:tab.active,previous:state.tabs[index-1],next:state.tabs[index+1]});
    for(const [name,colors] of Object.entries(corners)){
      assert.equal(Buffer.from(colors.flat()).toString('hex'),tab.regions[name].rgb,form.name+' '+state.selected+' '+tab.name+' '+name);pixels+=colors.length;
    }
  }
  assert.equal(pixels,4620);
});

test('native side tabs composite the shared row and join to the selected page',()=>{
  const outside=[189,219,67], background=[165,92,126], next={background:[0,74,225],active:false};
  const current={outside,background,active:true,next};
  const left=sideTabCornerPixels({...current,side:'left'}), right=sideTabCornerPixels({...current,side:'right'});
  assert.deepEqual(left.outerTop[6],[177,163,123]);
  assert.deepEqual(right.outerTop[5],[177,162,122]);
  assert.deepEqual(left.outerBottom.slice(-4),[[187,213,80],[179,181,172],[179,179,179],[179,179,179]]);
  assert.deepEqual(left.joinTop,[[179,179,179],[178,169,173]]);
  assert.deepEqual(left.joinBottom,[[157,166,185],[179,179,179]]);
  const selected=sideTabCornerPixels({...current,side:'right',active:false,background:[149,76,110],
    next:{active:true,background:[10,90,241]}});
  assert.deepEqual(selected.joinBottom,[[158,168,187],[179,179,179]]);
});

test('disabled side tabs use the native highlight stroke and title tint',()=>{
  const outside=[189,219,67], background=[165,92,126];
  const corners=sideTabCornerPixels({side:'left',outside,background,active:true,disabled:true});
  assert.deepEqual(corners.outerTop.slice(0,4),[outside,[251,251,251],[251,251,251],[251,251,251]]);
  assert.deepEqual(corners.joinTop,[[251,251,251],[241,232,236]]);
  assert.deepEqual(inactiveTabTextColor([51,51,51],outside),[135,135,135]);
  assert.deepEqual(inactiveTabTextColor([51,51,51],[189,220,67]),[136,136,136]);
  assert.deepEqual(inactiveTabTextColor([171,20,40],background),[168,57,71]);
  assert.deepEqual(inactiveTabTextColor([38,204,239],[0,74,225]),[18,195,232]);
});
