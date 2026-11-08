const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {frame,until,editFormSource,allocateFormViewport}=require('./webview-host.cjs');

const read=`(() => {
  const root=document.querySelector('.taxi-form-frame'),body=root?.querySelector('.taxi-form-content'),bar=root?.querySelector('.taxi-root-commands');
  if(!bar)return null;
  const origin=root.getBoundingClientRect(),r=bar.getBoundingClientRect(),input=root.querySelector('.taxi-input').getBoundingClientRect();
  const button=bar.querySelector('button'),b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
  return {bar:[r.x-origin.x,r.y-origin.y,r.width,r.height],firstInputY:input.y-origin.y,
    scrollTop:body.scrollTop,maxScroll:body.scrollHeight-body.clientHeight,buttonHit:hit===button||button.contains(hit),
    sameOwners:!globalThis.__scrollOwners||__scrollOwners.every(e=>e.isConnected)};
})()`;

async function settled(ui) {
  let sample,previous,stable=0;
  await until(async()=>{
    sample=await ui.evaluate(read);const next=JSON.stringify(sample);stable=next===previous?stable+1:0;previous=next;
    return sample&&stable>=3;
  },'stable body scroll');
  return sample;
}

async function check(ui,view,selected,label,results) {
  await allocateFormViewport(ui,[800,300]);
  await ui.evaluate("document.querySelector('.taxi-form-content').scrollTop=0;globalThis.__scrollOwners=[...document.querySelectorAll('.taxi-input'),document.querySelector('.taxi-root-commands')];true");
  const before=await settled(ui),snapshot=view.snapshot;
  assert.ok(before.maxScroll>0,label+' scrolls the body');
  assert.equal(before.bar[1],29,label+' preserves the original command inset');
  await ui.evaluate("(()=>{const body=document.querySelector('.taxi-form-content');body.scrollTop=Math.min(80,body.scrollHeight-body.clientHeight);return true})()");
  const after=await settled(ui);
  assert.ok(after.scrollTop>0);
  assert.equal(after.bar[1],before.bar[1],label+' keeps root commands in place');
  assert.equal(after.firstInputY,before.firstInputY-after.scrollTop,label+' moves form content');
  assert.equal(after.buttonHit,true,label+' keeps commands hit-testable');
  assert.equal(after.sameOwners,true);assert.deepEqual(view.selected,selected);assert.equal(view.snapshot,snapshot);
  assert.deepEqual(ui.scriptErrors(),[]);results.push({name:label+'-scrolled',before,after});
  await ui.parkPointer();await ui.screenshot(label+'-scrolled.png');
  await allocateFormViewport(ui,[900,380]);
  const resized=await settled(ui);
  assert.equal(resized.bar[1],before.bar[1],label+' keeps commands after resize');
  assert.equal(resized.buttonHit,true);assert.equal(resized.sameOwners,true);
  assert.deepEqual(view.selected,selected);assert.equal(view.snapshot,snapshot);
  results.push({name:label+'-resized',...resized});
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),form=fixture.formGallery[0],disk=await fs.readFile(form.path);
  if(process.platform!=='linux'){await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,profileApplicable:false,profile:'linux-native-scroll',results:[]}));return;}
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));await vscode.window.showTextDocument(doc,{preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>[...service.views.values()].find(v=>v.path===form.path)?.phase==='ready','body form ready');
  const view=[...service.views.values()].find(v=>v.path===form.path),main=view.frames.get('main'),ui=await frame({state:{title:main.panel.title}});
  const source=doc.getText(),bar='<AutoCommandBar name="FormCommandBar" id="-1"/>';
  const declared='<AutoCommandBar name="FormCommandBar" id="-1"><Autofill>false</Autofill><ChildItems><Button name="PinnedCommand" id="500"><CommandName>Form.StandardCommand.Close</CommandName><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Команда панели</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Panel command</v8:content></v8:item></Title></Button></ChildItems></AutoCommandBar>';
  assert.equal(source.split(bar).length,2);const results=[];
  const style=await ui.evaluate("document.querySelector('.preview-scroll').style.cssText");
  try {
    await editFormSource(doc,view,source.replace('<CommandBarLocation>None</CommandBarLocation>','<CommandBarLocation>Auto</CommandBarLocation>').replace(bar,declared));
    const selected=[...view.nodes.values()].find(n=>n.name==='Code').identity;
    await service.receive(view,main,{type:'select',identity:selected});
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await check(ui,view,selected,'main',results);
    const workbench=await ui.nativeWindow();await service.receive(view,main,{type:'detach'});
    await until(()=>view.frames.get('preview')?.ready,'body detached');
    const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
    try {
      assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
      await check(floating,view,selected,'detached',results);
    } finally {
      try {await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'body docked');}
      finally {floating.close();}
    }
    assert.deepEqual(await fs.readFile(form.path),disk);
  } catch(error) {
    await ui.screenshot('body-scroll-failure.png').catch(()=>{});throw error;
  } finally {
    await editFormSource(doc,view,source);await ui.evaluate('document.querySelector(\'.preview-scroll\').style.cssText='+JSON.stringify(style));
    ui.close();main.panel.dispose();await until(()=>service.views.size===0,'body view released');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,sourceWrites:false,fullNativeProfileAccepted:false,results}));
};
