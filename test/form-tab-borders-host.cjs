const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame, sameSourcePath, selectedFormPixels } = require('./webview-host.cjs');

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),gallery=fixture.tabBorders,results=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  async function ready(ui,expected){return ui.evaluate(`(() => {const tabs=[...document.querySelectorAll('.taxi-tabs>[role=tab]')];return tabs.length===${expected.tabs.length}&&!document.querySelector('[data-native-label=pending]')&&${JSON.stringify(expected.tabs)}.every((tab,index)=>tabs[index].dataset.nativeTabBorder==='ready'&&tabs[index].getAttribute('aria-selected')===String(tab.active)&&getComputedStyle(tabs[index]).backgroundColor==='rgb('+tab.background.join(', ')+')'&&(!tab.foreground||getComputedStyle(tabs[index]).color==='rgb('+tab.foreground.join(', ')+')'));})()`);}
  async function sample(ui,expected,label,targetId){
    await until(()=>ready(ui,expected),'native tab colors and glyphs');await ui.evaluate('document.fonts.ready.then(()=>true)');
    await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const geometry=await ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {frame:rect(document.querySelector('.taxi-form-frame')),panel:rect(document.querySelector('.taxi-page[aria-hidden=false]')),tabs:[...document.querySelectorAll('.taxi-tabs>[role=tab]')].map(rect),inputs:[...document.querySelectorAll('.taxi-input')].filter(node=>getComputedStyle(node).visibility!=='hidden').map(rect)};})()`),regions=[];
    const addRegions=(owner,measured)=>{
      for(const [name,r] of Object.entries(measured)){
        const [x,y,width,height]=r.rect;
        regions.push({name:owner+' '+name,x,y,width,height,hex:r.rgb,sha:r.rgbSha256});
      }
    };
    assert.deepEqual([geometry.frame.width,geometry.frame.height],expected.frame,label+' form allocation');
    if(expected.panel){
      const {x,y,width,height}=geometry.panel;
      assert.deepEqual([x-geometry.frame.x,y-geometry.frame.y,width,height],expected.panel.rect,label+' page panel geometry');
      addRegions('page panel',expected.panel.regions);
    }
    if(expected.automaticInputMaximum){const input=geometry.inputs[0];assert.deepEqual([input.x-geometry.frame.x,input.y-geometry.frame.y,input.width,input.height],expected.automaticInputMaximum.rect,label+' native automatic string maximum');}
    for(const [index,tab] of geometry.tabs.entries()){
      const native=expected.tabs[index],x=tab.x-geometry.frame.x,y=tab.y-geometry.frame.y;
      assert.deepEqual([x,y,tab.width,tab.height],native.rect,label+' '+native.name+' geometry');
      addRegions(native.name,native.regions);
      if(native.wholeTabRgbSha256)regions.push({name:native.name+' whole',x,y,width:tab.width,height:tab.height,sha:native.wholeTabRgbSha256});
    }
    if(expected.wholeFormWithShadowRgbSha256)regions.push({name:'whole form and shadow',x:0,y:0,width:expected.frame[0]+4,height:expected.frame[1]+4,sha:expected.wholeFormWithShadowRgbSha256});
    let actual,captureAttempts=0;
    await until(async()=>{
      captureAttempts++;
      const filename=`tab-borders-${label}-${vscode.env.language}.png`,png=targetId?await ui.captureTarget(targetId,filename,true):await ui.screenshot(filename,true);
      actual=await selectedFormPixels(ui,png,expected.frame,regions);
      return Array.isArray(actual);
    },'selected tab frame painted');
    // Retry only an unpainted selection frame; an actual RGB mismatch fails immediately.
    const mismatches=actual.flatMap((r,i)=>{const e=regions[i];return(e.hex?r.hex!==e.hex:r.sha!==e.sha)?[{actual:r,expected:e}]:[];});
    if(mismatches.length&&process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`tab-borders-failure-${vscode.env.language}.json`),JSON.stringify({label,mismatches,geometry},null,2));
    assert.deepEqual(mismatches,[],label+' native tab pixels');
    return {name:label,geometry,captureAttempts,cornerPixelsCompared:regions.filter(r=>r.hex).reduce((v,r)=>v+r.width*r.height,0),wholeTabPixelsCompared:regions.filter(r=>r.name.endsWith(' whole')).reduce((v,r)=>v+r.width*r.height,0),wholeFormPixelsCompared:regions.filter(r=>r.name==='whole form and shadow').reduce((v,r)=>v+r.width*r.height,0),differentRgbPixels:0};
  }
  for(const form of gallery.forms){
    const before=await fs.readFile(form.path),document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>sameSourcePath(view.path,form.path)&&view.phase==='ready'),'tab border form');
    const view=[...explorer.formPreview.views.values()].find(view=>sameSourcePath(view.path,form.path)),panel=view.frames.get('main');let ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    for(const expected of form.expected.states){
      await until(()=>ui.evaluate(`document.querySelectorAll('.taxi-tabs>[role=tab]').length===${expected.tabs.length}`),'tab nodes');
      await ui.evaluate(`document.querySelectorAll('.taxi-tabs>[role=tab]')[${expected.selected}].click();document.querySelector('.taxi-form-title').click()`);
      await until(()=>view.selected?.key?.kind==='root','root selection after page navigation');
      results.push(await sample(ui,expected,form.kind+'-'+expected.selected));
    }
    if(form.kind==='ColorFreshA'){
      const original=document.getText(),other=gallery.forms.find(f=>f.kind==='ColorFreshB'),changed=await fs.readFile(other.path,'utf8'),own=form.expected.states[1],target=other.expected.states[1];
      const change=async(text)=>{const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty tab revision');};
      const remember="globalThis.__tabButton=document.querySelector('.taxi-tabs>[role=tab]');globalThis.__tabCorner=document.querySelector('.taxi-tab-corner')",retained="globalThis.__tabButton===document.querySelector('.taxi-tabs>[role=tab]')&&globalThis.__tabCorner===document.querySelector('.taxi-tab-corner')";
      await ui.evaluate(remember);await change(changed);results.push(await sample(ui,target,'dirty-FreshB'));await change(original);await until(()=>ready(ui,own),'tab inputs restored');assert.equal(await ui.evaluate(retained),true);
      await explorer.formPreview.receive(view,panel,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'tab preview detached');const detached=view.frames.get('preview'),floating=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
      const workbench=await floating.nativeWindow({detached:true});assert.equal(workbench.url,'about:blank');
      await until(()=>ready(floating,own),'floating keeps active page with root selected');
      results.push(await sample(floating,own,'floating-FreshA',workbench.targetId));await floating.evaluate(remember);await change(changed);results.push(await sample(floating,target,'floating-dirty-FreshB',workbench.targetId));await change(original);await until(()=>ready(floating,own),'floating tab inputs restored');assert.equal(await floating.evaluate(retained),true);
      floating.close();detached.panel.dispose();ui.close();ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});results.push(await sample(ui,own,'reattached-FreshA'));
    }
    assert.deepEqual(await fs.readFile(form.path),before);ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'tab session released');await Promise.all([...explorer.formPreview.closing]);
  }
  await explorer.shutdown();
  const states=gallery.forms.flatMap(form=>form.expected.states),dirtyPalette=gallery.forms.some(form=>form.kind==='ColorFreshA');
  const report={passed:true,locale:vscode.env.language,tabBorders:true,forms:gallery.forms.length,nativeStates:states.length,
    nativeTabs:states.reduce((total,state)=>total+state.tabs.length,0),dirtyPalette,detachedPixels:dirtyPalette,
    localNavigationStateHandoffVerified:dirtyPalette,sourceWritesDuringViewing:false,wholeFormVisualParity:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`tab-borders-measured-${vscode.env.language}.json`),JSON.stringify(report));await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
