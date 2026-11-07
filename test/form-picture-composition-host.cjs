const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame, sameSourcePath } = require('./webview-host.cjs');
function named(node,name){return node.name===name?node:node.children.map(child=>named(child,name)).find(Boolean);}
async function replace(document,text){
  const original=document.getText(),edit=new vscode.WorkspaceEdit();
  edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(original.length)),text);
  assert.equal(await vscode.workspace.applyEdit(edit),true);
}
exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),files=fixture.pictureComposition,results=[];
  const before=await Promise.all(files.sources.map(file=>fs.readFile(file))),firstImage=await fs.readFile(files.firstImage,'utf8');
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();await vscode.commands.executeCommand('eska.explorer.connect');
  assert.equal(explorer.connection.state.kind,'ready',JSON.stringify(explorer.connection.state));await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');const service=explorer.formPreview;
  let view,main,ui,identity,own=false;
  const rendered=()=>ui.evaluate(`(()=>[...document.querySelectorAll('[data-kind=PictureDecoration]')].map(node=>{const image=node.querySelector('img');if(!image)return null;if(!image.complete||image.naturalWidth!==16||image.naturalHeight!==16)return 'loading';const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const context=canvas.getContext('2d');context.drawImage(image,0,0);return '#'+[...context.getImageData(8,8,1,1).data].slice(0,3).map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase()}))()`);
  const dependency=document=>view.snapshot.dependencies.find(input=>input.root.encoding==='utf-8'&&input.path.encoding==='utf-8'&&sameSourcePath(path.join(input.root.value,input.path.value),document.uri.fsPath));
  async function check(color,label,document,previous,ownColor='#FFCC00'){
    const colors=own?[color,ownColor]:[color];
    await until(async()=>view.phase==='ready'&&!view.running&&!view.timer&&(previous===undefined||view.snapshot.revision!==previous)&&(!document||dependency(document)?.version===String(document.version))&&JSON.stringify(await rendered())===JSON.stringify(colors),label);
    const node=named(view.snapshot.model.root,'Logo');assert.deepEqual(node.identity,identity);assert.equal(node.presentation.picture===null,color===null);
    assert.equal(view.snapshot.model.assets.length,colors.filter(Boolean).length);assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);
    assert.deepEqual(view.selected,identity);assert.equal(await ui.evaluate("globalThis.__pictureContainer===document.querySelector('[data-kind=PictureDecoration]')"),true);
    results.push({label,colors,assets:view.snapshot.model.assets.length});
  }
  async function open(file){
    const document=await vscode.workspace.openTextDocument(vscode.Uri.file(file));await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    await until(()=>vscode.window.activeTextEditor?.document.uri.fsPath===file,'picture XML active');await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...service.views.values()].some(item=>sameSourcePath(item.path,file)&&item.phase==='ready'),'picture composition ready');view=[...service.views.values()].find(item=>sameSourcePath(item.path,file));main=view.frames.get('main');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});identity=named(view.snapshot.model.root,'Logo').identity;
    await until(()=>ui.evaluate("!!document.querySelector('[data-kind=PictureDecoration] img')"),'picture DOM ready');await ui.evaluate("globalThis.__pictureContainer=document.querySelector('[data-kind=PictureDecoration]');globalThis.__pictureContainer.click()");await until(()=>view.selected?.key.value===identity.key.value,'picture selected');
  }
  await open(files.baseForm);await check('#00AA00','initial-borrowed-image');
  const descriptor=await vscode.workspace.openTextDocument(vscode.Uri.file(files.secondDescriptor));
  await replace(descriptor,files.extendedDescriptor);await check(null,'dirty-extended-clear',descriptor);
  const foreign=files.extendedDescriptor.replace('<xr:State>Extended</xr:State>','<wrong:State xmlns:wrong="urn:other">Extended</wrong:State>');
  await replace(descriptor,foreign);await check('#00AA00','foreign-property-state-keeps-inheritance',descriptor);
  await replace(descriptor,files.extendedDescriptor);await check(null,'dirty-extended-restored',descriptor);
  await replace(descriptor,'<broken');await until(()=>view.phase==='stale','invalid picture metadata retains model');assert.deepEqual(await rendered(),[null]);results.push({label:'invalid-metadata',lastGoodModelRetained:true});
  await replace(descriptor,files.borrowedDescriptor);await check('#00AA00','dirty-metadata-recovers',descriptor);
  await ui.focusWorkbench();ui.close();await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'pictures detached');const detached=view.frames.get('preview');ui=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});assert.equal((await ui.nativeWindow({detached:true})).url,'about:blank');await until(()=>ui.evaluate("!!document.querySelector('[data-kind=PictureDecoration]')"),'floating picture DOM');await ui.evaluate("globalThis.__pictureContainer=document.querySelector('[data-kind=PictureDecoration]')");
  await replace(descriptor,files.extendedDescriptor);await check(null,'detached-dirty-clear',descriptor);
  let revision=view.snapshot.revision;await fs.writeFile(files.firstImage,firstImage.replace('#00AA00','#8844CC'));await check(null,'external-image-shadowed-by-clear',descriptor,revision);
  await replace(descriptor,files.borrowedDescriptor);await check('#8844CC','detached-inherited-external-image',descriptor);
  revision=view.snapshot.revision;await fs.writeFile(files.firstImage,firstImage);await check('#00AA00','external-image-restored',descriptor,revision);
  await fs.mkdir(path.dirname(files.secondPayload),{recursive:true});await fs.writeFile(files.secondPayload,Buffer.alloc(0));await fs.writeFile(files.secondPictureXml,files.emptyDescription);await replace(descriptor,files.extendedDescriptor);await check(null,'native-zero-byte-payload',descriptor);
  const emptyDependency=view.snapshot.dependencies.find(input=>input.role==='picture'&&input.path.value.endsWith('Picture.zip'));assert.equal(emptyDependency.snapshot,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const pictureXml=await vscode.workspace.openTextDocument(vscode.Uri.file(files.secondPictureXml));await replace(pictureXml,'<ExtPicture xmlns="http://v8.1c.ru/8.3/xcf/extrnprops"><Picture/></ExtPicture>');await check(null,'dirty-empty-picture-property',pictureXml);
  await fs.writeFile(files.secondSvg,Buffer.from(files.secondImage,'base64'));await replace(pictureXml,files.secondDescription);await check('#2050EE','dirty-payload-image-selected',pictureXml);await ui.screenshot(`form-picture-composition-${vscode.env.language}.png`);
  ui.close();detached.panel.dispose();await until(()=>!view.frames.has('preview'),'pictures reattached');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});await until(()=>ui.evaluate("!!document.querySelector('[data-kind=PictureDecoration] img')"),'reattached picture');await ui.evaluate("globalThis.__pictureContainer=document.querySelector('[data-kind=PictureDecoration]')");await check('#2050EE','reattached-image');
  await ui.focusWorkbench();ui.close();main.panel.dispose();await until(()=>service.views.size===0,'base picture session released');await Promise.all([...service.closing]);
  own=true;await open(files.ownForm);await check('#2050EE','own-form-global-picture-and-own-resource');
  await replace(pictureXml,'<ExtPicture xmlns="http://v8.1c.ru/8.3/xcf/extrnprops"><Picture/></ExtPicture>');await check(null,'own-form-cleared-global-picture',pictureXml);
  await replace(pictureXml,files.secondDescription);await check('#2050EE','own-form-global-picture-recovered',pictureXml);
  const ownExt=path.join(files.members.first.source,'CommonPictures','F_OwnIcon','Ext'),ownBackup=ownExt+'-external-backup';
  revision=view.snapshot.revision;await fs.rename(ownExt,ownBackup);await check('#2050EE','external-own-empty-definition',undefined,revision,null);
  revision=view.snapshot.revision;await fs.rename(ownBackup,ownExt);await check('#2050EE','external-own-image-restored',undefined,revision);
  assert.ok(descriptor.isDirty&&pictureXml.isDirty);ui.close();main.panel.dispose();await until(()=>service.views.size===0,'own picture session released');await Promise.all([...service.closing]);await explorer.shutdown();
  await fs.rm(path.dirname(files.secondPictureXml),{recursive:true,maxRetries:process.platform==='win32'?20:0,retryDelay:250});assert.deepEqual(await Promise.all(files.sources.map(file=>fs.readFile(file))),before);
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,pictureComposition:true,locale:vscode.env.language,results,sourceWritesDuringViewing:false,controlledExternalChangesRestored:true,stableIdentity:true,stableDom:true,detachedUpdates:true,nativeEmptyPayload:true}));
};
