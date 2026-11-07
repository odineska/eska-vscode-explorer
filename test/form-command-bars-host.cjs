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
    const find=name=>elements.get(${JSON.stringify(keys)}[name]);
    return {frame:[origin.width,origin.height],footerVisible:!!find('Footer'),
      bars:Object.fromEntries(['Left','Right'].map(name=>[name,!!find(name)])),
      fields:Object.fromEntries(['Above','Below'].map(name=>[name,box(find(name)?.querySelector('.taxi-input'))])),
      buttons:Object.fromEntries(['Back','Next','Close','Actions'].flatMap(name=>{
        const button=find(name)?.querySelector(':scope > .taxi-button, :scope > .taxi-popup > .taxi-button');
        return button?[[name,box(button)]]:[];
      })),ready:[...root.querySelectorAll('.taxi-button')].every(e=>e.style.width)
        && !root.querySelector('[data-native-label=pending]')};
  })()`);
}

async function verify(ui,keys,expected) {
  let actual;
  try {
    await until(async()=>{
      actual=await observe(ui,keys);
      if(!actual.ready||actual.footerVisible!==expected.footerVisible
        ||Object.entries(expected.bars).some(([name,value])=>actual.bars[name]!==value))return false;
      if(process.platform!=='linux')return true;
      return JSON.stringify([actual.frame,actual.fields,actual.buttons])
        ===JSON.stringify([expected.frame,expected.fields,Object.fromEntries(['Back','Next','Close','Actions']
          .filter(name=>expected.buttons[name]).map(name=>[name,expected.buttons[name]]))]);
    },expected.name+' command-bar geometry');
  }catch(error){throw new Error(JSON.stringify({name:expected.name,actual,expected}),{cause:error});}
  assert.deepEqual(ui.scriptErrors(),[],'command-bar renderer errors');
  return actual;
}

async function resized(ui,keys,width) {
  await allocateFormViewport(ui,[width,300]);
  let actual,previous,stable=0;
  await until(async()=>{
    actual=await observe(ui,keys);const json=JSON.stringify(actual);
    stable=json===previous?stable+1:0;previous=json;return actual.ready&&stable>=2;
  },'command row settled after resize');
  const {frame:bounds,buttons}=actual;
  for(const [name,[x,y,w,h]] of Object.entries(buttons)) {
    assert.ok(x>=0&&y>=0&&x+w<=bounds[0]&&y+h<=bounds[1],name+' inside form');
  }
  if(buttons.Next&&buttons.Close)assert.ok(buttons.Next[0]+buttons.Next[2]<=buttons.Close[0],'commands do not overlap');
  assert.deepEqual(ui.scriptErrors(),[]);
  return actual;
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),forms=fixture.formGallery;
  const expected=name=>forms.find(form=>form.kind===name).expected;
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service=explorer.formPreview,results=[];
  for(const form of forms) {
    const disk=await fs.readFile(form.path),source=disk.toString('utf8');
    const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    const current=()=>[...service.views.values()].find(v=>v.path===form.path);
    await until(()=>current()?.phase==='ready','command-bar model ready');
    const view=current(),main=view.frames.get('main'),tab={fixedFormArea:true,state:{title:main.panel.title}},ui=await frame(tab);
    const nodes=[...view.nodes.values()].filter(n=>['Above','Below','Footer','Left','Right','Back','Next','Close','Actions'].includes(n.name));
    const keys=Object.fromEntries(nodes.map(n=>[n.name,`${n.identity.source}:current:${n.identity.key.value}`]));
    async function replace(xml,target=ui) {
      await editFormSource(doc,view,xml);
      await until(()=>target.evaluate('__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)),'current command-bar revision rendered');
    }
    try {
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      results.push({name:form.kind,...await verify(ui,keys,form.expected)});
      assert.ok(nodes.some(n=>n.name==='Footer'),'omitted footer stays in source tree');
      await ui.parkPointer();await ui.screenshot('command-bars-'+form.kind+'-'+vscode.env.language+'.png');
      if(['RightBoth','BothHidden','AutoUnitedTrue'].includes(form.kind)) {
        const changed=form.kind==='RightBoth'?source.replace('<HorizontalLocation>Right</HorizontalLocation>','<HorizontalLocation>Left</HorizontalLocation>')
          :form.kind==='BothHidden'?source.replaceAll('<Visible>false</Visible>','')
            :source.replace('<United>true</United>','<United>false</United>');
        assert.notEqual(changed,source);
        await ui.evaluate(`globalThis.__barNeighbours=${JSON.stringify([keys.Above,keys.Below])}.map(key=>[...document.querySelectorAll('[data-element]')].find(e=>e.dataset.element===key).querySelector('.taxi-input'));true`);
        await replace(changed);
        results.push({name:form.kind+'-dirty',...await verify(ui,keys,expected(form.kind==='RightBoth'?'LeftBoth':form.kind==='BothHidden'?'RightBoth':'AutoUnitedFalse'))});
        await replace(source);await verify(ui,keys,form.expected);
        assert.equal(await ui.evaluate('__barNeighbours.every(e=>e.isConnected)'),true);
      }
      tab.fixedFormArea=false;
      if(['AutoBoth','RightBoth','AutoNestedPopup','AutoUnitedFalse','RightParentWidth'].includes(form.kind)) {
        for(const width of [400,250,700,400])results.push({name:form.kind+'-resize-'+width,...await resized(ui,keys,width)});
        await allocateFormViewport(ui,form.expected.frame);await verify(ui,keys,form.expected);
      }
      if(form.kind==='RightBoth') {
        const identity=nodes.find(n=>n.name==='Next').identity;
        await service.receive(view,main,{type:'select',identity});const workbench=await ui.nativeWindow();
        await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'command bar detached');
        const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
        try {
          assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
          await allocateFormViewport(floating,form.expected.frame);await verify(floating,keys,form.expected);
          await floating.evaluate(`globalThis.__barNodes=${JSON.stringify([keys.Above,keys.Below,keys.Next])}.map(key=>[...document.querySelectorAll('[data-element]')].find(e=>e.dataset.element===key).firstElementChild);true`);
          for(const width of [400,700,400]) {
            const pose=await resized(floating,keys,width);
            if(process.platform==='linux')assert.equal(pose.buttons.Next[0],pose.frame[0]-186,'right inset follows local allocation');
            await replace(source.replace('<HorizontalLocation>Right</HorizontalLocation>','<HorizontalLocation>Left</HorizontalLocation>'),floating);
            await allocateFormViewport(floating,form.expected.frame);await verify(floating,keys,expected('LeftBoth'));
            await replace(source,floating);results.push({name:'detached-dirty-'+width,...await verify(floating,keys,form.expected)});
            assert.deepEqual(view.selected,identity);
            assert.equal(await floating.evaluate('__barNodes.every(e=>e.isConnected)'),true);
          }
        }finally{
          try{await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'command bar docked');}
          finally{floating.close();}
        }
      }
      assert.deepEqual(await fs.readFile(form.path),disk);
    }finally{
      await editFormSource(doc,view,source);ui.close();main.panel.dispose();
      await until(()=>service.views.size===0,'command-bar view released');await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,
    nativeReferenceCompared:process.platform==='linux',sourceWrites:false,results}));
};
