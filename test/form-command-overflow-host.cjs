const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

function geometryExpression(keys, fields, commandNames) {
  return `(() => {
    const root=document.querySelector('.taxi-form-frame');if(!root)return null;
    const origin=root.getBoundingClientRect(),nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const keys=${JSON.stringify(keys)},node=name=>nodes.get(keys[name]);
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return[r.x-origin.x,r.y-origin.y,r.width,r.height]};
    const bar=node('Bar')?.querySelector(':scope>.taxi-command-bar');
    const commands={More:bar?.querySelector(':scope>.taxi-popup>button'),...Object.fromEntries(${JSON.stringify(commandNames)}.filter(name=>name!=='More').map(name=>[name,node(name)?.querySelector(':scope>button')]))};
    return {frame:[origin.width,origin.height],fields:Object.fromEntries(${JSON.stringify(fields)}.map(name=>[name,box(node(name)?.querySelector('.taxi-input'))])),
      commands:Object.fromEntries(Object.entries(commands).filter(([,element])=>element).map(([name,element])=>[name,box(element)]))};
  })()`;
}

async function stableGeometry(ui, expression) {
  let actual, previous, stable=0;
  await until(async()=>{
    actual=await ui.evaluate(expression);const value=JSON.stringify(actual);
    stable=value===previous?stable+1:0;previous=value;return actual&&stable>=3;
  },'stable command overflow geometry');
  return actual;
}

