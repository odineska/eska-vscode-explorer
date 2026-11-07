const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate(); await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results = [];
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview:false,viewColumn:vscode.ViewColumn.One });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service = explorer.formPreview;
    await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
    const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-form-frame')"), `render ${form.kind}`);
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    if(process.platform==='linux')await until(()=>ui.evaluate("!document.querySelector('[data-native-label=pending]')"),'native value and caption rasters settled');
    const state = await ui.evaluate(`(() => {
      const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const input=document.querySelector('.taxi-input'),value=input?.querySelector('input'),css=input&&getComputedStyle(input),label=document.querySelector('.taxi-field-label');
      return {frame:rect(document.querySelector('.taxi-form-frame')),control:rect(input),value:value?.value,
        background:css?.backgroundColor,border:css?.borderColor,text:value&&getComputedStyle(value).color,title:label&&getComputedStyle(label).color,
        nativeValue:input?.querySelector('[data-native-value]')?.dataset.nativeValue,canvas:rect(input?.querySelector('canvas')),buttons:input?.querySelectorAll('.taxi-input-button').length ?? 0,elements:document.querySelectorAll('.taxi-element').length};
    })()`);
    const hidden=['InputHidden','TableHidden'].includes(form.kind);
    if (hidden) {assert.equal(state.control,null);assert.equal(state.elements,0);assert.deepEqual([state.frame.width,state.frame.height],[34,52]);}
    else {
      const sizes={InputColors:[121,23],InputNumber:[121,23],InputDate:[121,23],InputDateTime:[181,23],InputTime:[91,23],InputFont:[236,35],Font12Normal:[199,29],Font14Normal:[236,35],Font16Normal:[261,38],Font14Number:[166,35]};
      assert.deepEqual([state.control.width,state.control.height],sizes[form.kind] ?? [161,23],form.kind);
      const readOnly=['InputDisabled','InputReadOnly'].includes(form.kind);
      assert.equal(state.border,form.kind==='InputColors'?'rgb(0, 100, 0)':readOnly?'rgb(215, 215, 215)':'rgb(160, 160, 160)');
      assert.equal(state.background,form.kind==='InputColors'?'rgb(255, 255, 224)':'rgb(255, 255, 255)');
      if(form.kind==='InputDisabled')assert.equal(state.title,'rgb(170, 170, 170)');
      if(form.kind==='InputColors'){assert.equal(state.title,'rgb(255, 0, 0)');assert.equal(state.text,'rgb(0, 0, 255)');}
      if(['InputNumber','InputColors','Font14Number'].includes(form.kind))assert.equal(state.value,'0');
      if(process.platform==='linux'&&['InputNumber','InputColors','Font14Number'].includes(form.kind))assert.equal(state.nativeValue,'ready');
      if(process.platform==='linux'&&['InputNumber','InputColors','Font14Number'].includes(form.kind))assert.deepEqual(await ui.evaluate("(() => {const b=document.querySelector('.taxi-input-button--number'),s=getComputedStyle(b),icon=b.querySelector('svg');return [s.width,s.borderLeftColor,s.backgroundColor,icon.getAttribute('width'),icon.getAttribute('height')];})()"),['20px',form.kind==='InputColors'?'rgb(0, 100, 0)':'rgb(160, 160, 160)','rgb(255, 255, 255)','9','11']);
      if(['InputDate','InputDateTime','InputTime'].includes(form.kind)){assert.ok(state.value.includes(form.kind==='InputDate'?'/':':'));assert.ok(!state.value.includes('0001'));}
      assert.equal(state.buttons,['InputColors','InputNumber','InputDate','InputDateTime','Font14Number'].includes(form.kind)?1:0);
    }
    await ui.screenshot(`state-${form.kind}-${vscode.env.language}.png`);
    if(form.kind==='InputColors'&&process.platform==='linux'){
      await ui.evaluate("globalThis.__numericValueInput=document.querySelector('.taxi-input input')");
      const original=document.getText();
      for(const color of ['Red','Blue']){
        const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();
        edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),original.replace('<TextColor>web:Blue</TextColor>',`<TextColor>web:${color}</TextColor>`));
        assert.equal(await vscode.workspace.applyEdit(edit),true);
        await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty numeric value revision');
        await until(()=>ui.evaluate("document.querySelector('[data-native-value]')?.dataset.nativeValue==='ready'"),'dirty numeric value raster');
        const channel=color==='Red'?0:2;
        await until(()=>ui.evaluate(`(() => {const c=document.querySelector('.taxi-input canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=4)if(p[i+${channel}]>p[i+1]+40&&p[i+${channel}]>p[i+${channel===0?2:0}]+40)return true;return false;})()`),'dirty numeric ink color');
        assert.equal(await ui.evaluate("globalThis.__numericValueInput===document.querySelector('.taxi-input input')"),true);
      }
    }

    assert.deepEqual(await fs.readFile(form.path),before);results.push({kind:form.kind,...state});panel.panel.dispose();
    await until(()=>service.views.size===0,'release state form');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formStates:true,locale:vscode.env.language,sourceWritesDuringViewing:false,results}));
};
