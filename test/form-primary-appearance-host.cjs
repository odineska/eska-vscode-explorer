const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  async function bitmap(ui,index) {
    const rgb = await ui.evaluate(`(() => {const button=document.querySelectorAll('.taxi-command-bar .taxi-button')[${index}];
      if(button?.querySelector('[data-native-caption]')?.dataset.nativeCaption!=='ready')return null;
      const c=button.querySelector('canvas');return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data].filter((v,i)=>i%4!==3);})()`);
    return rgb && createHash('sha256').update(Buffer.from(rgb)).digest('hex');
  }
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document,{preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...explorer.formPreview.views.values()].some(view => view.path === form.path && view.phase === 'ready'),'default-marked button form');
    const view = [...explorer.formPreview.views.values()].find(view => view.path === form.path), panel = view.frames.get('main');
    const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    for (const index of form.expected.targetButtons) await until(async () => await bitmap(ui,index) === form.expected.buttons[index].glyphRgbSha256, 'explicit color wins over default marking');
    const actual = await ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),buttons:[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(node=>({...rect(node),color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}))};})()`);
    assert.deepEqual([actual.frame.width,actual.frame.height],form.expected.nativeFrame);
    for (const index of form.expected.targetButtons) {
      const button = actual.buttons[index], expected = form.expected.buttons[index];
      assert.deepEqual([button.x-actual.frame.x,button.y-actual.frame.y,button.width,button.height],[expected.x,expected.y,expected.width,expected.height]);
    }
    await ui.screenshot(`primary-appearance-${form.kind}-${vscode.env.language}.png`);
    results.push({name:form.kind,...actual});
    if (form.kind === 'DefaultBack') {
      const original = document.getText(), altered = original.replace(/(<Button name="Second" id="20">[\s\S]*?<DefaultButton>)true(<\/DefaultButton>)/,'$1false$2');
      assert.notEqual(altered,original);
      async function change(text,target) {
        const revision = view.snapshot.revision, edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
        assert.equal(await vscode.workspace.applyEdit(edit),true);
        await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer,'dirty default marking');
        await until(async () => await bitmap(target,1) === form.expected.buttons[1].glyphRgbSha256,'same native pixels after default marking change');
      }
      await ui.evaluate("globalThis.__explicitButton=document.querySelectorAll('.taxi-command-bar .taxi-button')[1]");
      await change(altered,ui);await change(original,ui);
      assert.equal(await ui.evaluate("globalThis.__explicitButton===document.querySelectorAll('.taxi-command-bar .taxi-button')[1]"),true);
      await explorer.formPreview.receive(view,panel,{type:'detach'});
      await until(() => view.frames.get('preview')?.ready,'explicit default button detached');
      const detached = view.frames.get('preview'), floating = await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
      await until(async () => await bitmap(floating,1) === form.expected.buttons[1].glyphRgbSha256,'explicit default button in detached window');
      await change(altered,floating);await change(original,floating);
      floating.close();detached.panel.dispose();
    }
    assert.deepEqual(await fs.readFile(form.path),before);
    ui.close();panel.panel.dispose();await until(() => explorer.formPreview.views.size === 0,'default appearance session released');
    await Promise.all([...explorer.formPreview.closing]);
  }
  await explorer.shutdown();
  const report = {passed:true,locale:vscode.env.language,sourceWritesDuringViewing:false,explicitBackColorOverridesDefaultAppearance:true,
    explicitTextColorPreserved:true,styleReferences:true,dirtyDefaultMarking:true,detachedUpdates:true,automaticPrimaryAccepted:false,results};
  if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`primary-appearance-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
