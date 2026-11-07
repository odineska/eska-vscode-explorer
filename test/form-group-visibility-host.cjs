const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {frame,until,editFormSource,allocateFormViewport}=require('./webview-host.cjs');

async function observe(ui,keys) {
  await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  return ui.evaluate(`(()=>{
    const root=document.querySelector('.taxi-form-frame'),origin=root.getBoundingClientRect();
    const elements=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return [r.x-origin.x,r.y-origin.y,r.width,r.height]};
    return {frame:[origin.width,origin.height],middleVisible:elements.has(${JSON.stringify(keys.Middle)}),
      fields:Object.fromEntries(${JSON.stringify(Object.entries(keys).filter(([name])=>name!=='Middle'))}.map(([name,key])=>[name,box(elements.get(key)?.querySelector('.taxi-input'))]))};
  })()`);
}

async function verify(ui,keys,expected,preferred=true) {
  let actual;
  const tolerance=expected.tolerancePx??0;
  const near=(a,b)=>a?.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<=tolerance);
  try {
    await until(async()=>{
      actual=await observe(ui,keys);
      return actual.middleVisible===expected.middleVisible
        && (process.platform!=='linux'||(!preferred||near(actual.frame,expected.frame))
          && Object.entries(expected.fields).every(([name,rect])=>near(actual.fields[name],rect)));
    },expected.name+' group visibility and native footprint');
  } catch(error) {throw new Error(JSON.stringify({case:expected.name,actual,expected}),{cause:error});}
  assert.deepEqual(ui.scriptErrors(),[],'group visibility renderer errors');
  return actual;
}

function fieldVisibility(source,name,visible) {
  const field=new RegExp(`(<InputField name="${name}"[^>]*>)([\\s\\S]*?)(</InputField>)`);
  assert.match(source,field);
  return source.replace(field,(_,open,body,close)=>open+(visible?'':'<Visible>false</Visible>')+body.replace(/\s*<Visible>[^<]+<\/Visible>/u,'')+close);
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),forms=fixture.formGallery;
  const control=forms.find(form=>form.kind==='Control').expected;
  const visible=forms.find(form=>form.kind==='VisibleField').expected;
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=explorer.formPreview,results=[];
  for(const form of forms) {
    const disk=await fs.readFile(form.path),source=disk.toString('utf8');
    const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    const current=()=>[...service.views.values()].find(v=>v.path===form.path);
    await until(()=>current()?.phase==='ready','visibility model ready');
    const view=current(),main=view.frames.get('main'),ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
    const nodes=[...view.nodes.values()].filter(n=>['Above','Below','Inner','Middle'].includes(n.name));
    const keys=Object.fromEntries(nodes.map(n=>[n.name,`${n.identity.source}:current:${n.identity.key.value}`]));
    async function replace(xml,target=ui) {
      await editFormSource(doc,view,xml);
      await until(()=>target.evaluate('__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'current visibility revision rendered');
    }
    try {
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      results.push({name:form.kind,...await verify(ui,keys,form.expected)});
      if(form.kind!=='Control')assert.ok(nodes.some(n=>n.name==='Middle'),'omitted group stays in the source tree');
      await ui.parkPointer();await ui.screenshot('group-visibility-'+form.kind+'-'+vscode.env.language+'.png');
      if(['VisibleField','VisibleTable','NestedHidden'].includes(form.kind)) {
        await ui.evaluate(`globalThis.__visibilityNeighbours=${JSON.stringify([keys.Above,keys.Below])}.map(key=>[...document.querySelectorAll('[data-element]')].find(e=>e.dataset.element===key).querySelector('.taxi-input'));true`);
        const changed=fieldVisibility(source,form.kind==='VisibleTable'?'Value':'Inner',form.kind==='NestedHidden');
        await replace(changed);
        results.push({name:form.kind+'-dirty',...await verify(ui,keys,form.kind==='NestedHidden'?visible:control)});
        await replace(source);await verify(ui,keys,form.expected);
        assert.equal(await ui.evaluate('__visibilityNeighbours.every(e=>e.isConnected)'),true);
      }
      if(form.kind==='VisibleField') {
        const identity=nodes.find(n=>n.name==='Below').identity;
        await service.receive(view,main,{type:'select',identity});const workbench=await ui.nativeWindow();
        await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'visibility detached');
        const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
        try {
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await floating.evaluate(`globalThis.__visibilityNeighbours=${JSON.stringify([keys.Above,keys.Below])}.map(key=>[...document.querySelectorAll('[data-element]')].find(e=>e.dataset.element===key).querySelector('.taxi-input'));true`);
          for(const width of [400,550,400]) {
            await allocateFormViewport(floating,[width,300]);
            await replace(fieldVisibility(source,'Inner',false),floating);await verify(floating,keys,control,false);
            await replace(source,floating);
            results.push({name:'detached-'+width,...await verify(floating,keys,visible,false)});
            assert.deepEqual(view.selected,identity);
            assert.equal(await floating.evaluate('__visibilityNeighbours.every(e=>e.isConnected)'),true);
            assert.ok([...view.nodes.values()].some(n=>n.name==='Middle'));
          }
        } finally {
          try {await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'visibility docked');}
          finally {floating.close();}
        }
      }
      assert.deepEqual(await fs.readFile(form.path),disk);
    } finally {
      await editFormSource(doc,view,source);ui.close();main.panel.dispose();
      await until(()=>service.views.size===0,'visibility view released');await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,sourceWrites:false,results}));
};
