const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

function geometryExpression(keys, names) {
  return `(() => {
    const root=document.querySelector('.taxi-form-frame'); if(!root)return null;
    const r=root.getBoundingClientRect(), nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const box=e=>{if(!e)return null;const b=e.getBoundingClientRect();return[b.x-r.x,b.y-r.y,b.width,b.height]};
    const keys=${JSON.stringify(keys)};
    return {frame:[r.width,r.height],fields:Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,box(nodes.get(keys[name])?.querySelector('.taxi-input'))]))};
  })()`;
}

function assertGeometry(actual, expected, height, label) {
  if (process.platform !== 'linux') return;
  assert.equal(actual.frame[0], expected.frame[0], label+' frame width');
  for (const [name, rect] of Object.entries(expected.fields)) {
    for (const axis of [0,2,3]) assert.equal(actual.fields[name][axis], rect[axis], label+'/'+name+'/'+axis);
  }
  if (height) {
    assert.deepEqual(actual.frame, expected.frame, label+' frame');
    assert.deepEqual(actual.fields, expected.fields, label+' fields');
  }
}

async function stableGeometry(ui, expression) {
  let value, previous, stable=0;
  await until(async()=>{
    value=await ui.evaluate(expression);
    const next=JSON.stringify(value); stable=next===previous?stable+1:0; previous=next;
    return value&&stable>=3;
  }, 'stable decoration geometry');
  return value;
}

exports.run = async () => {
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE), results=[];
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=explorer.formPreview;
  for(const form of fixture.formGallery) {
    const disk=await fs.readFile(form.path), doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc,{preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...service.views.values()].find(v=>sameSourcePath(v.path,form.path))?.phase==='ready','decoration model ready');
    const view=[...service.views.values()].find(v=>sameSourcePath(v.path,form.path)), main=view.frames.get('main');
    const ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
    try {
      const keys=Object.fromEntries([...view.nodes.values()].map(n=>[n.name,`${n.identity.source}:current:${n.identity.key.value}`]));
      const expression=geometryExpression(keys,Object.keys(form.expected.fields));
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const actual=await stableGeometry(ui,expression);
      assertGeometry(actual,form.expected,true,form.kind);
      assert.deepEqual(ui.scriptErrors(),[]);
      assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);
      assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);
      results.push({name:form.kind,...actual,heightAccepted:process.platform==='linux',
        nativeGeometryMatches:process.platform==='linux'?JSON.stringify(actual)===JSON.stringify({frame:form.expected.frame,fields:form.expected.fields}):undefined});
      await ui.parkPointer(); await ui.screenshot('decoration-'+form.kind+'-'+vscode.env.language+'.png');
      const variants=form.kind==='AutoMax'?['AutoNoMax','Width20','AutoMax']
        :form.kind==='BspControl'?['BspUnitedTrue','BspControl']
        :form.kind==='MonoAsciiLines1'?['MonoAsciiLines2','MonoAsciiLines3','MonoAsciiLines1']
        :form.kind==='MonoSoftFont10Width20'?['MonoSoftHard','MonoSoftEmptyHard','MonoSoftFont10Width20']:[];
      if(variants.length) {
        const identity=[...view.nodes.values()].find(n=>n.name==='Below').identity;
        await service.receive(view,main,{type:'select',identity});
        const remember=target=>target.evaluate(`globalThis.__decorationElements=[...document.querySelectorAll('.taxi-input,.taxi-label')];true`);
        const retained=target=>target.evaluate('__decorationElements.every(e=>e.isConnected)');
        async function update(name,target,label,allocated=false) {
          const variant=fixture.formGallery.find(f=>f.kind===name);
          await editFormSource(doc,view,await fs.readFile(variant.path,'utf8'));
          await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'current decoration revision');
          if(allocated) await allocateFormViewport(target,variant.expected.frame);
          const value=await stableGeometry(target,expression);
          assertGeometry(value,variant.expected,true,label);
          assert.deepEqual(view.selected,identity); assert.equal(await retained(target),true);
          assert.deepEqual(target.scriptErrors(),[]); results.push({name:label,...value});
        }
        await remember(ui);
        for(const name of variants) await update(name,ui,form.kind+'-main-'+name);
        const workbench=await ui.nativeWindow(); await service.receive(view,main,{type:'detach'});
        await until(()=>view.frames.get('preview')?.ready,'decoration detached');
        const preview=view.frames.get('preview'), floating=await frame({detached:true,state:{title:preview.panel.title}});
        try {
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await remember(floating);
          for(const name of variants) await update(name,floating,form.kind+'-detached-'+name,true);
          if(form.kind==='AutoMax') {
            await update('AutoNoMax',floating,'detached-before-resize',true);
            const poses=[];
            for(const [width,height,lines]of[[400,300,2],[700,350,1],[400,300,2]]) {
              await allocateFormViewport(floating,[width,height]);
              let pose;
              await until(async()=>{
                pose=await floating.evaluate(`(()=>{const r=document.querySelector('.taxi-form-frame').getBoundingClientRect(),l=document.querySelector('.taxi-label'),b=l.getBoundingClientRect();return{frame:[r.width,r.height],lines:l.textContent.split('\\n').length,label:[b.width,b.height],overflow:b.width>l.parentElement.getBoundingClientRect().width+.1}})()`);
                return pose.frame[0]===width&&pose.lines===lines&&!pose.overflow;
              },'decoration resize reflow');
              assert.equal(await retained(floating),true); assert.deepEqual(view.selected,identity);
              poses.push(pose); results.push({name:'detached-resize-'+width,...pose,nativeResizeAccepted:false});
            }
            assert.deepEqual(poses[0],poses[2]);
            await update('AutoMax',floating,'detached-restored',true);
          }
        } finally {
          try {await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'decoration docked');}
          finally {floating.close();}
        }
      }
      assert.deepEqual(await fs.readFile(form.path),disk);
    } finally {
      await editFormSource(doc,view,disk.toString('utf8'));
      ui.close(); main.panel.dispose();
      await until(()=>service.views.size===0,'decoration view released'); await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,sourceWrites:false,fullNativeProfileAccepted:false,results}));
};
