const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');

function named(node,name){return node.name===name?node:node.children.map(child=>named(child,name)).find(Boolean);}
async function replace(document,from,to){
  const text=document.getText();assert.ok(text.includes(from));const edit=new vscode.WorkspaceEdit();
  edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(text.length)),text.replaceAll(from,to));
  assert.equal(await vscode.workspace.applyEdit(edit),true);
}
exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),files=fixture.formComposition;
  const before=await Promise.all(files.sources.map(file=>fs.readFile(file)));
  const firstOriginal=await fs.readFile(files.members.first.configuration,'utf8');
  const extension=vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer');
  const explorer=await extension.activate();await vscode.commands.executeCommand('eska.explorer.connect');
  assert.equal(explorer.connection.state.kind,'ready',JSON.stringify(explorer.connection.state));
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const base=await vscode.workspace.openTextDocument(vscode.Uri.file(files.path));await vscode.window.showTextDocument(base,{preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>service.views.size===1&&[...service.views.values()][0].phase==='ready','composed form opens');
  const view=[...service.views.values()][0],main=view.frames.get('main');let ui=await frame({state:{title:main.panel.title}});
  const identity=named(view.snapshot.model.root,'Caption').identity;
  const results=[];
  const expected=id=>files.cases.find(row=>row.id===id).expected.captionsInOrder.filter(row=>row.name!=='Group').map(row=>row.title);
  const rendered=()=>ui.evaluate("[...document.querySelectorAll('[data-kind=LabelDecoration] .taxi-label')].map(node=>node.textContent)");
  async function observe(){await ui.evaluate("globalThis.__compositionCaption=document.querySelector('.taxi-label');window.addEventListener('message',event=>{if(event.data.type==='state')globalThis.__compositionSequence=event.data.sequence})");}
  async function check(caseId,label,previous){
    await until(async()=>view.phase==='ready'&&!view.running&&!view.timer&&(previous===undefined||view.snapshot.revision!==previous)&&JSON.stringify(await rendered())===JSON.stringify(expected(caseId)),label);
    if(previous!==undefined)await until(async()=>await ui.evaluate('globalThis.__compositionSequence')===view.sequence,label+' latest publication');
    assert.deepEqual(named(view.snapshot.model.root,'Caption').identity,identity,label+' identity');
    const f=named(view.snapshot.model.root,'F_Inserted'),s=named(view.snapshot.model.root,'S_Inserted');
    assert.equal(f.identity.key.value,s.identity.key.value);assert.notEqual(f.identity.source,s.identity.source);
    assert.equal(named(view.snapshot.model.root,'Caption').presentation.font.points,14);
    assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.taxi-label')).color"),'rgb(0, 0, 255)');
    results.push({label,expectedCase:caseId,captions:await rendered(),independentLocalIds:true});
  }
  await check('second-addon','initial-addon');await observe();
  await ui.evaluate("document.querySelector('.taxi-label').click()");await until(()=>view.selected?.key.value===identity.key.value,'caption selection');
  const second=await vscode.workspace.openTextDocument(vscode.Uri.file(files.members.second.configuration));
  let revision=view.snapshot.revision;
  await replace(second,'>AddOn<','>Customization<');await check('both-reversed','dirty-customization',revision);
  assert.deepEqual(view.selected,identity);
  revision=view.snapshot.revision;
  await fs.writeFile(files.members.first.configuration,firstOriginal.replace('>Customization<','>Patch<'));
  await check('first-patch','external-patch-with-dirty-second',revision);
  revision=view.snapshot.revision;
  await fs.writeFile(files.members.first.configuration,firstOriginal.replace('>Customization<','>AddOn<'));
  await check('first-addon','external-addon-with-dirty-second',revision);
  const good=second.getText();await replace(second,'>Customization<','><');
  await until(()=>view.phase==='stale','invalid purpose retains last good form');
  assert.deepEqual(await rendered(),expected('first-addon'));assert.deepEqual(view.selected,identity);
  results.push({label:'invalid-purpose',lastGoodModelRetained:true});
  await replace(second,second.getText(),good);await until(()=>view.phase==='ready'&&!view.running&&!view.timer,'purpose recovers');
  revision=view.snapshot.revision;await fs.writeFile(files.members.first.configuration,firstOriginal);
  await check('both-reversed','external-configuration-restored',revision);
  assert.equal(await ui.evaluate("globalThis.__compositionCaption===document.querySelector('.taxi-label')"),true);
  await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'composition detached');
  ui.close();const detached=view.frames.get('preview');ui=await frame({state:{title:detached.panel.title}});
  await until(async()=>JSON.stringify(await rendered())===JSON.stringify(expected('both-reversed')),'detached model visible');await observe();
  revision=view.snapshot.revision;await replace(second,'>Customization<','>AddOn<');
  await check('second-addon','detached-dirty-addon',revision);
  revision=view.snapshot.revision;await replace(second,'<ConfigurationExtensionPurpose>AddOn</ConfigurationExtensionPurpose>','');
  await check('purpose-default','detached-dirty-default-purpose',revision);
  assert.equal(await ui.evaluate("globalThis.__compositionCaption===document.querySelector('.taxi-label')"),true);
  assert.deepEqual(view.selected,identity);assert.equal(second.isDirty,true);
  await ui.screenshot(`form-composition-${vscode.env.language}.png`);
  ui.close();detached.panel.dispose();await until(()=>!view.frames.has('preview'),'composition reattached');
  ui=await frame({state:{title:view.frames.get('main').panel.title}});await until(async()=>JSON.stringify(await rendered())===JSON.stringify(expected('purpose-default')),'reattached model visible');
  assert.deepEqual(view.selected,identity);assert.equal(second.isDirty,true);
  results.push({label:'reattached-default-purpose',dirtyPreserved:true});
  assert.deepEqual(await Promise.all(files.sources.map(file=>fs.readFile(file))),before);
  ui.close();await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formComposition:true,locale:vscode.env.language,results,stableIdentity:true,stableDom:true,detachedUpdates:true,invalidPurposeRecovery:true,sourceWritesDuringViewing:false}));
};
