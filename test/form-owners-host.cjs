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
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),files=fixture.formOwners;
  const before=await Promise.all(files.sources.map(file=>fs.readFile(file))),results=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  assert.equal(explorer.connection.state.kind,'ready',JSON.stringify(explorer.connection.state));
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');const service=explorer.formPreview;
  let view,main,ui,document;
  const rendered=()=>ui.evaluate("[...document.querySelectorAll('[data-kind=LabelDecoration] .taxi-label')].map(node=>node.textContent)");
  for(const row of files.cases){
    const file=path.join(files.members[row.selectedMember].source,row.payload);
    document=await vscode.workspace.openTextDocument(vscode.Uri.file(file));await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    await until(()=>vscode.window.activeTextEditor?.document.uri.fsPath===file,'owner XML active');
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...service.views.values()].some(item=>item.path===file&&item.phase==='ready'),'owner form ready');
    view=[...service.views.values()].find(item=>item.path===file);main=view.frames.get('main');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
    const expected=row.expected.captions.filter(value=>value!=='Group');
    await until(async()=>JSON.stringify(await rendered())===JSON.stringify(expected),row.id+' captions');
    const dependencies=Object.fromEntries(view.snapshot.dependencies.filter(input=>input.role==='form').map(input=>[input.id,input.member]));
    assert.equal(dependencies[named(view.snapshot.model.root,'Caption').identity.source],row.expected.layers[0]);
    results.push({label:row.id,captions:await rendered(),ownerSource:row.expected.layers[0]});
    if(row.id!=='extension-own-object'){
      ui.close();main.panel.dispose();await until(()=>service.views.size===0,'owner session released');await Promise.all([...service.closing]);
    }
  }
  const identity=named(view.snapshot.model.root,'Caption').identity;
  await ui.evaluate("globalThis.__ownerCaption=document.querySelector('.taxi-label');document.querySelector('.taxi-label').click()");
  await until(()=>view.selected?.key.value===identity.key.value,'own caption selected');
  const metadata=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(files.members.first.source,'Catalogs','F_OwnCatalog.xml')));
  const original=metadata.getText();
  await replace(metadata,'<Name>F_OwnCatalog</Name>','<ObjectBelonging>Adopted</ObjectBelonging><Name>F_OwnCatalog</Name>');
  await until(()=>view.phase==='stale','invalid own owner rejected');
  assert.equal((await rendered())[0],'First own object');assert.deepEqual(view.selected,identity);
  results.push({label:'dirty-invalid-owner',lastGoodModelRetained:true});
  await replace(metadata,metadata.getText(),original.replace('<Name>F_OwnCatalog</Name>','<ObjectBelonging xmlns="urn:vendor">Adopted</ObjectBelonging><Name>F_OwnCatalog</Name>'));
  await until(()=>view.phase==='ready'&&!view.running&&!view.timer,'foreign metadata recovers');
  assert.equal(await ui.evaluate("globalThis.__ownerCaption===document.querySelector('.taxi-label')"),true);
  results.push({label:'foreign-owner-property',nativeOwnershipUnaffected:true});
  await replace(metadata,metadata.getText(),original);await until(()=>view.phase==='ready'&&!view.running&&!view.timer,'native own owner restored');
  await replace(document,'First own object','Dirty own object');await until(async()=>(await rendered())[0]==='Dirty own object','own form dirty updates');
  results.push({label:'dirty-own-form',stableIdentity:true});
  await ui.focusWorkbench();ui.close();await service.receive(view,main,{type:'detach'});
  await until(()=>view.frames.get('preview')?.ready,'own form detached');const detached=view.frames.get('preview');ui=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
  await until(async()=>(await rendered())[0]==='Dirty own object','detached own form visible');assert.equal((await ui.nativeWindow({detached:true})).url,'about:blank');
  await ui.evaluate("globalThis.__ownerCaption=document.querySelector('.taxi-label')");
  await replace(document,'Dirty own object','Floating own object');await until(async()=>(await rendered())[0]==='Floating own object','detached own dirty updates');
  assert.deepEqual(named(view.snapshot.model.root,'Caption').identity,identity);assert.deepEqual(view.selected,identity);
  results.push({label:'detached-dirty-own-form',nativeWindow:true});
  await replace(metadata,'<Name>F_OwnCatalog</Name>','<ObjectBelonging>Adopted</ObjectBelonging><Name>F_OwnCatalog</Name>');
  await until(()=>view.phase==='stale','detached owner invalid');assert.equal((await rendered())[0],'Floating own object');
  await replace(metadata,metadata.getText(),original);await until(()=>view.phase==='ready'&&!view.running&&!view.timer,'detached own owner recovers');
  assert.equal(await ui.evaluate("globalThis.__ownerCaption===document.querySelector('.taxi-label')"),true);
  results.push({label:'detached-invalid-owner-recovery',stableDom:true});
  await ui.screenshot(`form-owners-${vscode.env.language}.png`);ui.close();detached.panel.dispose();await until(()=>!view.frames.has('preview'),'own form reattached');
  ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});await until(async()=>(await rendered())[0]==='Floating own object','reattached own caption');
  assert.deepEqual(view.selected,identity);assert.ok(metadata.isDirty&&document.isDirty);results.push({label:'reattached-own-form',dirtyRetained:true});
  assert.deepEqual(await Promise.all(files.sources.map(file=>fs.readFile(file))),before);
  ui.close();await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formOwners:true,locale:vscode.env.language,results,sourceWritesDuringViewing:false,loadedBorrowingValidation:true,fullNativeApplicabilityAccepted:false}));
};
