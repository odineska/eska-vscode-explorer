const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), form = fixture.form;
  const before = await Promise.all([fs.readFile(form.path),fs.readFile(form.style)]);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document,{preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'native style form');
  const view = [...explorer.formPreview.views.values()].find(view=>view.path===form.path), panel=view.frames.get('main');
  const ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
  async function rendered(points,color,target=ui) {
    return target.evaluate(`(() => {const input=document.querySelector('.taxi-input input');if(!input)return false;
      const s=getComputedStyle(input),label=document.querySelectorAll('.taxi-field-label')[1],l=label&&getComputedStyle(label);
      return Math.abs(parseFloat(s.fontSize)-${points*4/3})<.001&&s.fontWeight==='700'&&s.fontStyle==='italic'&&s.color===${JSON.stringify(color)}
        &&Math.abs(parseFloat(l?.fontSize)-40/3)<.001&&l.fontWeight==='700'&&l.color===${JSON.stringify(color)};})()`);
  }
  await until(()=>rendered(18,'rgb(152, 0, 255)'),'selected style data applied in installed VSIX');
  assert.ok(view.snapshot.dependencies.some(dependency=>JSON.stringify(dependency.path).includes('Style.xml')));
  await ui.screenshot(`style-body-baseline-${vscode.env.language}.png`);
  await ui.evaluate("globalThis.__styledInput=document.querySelector('.taxi-input')");
  const style=await vscode.workspace.openTextDocument(vscode.Uri.file(form.style)),original=style.getText();
  async function change(text) {
    const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();
    edit.replace(style.uri,new vscode.Range(style.positionAt(0),style.positionAt(style.getText().length)),text);
    assert.equal(await vscode.workspace.applyEdit(edit),true);
    await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty style revision');
  }
  await change(original.replace('#9800FF','#008000').replace('height="18"','height="20"'));
  await until(()=>rendered(20,'rgb(0, 128, 0)'),'dirty style color and font');
  assert.equal(await ui.evaluate("globalThis.__styledInput===document.querySelector('.taxi-input')"),true);
  await change(original);
  await until(()=>rendered(18,'rgb(152, 0, 255)'),'main style recovered');
  await explorer.formPreview.receive(view,panel,{type:'detach'});
  await until(()=>view.frames.get('preview')?.ready,'style preview detached');
  const detached=view.frames.get('preview'),floating=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
  await until(()=>rendered(18,'rgb(152, 0, 255)',floating),'style in detached window');
  await floating.evaluate("globalThis.__styledInput=document.querySelector('.taxi-input')");
  await change(original.replace('#9800FF','#008000').replace('height="18"','height="20"'));
  await until(()=>rendered(20,'rgb(0, 128, 0)',floating),'dirty style synchronized to detached window');
  assert.equal(await floating.evaluate("globalThis.__styledInput===document.querySelector('.taxi-input')"),true);
  const edit=new vscode.WorkspaceEdit();edit.replace(style.uri,new vscode.Range(style.positionAt(0),style.positionAt(style.getText().length)),'<Style>');
  assert.equal(await vscode.workspace.applyEdit(edit),true);
  await until(()=>view.phase==='stale'&&!view.running&&!view.timer,'incomplete style retains last valid form');
  assert.equal(await rendered(20,'rgb(0, 128, 0)',floating),true);
  await change(original);
  await until(()=>rendered(18,'rgb(152, 0, 255)',floating),'detached style recovered');
  assert.equal(await floating.evaluate("globalThis.__styledInput===document.querySelector('.taxi-input')"),true);
  assert.equal(style.isDirty,true);
  assert.deepEqual(await Promise.all([fs.readFile(form.path),fs.readFile(form.style)]),before);
  floating.close();detached.panel.dispose();ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'style view released');
  await Promise.all([...explorer.formPreview.closing]);await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,
    nativeStyleBody:true,dirtyStyleFontAndColor:true,partialTitleFont:true,invalidStyleLastValid:true,detachedStyleUpdates:true,sourceWritesDuringViewing:false}));
};
