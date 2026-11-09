const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

async function geometry(ui, view, form, locale) {
  const keys = Object.fromEntries([...view.nodes.values()].map(n => [n.name, `${n.identity.source}:current:${n.identity.key.value}`]));
  const expression = `(() => {
    const root=document.querySelector('.taxi-form-frame');if(!root)return null;
    if([...root.querySelectorAll('.taxi-input')].some(e=>e.dataset.nativeBorder!=='ready'))return null;
    const keys=${JSON.stringify(keys)},origin=root.getBoundingClientRect(),nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const control=name=>nodes.get(keys[name])?.querySelector('.taxi-input');
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return[r.x-origin.x,r.y-origin.y,r.width+Number(e.dataset.nativeOutset||0),r.height]};
    return {frame:[origin.width,origin.height],fields:Object.fromEntries(${JSON.stringify(Object.keys(form.expected.locales[locale].fields))}.map(name=>[name,box(control(name))])),
      findVisible:!!nodes.get(keys.Find)?.querySelector('button')};
  })()`;
  let sample, previous, stable = 0;
  await until(async () => {
    sample = await ui.evaluate(expression);
    const next = JSON.stringify(sample);stable=next===previous?stable+1:0;previous=next;
    return sample && stable>=3;
  }, 'stable unbound button geometry');
  return sample;
}

function assertNative(sample, form, locale, label) {
  assert.equal(sample.findVisible, false, label+' hides the unbound button');
  if (process.platform !== 'linux') return;
  const {findVisible,...actual} = sample, {screenshotSha256,...expected} = form.expected.locales[locale];
  assert.deepEqual(actual, expected, label);
}

exports.run = async () => {
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),results=[];
  const locale=vscode.env.language.startsWith('ru')?'ru':'en';
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=explorer.formPreview;
  for (const form of fixture.formGallery) {
    const disk=await fs.readFile(form.path),source=disk.toString('utf8');
    const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc,{preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...service.views.values()].find(v=>sameSourcePath(v.path,form.path))?.phase==='ready','unbound model');
    const view=[...service.views.values()].find(v=>sameSourcePath(v.path,form.path)),main=view.frames.get('main');
    const ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
    try {
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const sample=await geometry(ui,view,form,locale);
      assertNative(sample,form,locale,form.kind);
      const find=[...view.nodes.values()].find(n=>n.name==='Find');
      assert.ok(find,'the source button remains in the tree');
      assert.equal(find.presentation.displayed,false);
      assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);
      assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);
      assert.deepEqual(ui.scriptErrors(),[]);
      results.push({name:form.kind,...sample,nativeGeometryCompared:process.platform==='linux'});
      await ui.parkPointer();await ui.screenshot(form.kind+'-'+locale+'.png');
      if (form.kind==='FixedGroupHeight3') {
        await service.receive(view,main,{type:'select',identity:find.identity});
        const remember=target=>target.evaluate("globalThis.__unboundCode=[...document.querySelectorAll('.taxi-input')][1];true");
        const from='<CommandName>0</CommandName>',to='<CommandName>Form.StandardCommand.Close</CommandName>';
        assert.equal(source.split(from).length,2);
        async function change(target,bound,detached=false) {
          await editFormSource(doc,view,bound?source.replace(from,to):source);
          await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'button command revision');
          if(detached&&!bound)await allocateFormViewport(target,form.expected.locales[locale].frame);
          const actual=await geometry(target,view,form,locale);
          assert.equal(actual.findVisible,bound);
          if(!bound)assertNative(actual,form,locale,'restored '+form.kind);
          assert.equal(await target.evaluate('__unboundCode.isConnected'),true);
          assert.deepEqual(view.selected,find.identity);
          assert.deepEqual(target.scriptErrors(),[]);
          results.push({name:(detached?'detached-':'dirty-')+(bound?'bound':'unbound'),...actual,nativeGeometryCompared:!bound&&process.platform==='linux'});
        }
        await remember(ui);await change(ui,true);await change(ui,false);
        const workbench=await ui.nativeWindow();
        await service.receive(view,main,{type:'detach'});
        await until(()=>view.frames.get('preview')?.ready,'unbound detached');
        const preview=view.frames.get('preview'),floating=await frame({detached:true,fixedFormArea:true,state:{title:preview.panel.title}});
        try {
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await remember(floating);await change(floating,true,true);await change(floating,false,true);
        } finally {
          try {
            await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'unbound docked');
          } finally { floating.close(); }
        }
      }
      assert.deepEqual(await fs.readFile(form.path),disk);
    } catch(error) {
      await ui.screenshot(form.kind+'-failure-'+locale+'.png').catch(()=>{});throw error;
    } finally {
      await editFormSource(doc,view,source);ui.close();main.panel.dispose();
      await until(()=>service.views.size===0,'unbound released');await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale,sourceWrites:false,fullNativeProfileAccepted:false,results}));
};
