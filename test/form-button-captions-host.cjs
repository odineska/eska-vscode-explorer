const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

const measurement = `(() => {
  const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  return {frame:rect(document.querySelector('.taxi-form-frame')),buttons:[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(node =>
    ({...rect(node),caption:node.getAttribute('aria-label'),color:getComputedStyle(node).color,status:node.querySelector('[data-native-caption]').dataset.nativeCaption}))};
})()`;

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, {preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...explorer.formPreview.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'caption form ready');
    const view = [...explorer.formPreview.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
    const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    const ready = () => ui.evaluate("document.querySelectorAll('.taxi-command-bar [data-native-caption=ready]').length===3");
    if (process.platform === 'linux') await until(ready, 'Cyrillic and colored WASM captions');
    else await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-command-bar .taxi-button').length===3"), 'caption DOM');
    await until(async () => await ui.evaluate("[...document.querySelectorAll('.taxi-command-bar .taxi-button')].every(node=>node.style.width)"), 'caption widths');
    const actual = await ui.evaluate(measurement), expected = form.expected;
    assert.deepEqual(actual.buttons.map(item => item.caption), expected.buttons.map(item => item.caption));
    if (process.platform === 'linux') {
      assert.deepEqual([actual.frame.width,actual.frame.height],expected.nativeFrame,form.kind);
      assert.deepEqual(actual.buttons.map(button => ({x:button.x-actual.frame.x,y:button.y-actual.frame.y,width:button.width,height:button.height})),
        expected.buttons.map(({x,y,width,height}) => ({x,y,width,height})),form.kind);
      assert.deepEqual(actual.buttons.map(item => item.color),expected.buttons.map(item => `rgb(${item.foreground.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')})`));
    }
    await ui.screenshot(`button-caption-${form.kind}-${vscode.env.language}.png`);
    results.push({name:form.kind,...actual});
    if (form.kind === '10NormalColor' && process.platform === 'linux') {
      const original = document.getText();
      await ui.evaluate("globalThis.__captionButton=document.querySelector('.taxi-button')");
      for (const color of ['Green','Blue']) {
        const revision = view.snapshot.revision, edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),
          original.replace('<TextColor>web:Blue</TextColor>',`<TextColor>web:${color}</TextColor>`));
        assert.equal(await vscode.workspace.applyEdit(edit),true);
        await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer,'dirty caption color model');
        await until(ready,'dirty caption color raster');
        const channel = color === 'Green' ? 1 : 2;
        await until(async () => await ui.evaluate(`(() => {
          const c=document.querySelector('.taxi-button canvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          for(let i=0;i<data.length;i+=4)if(data[i+${channel}]>data[i]+20&&data[i+${channel}]>data[i+${channel===1?2:1}]+20)return true;return false;
        })()`),'dirty color pixels');
        assert.equal(await ui.evaluate("globalThis.__captionButton===document.querySelector('.taxi-button')"),true);
      }
      assert.equal(document.isDirty,true);
    }
    assert.deepEqual(await fs.readFile(form.path),before);
    ui.close();panel.panel.dispose();
    await until(() => explorer.formPreview.views.size===0,'caption session released');
    await Promise.all([...explorer.formPreview.closing]);
  }
  const report = {passed:true,locale:vscode.env.language,linuxGeometryVerified:process.platform==='linux',sourceWritesDuringViewing:false,results};
  if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`button-caption-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
