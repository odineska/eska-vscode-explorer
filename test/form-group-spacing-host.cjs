const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {frame,until,sameSourcePath,editFormSource,allocateFormViewport}=require('./webview-host.cjs');
exports.run=async()=>{
 const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),results=[];
 const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
 await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 const service=explorer.formPreview;
 for(const form of fixture.formGallery){
  const disk=await fs.readFile(form.path);const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(doc,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
  const current=()=>[...service.views.values()].find(v=>sameSourcePath(v.path,form.path));await until(()=>current()?.phase==='ready','separation model ready');
  const view=current(),main=view.frames.get('main'),ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
  try{
   const keys=Object.fromEntries([...view.nodes.values()].map(n=>[n.name,`${n.identity.source}:current:${n.identity.key.value}`]));
   await ui.evaluate('document.fonts.ready.then(()=>true)');let actual,last,stable=0;
   await until(async()=>{
    actual=await ui.evaluate(`(()=>{const root=document.querySelector('.taxi-form-frame');if(!root)return null;const r=root.getBoundingClientRect();const box=e=>{if(!e)return null;const b=e.getBoundingClientRect();return[b.x-r.x,b.y-r.y,b.width,b.height]};const nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));const keys=${JSON.stringify(keys)};return{frame:[r.width,r.height],fields:Object.fromEntries(${JSON.stringify(Object.keys(form.expected.fields))}.map(name=>[name,box(nodes.get(keys[name])?.querySelector('.taxi-input'))])),groups:Object.fromEntries(Object.entries(keys).filter(([name,key])=>nodes.get(key)?.querySelector(':scope>.taxi-group')).map(([name,key])=>[name,box(nodes.get(key))]))}})()`);
    const current=JSON.stringify(actual);stable=current===last?stable+1:0;last=current;return actual&&stable>=3
      && (process.platform!=='linux'||JSON.stringify(actual.frame)===JSON.stringify(form.expected.frame)
        && JSON.stringify(actual.fields)===JSON.stringify(form.expected.fields));
   },'stable separation geometry');
   assert.deepEqual(ui.scriptErrors(),[]);results.push({name:form.kind,...actual});
   await ui.parkPointer();await ui.screenshot('separation-'+form.kind+'-'+vscode.env.language+'.png');
   if(form.kind==='NormalMiddle') {
    const original=disk.toString('utf8'),control=fixture.formGallery.find(f=>f.kind==='ControlNone').expected;
    const changed=original.replace('<Representation>NormalSeparation</Representation>','<Representation>None</Representation>');
    assert.notEqual(changed,original);
    const identity=[...view.nodes.values()].find(n=>n.name==='Below').identity;
    await service.receive(view,main,{type:'select',identity});
    const observe=target=>target.evaluate(`(()=>{const root=document.querySelector('.taxi-form-frame'),r=root.getBoundingClientRect();const keys=${JSON.stringify(keys)};return Object.fromEntries(${JSON.stringify(Object.keys(form.expected.fields))}.map(name=>{const e=[...root.querySelectorAll('[data-element]')].find(e=>e.dataset.element===keys[name]).querySelector('.taxi-input'),b=e.getBoundingClientRect();return[name,[b.x-r.x,b.y-r.y,b.width,b.height]]}))})()`);
    async function update(xml,target,expected,label) {
     await editFormSource(doc,view,xml);
     await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'current separation revision');
     let fields;await until(async()=>{fields=await observe(target);return process.platform!=='linux'||JSON.stringify(fields)===JSON.stringify(expected.fields)},label);
     assert.deepEqual(view.selected,identity);assert.deepEqual(target.scriptErrors(),[]);results.push({name:label,fields});
    }
    await ui.evaluate(`globalThis.__separationInputs=[...document.querySelectorAll('.taxi-input')];true`);
    await update(changed,ui,control,'main-dirty-none');await update(original,ui,form.expected,'main-dirty-normal');
    assert.equal(await ui.evaluate('__separationInputs.every(e=>e.isConnected)'),true);
    const workbench=await ui.nativeWindow();await service.receive(view,main,{type:'detach'});
    await until(()=>view.frames.get('preview')?.ready,'separation detached');
    const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
    try {
     assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
     await floating.evaluate(`globalThis.__separationInputs=[...document.querySelectorAll('.taxi-input')];true`);
     for(const width of [400,550,400]) {
      await allocateFormViewport(floating,[width,300]);
      await update(changed,floating,control,'detached-'+width+'-none');
      await update(original,floating,form.expected,'detached-'+width+'-normal');
      assert.equal(await floating.evaluate('__separationInputs.every(e=>e.isConnected)'),true);
     }
    }finally{
     try{await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'separation docked');}
     finally{floating.close();}
    }
   }
   assert.deepEqual(await fs.readFile(form.path),disk);
  }finally{await editFormSource(doc,view,disk.toString('utf8'));ui.close();main.panel.dispose();await until(()=>service.views.size===0,'separation view released');await Promise.all([...service.closing]);}
 }
 await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,sourceWrites:false,results}));
};