function assertGeometry(actual, expected, label) {
  assert.deepEqual(Object.keys(actual.commands).sort(),Object.keys(expected.commandsPaint).sort(),label+' visible commands');
  if(process.platform!=='linux')return;
  assert.deepEqual(actual.frame,expected.frame,label+' frame');
  assert.deepEqual(actual.fields,expected.fields,label+' fields');
  // Native paint includes the bottom shadow; the DOM button box ends one pixel earlier.
  const commands=Object.fromEntries(Object.entries(expected.commandsPaint).map(([name,[x,y,w,h]])=>[name,[x,y,w,h-1]]));
  assert.deepEqual(actual.commands,commands,label+' command boxes');
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),results=[];
  const locale=vscode.env.language.startsWith('ru')?'ru':'en';
  const expected=form=>form.expected.locales[locale];
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=explorer.formPreview;
  for(const form of fixture.formGallery){
    const disk=await fs.readFile(form.path),source=disk.toString('utf8');
    const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...service.views.values()].find(v=>sameSourcePath(v.path,form.path))?.phase==='ready','command overflow model ready');
    const view=[...service.views.values()].find(v=>sameSourcePath(v.path,form.path)),main=view.frames.get('main');
    const ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
    try{
      const keys=Object.fromEntries([...view.nodes.values()].map(n=>[n.name,`${n.identity.source}:current:${n.identity.key.value}`]));
      const expression=geometryExpression(keys,Object.keys(expected(form).fields),Object.keys(expected(form).commandsPaint));
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const actual=await stableGeometry(ui,expression);assertGeometry(actual,expected(form),form.kind);
      assert.deepEqual(ui.scriptErrors(),[]);assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);
      assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);
      assert.equal(await ui.evaluate('document.querySelectorAll(".taxi-table-field").length'),0,'empty table stays unpainted');
      results.push({name:form.kind,...actual,nativeGeometryCompared:process.platform==='linux'});
      await ui.parkPointer();await ui.screenshot('overflow-'+form.kind+'-'+locale+'.png');
      if(form.kind==='EmptySourceAuto'){
        const identity=[...view.nodes.values()].find(n=>n.name==='Lead').identity;
        await service.receive(view,main,{type:'select',identity});
        const remember=target=>target.evaluate(`globalThis.__overflowInputs=[...document.querySelectorAll('.taxi-input')];globalThis.__overflowMore=document.querySelector('.taxi-command-bar>.taxi-popup>button');true`);
        const inputsRetained=target=>target.evaluate('__overflowInputs.every(e=>e.isConnected)');
        const moreRetained=target=>target.evaluate('__overflowMore.isConnected');
        async function update(xml,reference,target,label,allocated=false){
          await editFormSource(doc,view,xml);
          await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'current command overflow revision');
          if(allocated)await allocateFormViewport(target,reference.frame);
          const geometry=await stableGeometry(target,expression);assertGeometry(geometry,reference,label);
          assert.deepEqual(view.selected,identity);assert.equal(await inputsRetained(target),true);
          assert.deepEqual(target.scriptErrors(),[]);results.push({name:label,...geometry});
        }
        async function variant(name,target,label,allocated=false){
          const next=fixture.formGallery.find(f=>f.kind===name);assert.ok(next);
          await update(await fs.readFile(next.path,'utf8'),expected(next),target,label,allocated);
          assert.equal(await moreRetained(target),true,'visible menu retains its DOM owner');
        }
        await remember(ui);
        const hidden=source.replace(/(<Button name="(?:CustomizeAction|MovedAction)" id="\d+">)/gu,'$1<Visible>false</Visible>');
        assert.notEqual(hidden,source);
        const noMenu=fixture.formGallery.find(f=>f.kind==='EmptySourceNoMenu');
        await update(hidden,expected(noMenu),ui,'dirty-hidden-menu');assert.equal(await moreRetained(ui),false);
        await update(source,expected(form),ui,'dirty-restored-menu');await remember(ui);
        for(const name of ['EmptySourceFixed','EmptySourceRight','EmptySourceAuto'])await variant(name,ui,'dirty-'+name);
        const workbench=await ui.nativeWindow();await service.receive(view,main,{type:'detach'});
        await until(()=>view.frames.get('preview')?.ready,'command overflow detached');
        const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
        try{
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await remember(floating);
          for(const name of ['EmptySourceFixed','EmptySourceRight','EmptySourceAuto'])await variant(name,floating,'detached-'+name,true);
          const poses=[];
          for(const width of [600,900,600]){
            await allocateFormViewport(floating,[width,300]);let pose;
            await until(async()=>{
              pose=await floating.evaluate(expression);const more=pose?.commands.More;
              return pose&&more&&(process.platform!=='linux'||pose.frame[0]===width&&pose.frame[0]-more[0]-more[2]===21);
            },'command overflow follows resized edge');
            if(process.platform==='linux')assert.deepEqual(pose.fields,expected(form).fields);
            assert.equal(await inputsRetained(floating),true);assert.equal(await moreRetained(floating),true);
            assert.deepEqual(view.selected,identity);poses.push(pose);results.push({name:'resize-'+width,...pose,nativeResizeAccepted:false});
          }
          assert.deepEqual(poses[0],poses[2]);
        }finally{
          try{await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'command overflow docked');}
          finally{floating.close();}
        }
      }
      if(form.kind==='DoubleShortInlineRoot'){
        const identity=[...view.nodes.values()].find(n=>n.name==='Inline1').identity;
        await service.receive(view,main,{type:'select',identity});
        const remember=target=>target.evaluate("globalThis.__widthControls=[...document.querySelectorAll('.taxi-input,.taxi-command-bar>.taxi-element>button')];true");
        async function change(kind,target,allocated=false){
          const next=fixture.formGallery.find(f=>f.kind===kind);assert.ok(next);
          await editFormSource(doc,view,await fs.readFile(next.path,'utf8'));
          await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'current command width revision');
          if(allocated)await allocateFormViewport(target,expected(next).frame);
          const geometry=await stableGeometry(target,expression);assertGeometry(geometry,expected(next),'dirty '+kind);
          assert.equal(await target.evaluate('__widthControls.every(e=>e.isConnected)'),true);
          assert.deepEqual(view.selected,identity);assert.deepEqual(target.scriptErrors(),[]);
          results.push({name:(allocated?'detached-width-':'dirty-width-')+kind,...geometry});
        }
        await remember(ui);await change('DoubleLongInlineRoot',ui);await change('DoubleShortInlineRoot',ui);
        const workbench=await ui.nativeWindow();await service.receive(view,main,{type:'detach'});
        await until(()=>view.frames.get('preview')?.ready,'command width detached');
        const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
        try{
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await remember(floating);await change('DoubleLongInlineRoot',floating,true);await change('DoubleShortInlineRoot',floating,true);
        }finally{
          try{await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'command width docked');}
          finally{floating.close();}
        }
      }
      assert.deepEqual(await fs.readFile(form.path),disk);
    }catch(error){
      await ui.parkPointer().catch(()=>{});
      await ui.screenshot('overflow-'+form.kind+'-failure-'+locale+'.png').catch(()=>{});
      throw error;
    }finally{
      await editFormSource(doc,view,source);ui.close();main.panel.dispose();
      await until(()=>service.views.size===0,'command overflow view released');await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale,sourceWrites:false,fullNativeProfileAccepted:false,results}));
};
