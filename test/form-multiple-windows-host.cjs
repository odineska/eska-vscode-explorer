const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');
exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=explorer.formPreview;
  async function open(file){
    const before=await fs.readFile(file),document=await vscode.workspace.openTextDocument(vscode.Uri.file(file));await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    await until(()=>vscode.window.activeTextEditor?.document.uri.fsPath===file,'XML active in the main editor');
    await vscode.commands.executeCommand('eska.explorer.previewForm');await until(()=>[...service.views.values()].some(view=>view.path===file&&view.phase==='ready'),'independent form ready');
    const view=[...service.views.values()].find(view=>view.path===file),main=view.frames.get('main');
    await until(()=>main.ready,'main form panel ready');const mainUi=await frame({state:{title:main.panel.title}});
    await until(()=>mainUi.evaluate("document.querySelectorAll('.taxi-input').length===1"),'main form controls ready');
    await mainUi.focusWorkbench();mainUi.close();
    await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'independent floating panel ready');
    const preview=view.frames.get('preview'),ui=await frame({detached:true,state:{title:preview.panel.title}});
    await until(()=>ui.evaluate("document.querySelectorAll('.taxi-input').length===1"),'independent input ready');
    const target=await ui.nativeWindow({detached:true});assert.equal(target.url,'about:blank');
    return {file,before,document,view,main,preview,ui,target,session:view.client.current.formSessionId};
  }
  const first=await open(fixture.form.path);await first.ui.focusWorkbench();const second=await open(fixture.form.second);
  assert.equal(service.views.size,2);assert.notEqual(first.session,second.session);assert.notEqual(first.target.targetId,second.target.targetId);
  assert.equal((await first.ui.targets()).filter(target=>target.type==='page'&&target.url==='about:blank').length,2,'two distinct native preview windows');
  async function label(item){return item.ui.evaluate("document.querySelector('.taxi-field-label').textContent.replace(/:$/, '')");}
  async function rename(item,value){
    const previous=await label(item),source=item.document.getText(),from='<v8:content>'+previous+'</v8:content>',offset=source.indexOf(from);assert.ok(offset>=0);
    const edit=new vscode.WorkspaceEdit();edit.replace(item.document.uri,new vscode.Range(item.document.positionAt(offset),item.document.positionAt(offset+from.length)),'<v8:content>'+value+'</v8:content>');
    assert.equal(await vscode.workspace.applyEdit(edit),true);await until(async()=>await label(item)===value,'own dirty caption rendered');
  }
  const initialSecond=await label(second);await rename(first,'First window');assert.equal(await label(second),initialSecond);
  await rename(second,'Second window');assert.equal(await label(first),'First window');
  await first.ui.evaluate("document.querySelector('.taxi-input').click()");await until(()=>first.view.selected?.key?.value==='2','first selection');
  await second.ui.evaluate("document.querySelector('.taxi-input').click()");await until(()=>second.view.selected?.key?.value==='2','second selection');
  assert.equal(first.view.selected.key.value,second.view.selected.key.value);assert.notEqual(first.view.selected.source,second.view.selected.source,'equal local XML IDs have distinct source identities');
  await first.ui.evaluate("document.querySelectorAll('.taxi-pages [role=tab]')[1].click()");
  await until(()=>first.ui.evaluate("document.querySelectorAll('.taxi-pages [role=tab]')[1].getAttribute('aria-selected')==='true'"),'first page navigation');
  assert.equal(await second.ui.evaluate("document.querySelectorAll('.taxi-pages [role=tab]')[0].getAttribute('aria-selected')"),'true','second page remains independent');
  second.main.panel.reveal(undefined,false);await service.receive(first.view,first.main,{type:'detach'});
  assert.equal((await first.ui.nativeWindow({detached:true})).targetId,first.target.targetId);assert.equal((await second.ui.nativeWindow({detached:true})).targetId,second.target.targetId);
  assert.equal(first.view.client.current.formSessionId,first.session);assert.equal(second.view.client.current.formSessionId,second.session);
  await first.ui.captureTarget(first.target.targetId,'form-multiple-windows-first-'+vscode.env.language+'.png');
  await second.ui.captureTarget(second.target.targetId,'form-multiple-windows-second-'+vscode.env.language+'.png');
  first.main.panel.dispose();await until(()=>first.view.frames.size===1,'first preview survives its main panel');await rename(first,'First survives');
  assert.equal(await label(second),'Second window');first.ui.close();first.preview.panel.dispose();
  await until(()=>service.views.size===1,'only first session released');await Promise.all([...service.closing]);
  await until(async()=>!(await second.ui.targets()).some(target=>target.targetId===first.target.targetId),'first native window closed');
  await assert.rejects(()=>explorer.connection.request(second.view.tree.session.sessionId,'form/get',{projectId:second.view.entry.project.info.projectId,generation:second.view.entry.project.info.generation,formSessionId:first.session}),error=>error.details?.reason==='unknown_form_session');
  await rename(second,'Second survives');assert.equal((await second.ui.nativeWindow({detached:true})).targetId,second.target.targetId);assert.equal(service.views.size,1);
  second.main.panel.dispose();await until(()=>second.view.frames.size===1,'second preview survives its main panel');second.ui.close();second.preview.panel.dispose();
  await until(()=>service.views.size===0,'all sessions released');await Promise.all([...service.closing]);
  assert.ok(first.document.isDirty&&second.document.isDirty,'view disposal retains both dirty documents');
  for(const item of [first,second])assert.deepEqual(await fs.readFile(item.file),item.before,'viewing never writes source');
  await explorer.shutdown();
  const report={passed:true,locale:vscode.env.language,multipleNativeWindows:true,exactFrameOwnership:true,independentSessions:true,independentDirtyUpdates:true,equalLocalIds:true,independentSelection:true,independentPageNavigation:true,repeatedFocus:true,independentClose:true,dirtyDocumentsRetained:true,sourceWritesDuringViewing:false};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,'multiple-windows-measured-'+vscode.env.language+'.json'),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
