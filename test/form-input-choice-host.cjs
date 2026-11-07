const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame,editFormSource,allocateFormViewport, sameSourcePath } = require('./webview-host.cjs');

async function observe(ui,keys) {
  await ui.evaluate('document.fonts.ready.then(()=>true)');
  await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  return ui.evaluate(`(()=>{
    const root=document.querySelector('.taxi-form-frame'),origin=root.getBoundingClientRect();
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return [r.x-origin.x,r.y-origin.y,r.width,r.height]};
    const elements=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    return {frame:[origin.width,origin.height],fields:Object.fromEntries(${JSON.stringify(keys)}.map(([name,key])=>{
      const element=elements.get(key),input=element?.querySelector('.taxi-input'),button=input?.querySelector('.taxi-input-button');
      const help=element?.querySelector('.taxi-field-tooltip');
      return [name,{input:box(input),choiceKind:button?.dataset.choiceKind??null,hint:input?.querySelector('input')?.getAttribute('placeholder')??'',
        help:box(help),helpText:help?.getAttribute('title')??null,paint:input?.dataset.nativeBorder,
        rightmostCorner:Math.max(...[...input?.querySelectorAll('.taxi-input-corner')??[]].map(e=>e.getBoundingClientRect().right-origin.x))}];
    }))};
  })()`);
}

async function verify(ui,keys,expected,preferred=true) {
  let actual;
  await until(async()=>{
    actual=await observe(ui,keys);
    return Object.values(actual.fields).every(field=>field.input&&(process.platform!=='linux'||field.paint==='ready'))
      && expected.fields.every(field=>actual.fields[field.name].choiceKind===field.choiceKind);
  },'choice input profile rendered');
  for(const field of expected.fields) {
    const value=actual.fields[field.name];
    assert.equal(value.hint,field.hint,field.name+' source input hint');
    assert.equal(!!value.help,field.help,field.name+' tooltip content determines the help button');
    if(field.help) assert.equal(value.helpText,field.helpText,field.name+' localized help text');
    if(process.platform==='linux') {
      assert.deepEqual(value.input,field.logical,field.name+' native logical input rectangle');
      assert.equal(value.rightmostCorner-value.input[0],field.physical[2],field.name+' native physical right edge');
      if(field.help) {
        assert.equal(value.help[0],value.input[0]+value.input[2]+5,field.name+' help gap');
        assert.equal(value.help[2],10,field.name+' help width');
      }
    }
  }
  if(preferred&&process.platform==='linux')assert.deepEqual(actual.frame,expected.frame,expected.name+' native frame');
  return actual;
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=extension.formPreview,results=[];
  for(const form of fixture.formGallery) {
    const disk=await fs.readFile(form.path),source=disk.toString('utf8');
    const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    const current=()=>[...service.views.values()].find(view=>sameSourcePath(view.path,form.path));
    await until(()=>current()?.phase==='ready','choice form ready');
    const view=current(),main=view.frames.get('main'),ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
    const keys=[...view.nodes.values()].filter(n=>n.kind==='InputField').map(n=>[n.name,`${n.identity.source}:current:${n.identity.key.value}`]);
    try {
      results.push({name:form.kind,...await verify(ui,keys,form.expected)});
      await ui.parkPointer();await ui.screenshot('input-choice-'+form.kind+'-'+vscode.env.language+'.png');
      if(form.kind==='Fields') {
        const changed=source.replace(/<InputField name="ChoiceList"[^>]*>/u,opening=>opening+'<ListChoiceMode>true</ListChoiceMode>');
        assert.notEqual(changed,source);
        const measured=form.expected.fields.find(field=>field.name==='List');
        const expected={...form.expected,fields:form.expected.fields.map(field=>field.name==='ChoiceList'
          ? {...field,choiceKind:'list',logical:[...field.logical.slice(0,2),measured.logical[2],field.logical[3]],
              physical:[...field.physical.slice(0,2),measured.physical[2],field.physical[3]]}:field)};
        await ui.evaluate("globalThis.__choiceInputs=[...document.querySelectorAll('.taxi-input')];true");
        await editFormSource(doc,view,changed);
        results.push({name:'dirty-list-mode',...await verify(ui,keys,expected)});
        await editFormSource(doc,view,source);await verify(ui,keys,form.expected);
        assert.equal(await ui.evaluate('__choiceInputs.every(input=>input.isConnected)'),true);
        const identity=[...view.nodes.values()].find(n=>n.name==='ChoiceList').identity;
        await service.receive(view,main,{type:'select',identity});
        const workbench=await ui.nativeWindow();await service.receive(view,main,{type:'detach'});
        await until(()=>view.frames.get('preview')?.ready,'choice inputs detached');
        const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
        try {
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await floating.evaluate("globalThis.__choiceInputs=[...document.querySelectorAll('.taxi-input')];true");
          for(const width of [480,720,480]) {
            await allocateFormViewport(floating,[width,400]);
            await editFormSource(doc,view,changed);await verify(floating,keys,expected,false);
            await editFormSource(doc,view,source);
            results.push({name:'detached-'+width,...await verify(floating,keys,form.expected,false)});
            assert.equal(await floating.evaluate('__choiceInputs.every(input=>input.isConnected)'),true);
            assert.deepEqual(view.selected,identity);
          }
          await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'choice inputs docked');
        } finally {floating.close();}
      }
      assert.deepEqual(await fs.readFile(form.path),disk);
    } finally {
      await editFormSource(doc,view,source);ui.close();main.panel.dispose();
      await until(()=>service.views.size===0,'choice inputs released');await Promise.all([...service.closing]);
    }
  }
  await extension.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,results,sourceWrites:false}));
};
