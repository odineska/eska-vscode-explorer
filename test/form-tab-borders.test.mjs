import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tabBackground,tabCornerPixels} from '../webview/forms/tab-border.mjs';
const fixture=JSON.parse(await readFile(new URL('../../eska/tests/fixtures/forms/native-tab-borders/metrics.json',import.meta.url)));

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
