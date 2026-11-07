const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const ready = target => target.evaluate("document.querySelectorAll('.taxi-command-bar [data-native-caption=ready]').length===3");
  async function bitmap(target) {
    const rgb = await target.evaluate(`(() => {const c=document.querySelectorAll('.taxi-command-bar .taxi-button')[1]?.querySelector('canvas');
      if(!c?.width||!c.height)return null;return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data].filter((v,i)=>i%4!==3);})()`);
    return rgb && createHash('sha256').update(Buffer.from(rgb)).digest('hex');
  }
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, {preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...explorer.formPreview.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'colored button form ready');
    const view = [...explorer.formPreview.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
    const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}}), expected = form.expected.buttons[1];
    await until(() => ready(ui), 'primary, colored and white caption rasters');
    const actual = await ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const button=document.querySelectorAll('.taxi-command-bar .taxi-button')[1],s=getComputedStyle(button);
      return {frame:rect(document.querySelector('.taxi-form-frame')),button:rect(button),background:s.backgroundColor,color:s.color};})()`);
    if (process.platform === 'linux') {
      assert.deepEqual([actual.frame.width,actual.frame.height],form.expected.nativeFrame,form.kind);
      assert.deepEqual([actual.button.x-actual.frame.x,actual.button.y-actual.frame.y,actual.button.width,actual.button.height],
        [expected.x,expected.y,expected.width,expected.height],form.kind);
      assert.equal(actual.color,'rgb(77, 77, 77)');
      assert.equal(await bitmap(ui),expected.glyphRgbSha256,form.kind);
    }
    await ui.screenshot(`button-colors-${form.kind}-${vscode.env.language}.png`);
    results.push({name:form.kind,...actual});
    if (form.kind === '000080') {
      const original = document.getText(), red = fixture.formGallery.find(item => item.kind === 'FF0000').expected.buttons[1];
      const change = async (text, target, hash) => {
        const revision = view.snapshot.revision, edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
        assert.equal(await vscode.workspace.applyEdit(edit),true);
        await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer,'dirty background revision');
        await until(async () => await ready(target) && await bitmap(target) === hash,'dirty background native pixels');
      };
      const changed = original.replace('<BackColor>#000080</BackColor>','<BackColor>#FF0000</BackColor>');
      assert.notEqual(changed,original);
      await ui.evaluate("globalThis.__coloredButton=document.querySelectorAll('.taxi-command-bar .taxi-button')[1]");
      await change(changed,ui,red.glyphRgbSha256);
      await change(original,ui,expected.glyphRgbSha256);
      assert.equal(await ui.evaluate("globalThis.__coloredButton===document.querySelectorAll('.taxi-command-bar .taxi-button')[1]"),true);
      const beforeColumn=panel.panel.viewColumn;
      await explorer.formPreview.receive(view,panel,{type:'detach'});
      await until(() => view.frames.get('preview')?.ready,'colored button detached');
      const detached = view.frames.get('preview');
      const columns=()=>({beforeColumn,main:{column:panel.panel.viewColumn,active:panel.panel.active,visible:panel.panel.visible},preview:{column:detached.panel.viewColumn,active:detached.panel.active,visible:detached.panel.visible},groups:vscode.window.tabGroups.all.map(group=>({column:group.viewColumn,active:group.isActive,tabs:group.tabs.map(tab=>({main:tab.label===panel.panel.title,preview:tab.label===detached.panel.title,active:tab.isActive,type:tab.input?.viewType??tab.input?.constructor?.name}))}))});
      if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`detached-columns-${vscode.env.language}.json`),JSON.stringify(columns()));
      let floating;
      try { floating=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}}); }
      catch(error) {error.message+=' '+JSON.stringify(columns());throw error;}
      await until(async () => await ready(floating) && await bitmap(floating) === expected.glyphRgbSha256,'colored bitmap in detached window');
      await floating.evaluate("globalThis.__coloredButton=document.querySelectorAll('.taxi-command-bar .taxi-button')[1]");
      await change(changed,floating,red.glyphRgbSha256);
      await change(original,floating,expected.glyphRgbSha256);
      assert.equal(await floating.evaluate("globalThis.__coloredButton===document.querySelectorAll('.taxi-command-bar .taxi-button')[1]"),true);
      floating.close();detached.panel.dispose();
    }
    assert.deepEqual(await fs.readFile(form.path),before);
    ui.close();panel.panel.dispose();
    await until(() => explorer.formPreview.views.size === 0,'colored button session released');
    await Promise.all([...explorer.formPreview.closing]);
  }
  await explorer.shutdown();
  const report = {passed:true,locale:vscode.env.language,sourceWritesDuringViewing:false,dirtyBackgroundNativePixels:true,
    detachedBackgroundUpdates:true,primaryButtonAccepted:false,wholeFormVisualParity:false,results};
  if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`button-colors-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
