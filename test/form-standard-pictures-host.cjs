const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const pictureSelector = '[data-kind=PictureDecoration] :is([data-native-picture=vector], [data-native-picture=raster])';
const {until,frame, sameSourcePath } = require('./webview-host.cjs');
async function replace(document,text){const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);}
exports.run=async()=>{
 const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),forms=fixture.formGallery,before=await Promise.all(forms.map(f=>fs.readFile(f.path))),results=[];
 const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 for(const form of forms){
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),original=document.getText();await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>[...service.views.values()].some(v=>sameSourcePath(v.path,form.path)&&v.phase==='ready'),'standard pictures model');const view=[...service.views.values()].find(v=>sameSourcePath(v.path,form.path)),main=view.frames.get('main');let ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
  async function sample(expected,label) {
   await ui.evaluate("document.querySelector('.taxi-form-title').click()");
   await until(()=>view.selected?.key.kind==='root','picture reference root selected');
   for(const zoom of [75,125,100]){
    await ui.evaluate(`(()=>{const select=document.querySelector('.form-zoom select');select.value='${zoom}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    let sampleState;
    await until(async()=>{
     sampleState=await ui.evaluate(`({zoom:document.querySelector('.taxi-preview')?.style.zoom,select:document.querySelector('.form-zoom select')?.value,dpr:devicePixelRatio,root:document.getElementById('form-preview-script')?.dataset.pictureRoot,pictures:[...document.querySelectorAll(${JSON.stringify(pictureSelector)})].map(image=>{
      const rect=image.getBoundingClientRect();
      return {width:rect.width,height:rect.height,slotWidth:image.offsetWidth,slotHeight:image.offsetHeight,source:image.currentSrc.split(',')[0],kind:image.dataset.nativePicture,
       naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,complete:image.complete && image.currentSrc === image.src};
     })})`);
     const {pictures}=sampleState;
     // Older Chromium reports descendant DOMRects in logical CSS pixels under an ancestor's zoom.
     return Number(sampleState.zoom)===zoom/100&&pictures.length===expected.pictures.length
      &&pictures.every(image=>image.complete&&image.naturalWidth>0&&image.slotWidth===16&&image.slotHeight===16
       &&image.width===image.height&&[16,16*zoom/100].includes(image.width));
    },'loaded standard pictures at '+zoom+'%').catch(error => {
     throw new Error(error.message + ' ' + JSON.stringify({expectedCount:expected.pictures.length, ...sampleState}), {cause:error});
    });
    const {pictures,dpr,root}=sampleState;
    assert.ok(root?.endsWith('/'), 'the form webview exposes the packaged picture directory');
    const scale = zoom * dpr;
    const relativeDistance = density => density < scale ? scale / density : density / scale - .01;
    const density = [85, 100, 125, 150, 175, 200, 300, 400]
      .reduce((best, candidate) => relativeDistance(candidate) < relativeDistance(best) ? candidate : best);
    for (const [index, image] of pictures.entries()) {
     const {name} = expected.pictures[index];
     if (name === 'Post') {
      assert.equal(image.kind, 'raster', name);
      assert.equal(image.source, new URL(`PublishFile/${density}.png`, root).href, name);
      const pixels = Math.round(16 * density / 100);
      assert.deepEqual([image.naturalWidth,image.naturalHeight],[pixels,pixels],name);
     } else {
      assert.equal(image.kind, 'vector', name);
      assert.equal(image.source, 'data:image/svg+xml', name);
      assert.deepEqual([image.naturalWidth,image.naturalHeight],[16,16],name);
     }
    }
    results.push({label,zoom,pictures:pictures.length,rasters:pictures.filter(image=>image.kind==='raster').length});
   }
   assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);
   assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);

  }
  await sample(form.expected,form.kind);
  if(form.kind==='White'){
   const firstPicture = `document.querySelector(${JSON.stringify(pictureSelector)})`;
   async function restoreSelection() {
    await ui.evaluate("document.querySelector('[data-kind=PictureDecoration]').click()");
    await until(() => view.selected?.key.value === '100', 'picture selection restored');
   }
   await restoreSelection();
   const identity = view.selected;
   await ui.evaluate(`globalThis.__standardPicture = ${firstPicture}`);
   async function change(text) {
    await replace(document, text);
    await until(() => view.phase === 'ready' && !view.running && !view.timer
     && view.snapshot.dependencies.some(item => item.role === 'form' && item.version === String(document.version)),
     'dirty picture revision');
    assert.deepEqual(view.selected, identity);
    assert.equal(await ui.evaluate(`globalThis.__standardPicture === ${firstPicture}`), true);
   }
   const black = forms.find(item => item.kind === 'Black');
   const red = forms.find(item => item.kind === 'Red');
   await change(await fs.readFile(black.path, 'utf8'));
   await sample(black.expected, 'dirty-Black');
   await restoreSelection();
   await change(original);
   await sample(form.expected, 'restored-White');
   await restoreSelection();
   await ui.focusWorkbench();
   ui.close();
   await service.receive(view, main, {type:'detach'});
   await until(() => view.frames.get('preview')?.ready, 'picture preview detached');
   const floating = view.frames.get('preview');
   ui = await frame({detached:true, fixedFormArea:true, state:{title:floating.panel.title}});
   await until(() => ui.evaluate(`!!${firstPicture}`), 'floating picture DOM');
   await ui.evaluate(`globalThis.__standardPicture = ${firstPicture}`);
   await sample(form.expected, 'floating-White');
   await restoreSelection();
   await change(await fs.readFile(red.path, 'utf8'));
   await sample(red.expected, 'floating-dirty-Red');
   await restoreSelection();
   await change(original);
   await sample(form.expected, 'floating-restored-White');
   await restoreSelection();
   const edited = original.replace('StdPicture.MoveUp', 'StdPicture.Post');
   assert.notEqual(edited, original);
   const editedExpected = { ...form.expected, pictures: form.expected.pictures.map(picture =>
    picture.id === '100' ? { ...picture, name: 'Post' } : picture) };
   await change(edited);
   await sample(editedExpected,'floating-dirty-Post');
   await restoreSelection();
   await change(original);
   ui.close();
   floating.panel.dispose();
   await until(() => !view.frames.has('preview'), 'picture preview reattached');
   ui = await frame({fixedFormArea:true, state:{title:main.panel.title}});
   await sample(form.expected, 'reattached-White');
   assert.equal(document.isDirty, true);
  }
  await ui.focusWorkbench();ui.close();main.panel.dispose();await until(()=>service.views.size===0,'standard picture session closed');await Promise.all([...service.closing]);
 }
 assert.ok(results.some(result=>result.rasters>0),'the command gallery rendered a standard Post raster');
 assert.deepEqual(await Promise.all(forms.map(f=>fs.readFile(f.path))),before);await explorer.shutdown();
 await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,results,dirtyMattes:true,stablePictureDom:true,selectedIdentityPreserved:true,detachedUpdates:true,sourceWritesDuringViewing:false,wholeFormVisualParity:false}));
};
