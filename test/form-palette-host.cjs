const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),results=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  for(const form of fixture.formGallery){
    const before=await fs.readFile(form.path);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'palette form ready');
    const view=[...explorer.formPreview.views.values()].find(view=>view.path===form.path),panel=view.frames.get('main'),ui=await frame({state:{title:panel.panel.title}});
    await until(async()=>await ui.evaluate("!!document.querySelector('.taxi-form-frame')"),'palette DOM');await ui.evaluate('document.fonts.ready.then(()=>true)');
    const actual=await ui.evaluate(`(()=>{const color=selector=>{const node=document.querySelector(selector);return node&&getComputedStyle(node).color};const r=document.querySelector('.taxi-form-frame').getBoundingClientRect();return {title:color('.taxi-field-label'),value:color('.taxi-input input'),button:color('.taxi-button'),frame:{width:r.width,height:r.height}}})()`);
    if(process.platform==='linux'){
      if(form.kind==='Field'){assert.equal(actual.title,'rgb(77, 77, 77)');assert.equal(actual.value,'rgb(51, 51, 51)')}
      if(form.kind==='Button')assert.equal(actual.button,'rgb(77, 77, 77)');
    }
    await ui.screenshot(`palette-${form.kind}-${vscode.env.language}.png`);results.push({kind:form.kind,...actual});
    assert.deepEqual(await fs.readFile(form.path),before);ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'palette session released');await Promise.all([...explorer.formPreview.closing]);
  }
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,colorRolesOnly:true,visualParityVerified:false,locale:vscode.env.language,sourceWritesDuringViewing:false,results}));
};
