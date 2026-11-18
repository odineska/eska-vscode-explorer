const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame, sameSourcePath } = require('./webview-host.cjs');
async function replace(document,text){const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);}
exports.run=async()=>{
 const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),forms=fixture.formGallery,before=await Promise.all(forms.map(f=>fs.readFile(f.path))),results=[];
 const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 for(const form of forms){
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),original=document.getText();await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>[...service.views.values()].some(v=>sameSourcePath(v.path,form.path)&&v.phase==='ready'),'standard pictures model');const view=[...service.views.values()].find(v=>sameSourcePath(v.path,form.path)),main=view.frames.get('main');let ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
  async function sample(expected,label) {
   const selector='[data-kind=PictureDecoration] [data-native-picture=vector]';
   await ui.evaluate("document.querySelector('.taxi-form-title').click()");
   await until(()=>view.selected?.key.kind==='root','picture reference root selected');
   for(const zoom of [75,125,100]){
    await ui.evaluate(`(()=>{const select=document.querySelector('.form-zoom select');select.value='${zoom}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    let sampleState;
    await until(async()=>{
     sampleState=await ui.evaluate(`({zoom:document.querySelector('.taxi-preview')?.style.zoom,select:document.querySelector('.form-zoom select')?.value,dpr:devicePixelRatio,pictures:[...document.querySelectorAll(${JSON.stringify(selector)})].map(image=>{
      const rect=image.getBoundingClientRect();
      return {width:rect.width,height:rect.height,slotWidth:image.offsetWidth,slotHeight:image.offsetHeight,source:image.currentSrc.split(',')[0],naturalWidth:image.naturalWidth,complete:image.complete};
     })})`);
     const {pictures}=sampleState;
     // Older Chromium reports descendant DOMRects in logical CSS pixels under an ancestor's zoom.
     return Number(sampleState.zoom)===zoom/100&&pictures.length===expected.pictures.length
      &&pictures.every(image=>image.complete&&image.naturalWidth===16&&image.slotWidth===16&&image.slotHeight===16
       &&image.width===image.height&&[16,16*zoom/100].includes(image.width));
    },'loaded standard vectors at '+zoom+'%').catch(error => {
     throw new Error(error.message + ' ' + JSON.stringify({expectedCount:expected.pictures.length, ...sampleState}), {cause:error});
    });
    const {pictures}=sampleState;
    assert.ok(pictures.every(image=>image.source === 'data:image/svg+xml'));
    results.push({label,zoom,pictures:pictures.length});
   }
   assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);
   assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);

  }
  await sample(form.expected,form.kind);
  if(form.kind==='White'){
   await ui.evaluate("document.querySelector('[data-kind=PictureDecoration]').click();globalThis.__standardPicture=document.querySelector('[data-kind=PictureDecoration] [data-native-picture=vector]')");await until(()=>view.selected?.key.value==='100','picture identity selected');const identity=view.selected;
   const change=async text=>{await replace(document,text);await until(()=>view.phase==='ready'&&!view.running&&!view.timer&&view.snapshot.dependencies.some(d=>d.role==='form'&&d.version===String(document.version)),'dirty picture revision');assert.deepEqual(view.selected,identity);assert.equal(await ui.evaluate("globalThis.__standardPicture===document.querySelector('[data-kind=PictureDecoration] [data-native-picture=vector]')"),true);};
   const restoreSelection=async()=>{await ui.evaluate("document.querySelector('[data-kind=PictureDecoration]').click()");await until(()=>view.selected?.key.value==='100','picture selection restored');};
   const black=forms.find(f=>f.kind==='Black'),red=forms.find(f=>f.kind==='Red');await change(await fs.readFile(black.path,'utf8'));await sample(black.expected,'dirty-Black');await restoreSelection();await change(original);await sample(form.expected,'restored-White');await restoreSelection();await ui.focusWorkbench();ui.close();await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'picture preview detached');const floating=view.frames.get('preview');ui=await frame({detached:true,fixedFormArea:true,state:{title:floating.panel.title}});await until(()=>ui.evaluate("!!document.querySelector('[data-kind=PictureDecoration] [data-native-picture=vector]')"),'floating picture DOM');await ui.evaluate("globalThis.__standardPicture=document.querySelector('[data-kind=PictureDecoration] [data-native-picture=vector]')");await sample(form.expected,'floating-White');await restoreSelection();await change(await fs.readFile(red.path,'utf8'));await sample(red.expected,'floating-dirty-Red');await restoreSelection();await change(original);await sample(form.expected,'floating-restored-White');ui.close();floating.panel.dispose();await until(()=>!view.frames.has('preview'),'picture preview reattached');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});await sample(form.expected,'reattached-White');assert.equal(document.isDirty,true);
  }
  await ui.focusWorkbench();ui.close();main.panel.dispose();await until(()=>service.views.size===0,'standard picture session closed');await Promise.all([...service.closing]);
 }
 assert.deepEqual(await Promise.all(forms.map(f=>fs.readFile(f.path))),before);await explorer.shutdown();
 await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,results,dirtyMattes:true,stablePictureDom:true,selectedIdentityPreserved:true,detachedUpdates:true,sourceWritesDuringViewing:false,wholeFormVisualParity:false}));
};
