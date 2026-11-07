const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  async function geometry(ui) {
    return ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),uniform:!!document.querySelector('.taxi-items--usual-buttons'),buttons:[...document.querySelectorAll('[data-kind=Button]>.taxi-button')].map(button=>({...rect(button),caption:button.getAttribute('aria-label'),font:getComputedStyle(button).fontSize,weight:getComputedStyle(button).fontWeight}))};})()`);
  }
  async function sample(ui,expected,label,targetId) {
    let actual;
    try {
      await until(async () => {
        actual = await geometry(ui);
        return actual.uniform && actual.buttons.length === 3 && actual.buttons.every((button,index) => button.width === expected.buttons[index].width);
      },'usual buttons share their native automatic width');
    } catch (error) {
      if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`usual-buttons-failure-${vscode.env.language}.json`),JSON.stringify({label,actual,expected},null,2));
      throw error;
    }
    await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    actual = await geometry(ui);
    assert.deepEqual([actual.frame.width,actual.frame.height],expected.nativeFrame,label+' frame');
    for(const [index,button] of actual.buttons.entries()) {
      const target = expected.buttons[index];
      assert.deepEqual([button.x-actual.frame.x,button.y-actual.frame.y,button.width,button.height],[target.x,target.y,target.width,target.height],label+' '+target.name);
      assert.equal(button.caption,target.caption);
      assert.equal(button.weight,'400');
    }
    const file = `usual-buttons-${label}-${vscode.env.language}.png`;
    if(targetId)await ui.captureTarget(targetId,file);else await ui.screenshot(file);
    return {label,expected:expected.name,...actual};
  }
  for(const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    await until(()=>vscode.window.activeTextEditor?.document===document,'usual button XML active');
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>sameSourcePath(view.path,form.path)&&view.phase==='ready'),'usual button form ready');
    const view=[...explorer.formPreview.views.values()].find(view=>sameSourcePath(view.path,form.path)),panel=view.frames.get('main');let ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    results.push(await sample(ui,form.expected,form.kind));
    if(form.kind==='WidthShort') {
      const original=document.getText(),others=fixture.formGallery.filter(item=>['WidthLong','WidthMixed'].includes(item.kind));
      const change=async(text,target,expected)=>{const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty usual button revision');};
      await ui.evaluate("globalThis.__usualButton=document.querySelector('[data-kind=Button]>.taxi-button');globalThis.__usualRow=document.querySelector('.taxi-items--usual-buttons')");
      for(const other of others){await change(await fs.readFile(other.path,'utf8'),ui,other.expected);results.push(await sample(ui,other.expected,'dirty-'+other.kind));}await change(original,ui,form.expected);await sample(ui,form.expected,'restored-'+form.kind);
      assert.equal(await ui.evaluate("globalThis.__usualButton===document.querySelector('[data-kind=Button]>.taxi-button')&&globalThis.__usualRow===document.querySelector('.taxi-items--usual-buttons')"),true);
      await explorer.formPreview.receive(view,panel,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'usual button floating view');const detached=view.frames.get('preview'),floating=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}}),owner=await floating.nativeWindow({detached:true});
      results.push(await sample(floating,form.expected,'floating-'+form.kind,owner.targetId));
      await floating.evaluate("globalThis.__usualButton=document.querySelector('[data-kind=Button]>.taxi-button')");
      for(const other of others){await change(await fs.readFile(other.path,'utf8'),floating,other.expected);results.push(await sample(floating,other.expected,'floating-dirty-'+other.kind,owner.targetId));}await change(original,floating,form.expected);await sample(floating,form.expected,'floating-restored-'+form.kind,owner.targetId);
      assert.equal(await floating.evaluate("globalThis.__usualButton===document.querySelector('[data-kind=Button]>.taxi-button')"),true);
      floating.close();detached.panel.dispose();await until(async()=>!(await ui.targets()).some(item=>item.targetId===owner.targetId),'usual floating native window closed');ui.close();ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});results.push(await sample(ui,form.expected,'reattached-'+form.kind));
    }
    assert.deepEqual(await fs.readFile(form.path),before);ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'usual button session released');await Promise.all([...explorer.formPreview.closing]);
  }
  await explorer.shutdown();const report={passed:true,locale:vscode.env.language,forms:fixture.formGallery.length,buttons:fixture.formGallery.length*3,automaticUniformWidth:true,explicitNonStretch:true,mixedFontAlignment:true,dirtyCaption:true,dirtyFont:true,detachedUpdates:true,sourceWritesDuringViewing:false,pixelParityVerified:false,wholeFormVisualParity:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`usual-buttons-measured-${vscode.env.language}.json`),JSON.stringify(report));await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
