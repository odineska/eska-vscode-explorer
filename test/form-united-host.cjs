const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

const key = node => `${node.identity.source}:current:${node.identity.key.value}`;

function named(root, name) {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = named(child, name);
    if (found) return found;
  }
}

function measure(ui, keys) {
  return ui.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-element]')];
    const result = {};
    for (const [name, key] of Object.entries(${JSON.stringify(keys)})) {
      const element = items.find(item => item.dataset.element === key);
      if (!element) return null;
      const box = element.querySelector('.taxi-input').getBoundingClientRect();
      result[name] = {x:box.x,y:box.y,width:box.width,height:box.height};
    }
    return result;
  })()`);
}

const sameRow = boxes => Math.abs(boxes.A2.y - boxes.B2.y) <= 1;
const belowLeft = boxes => boxes.B2.y >= boxes.A2.y + boxes.A2.height;

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;
  const results = [];
  let widths;
  for (const input of fixture.formGallery) {
    const before = await fs.readFile(input.path);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(input.path));
    await vscode.window.showTextDocument(document, { preview:false, viewColumn:vscode.ViewColumn.One });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...service.views.values()].some(view => view.path === input.path && view.phase === 'ready'), input.kind);
    const view = [...service.views.values()].find(view => view.path === input.path);
    const main = view.frames.get('main');
    const root = view.snapshot.model.root;
    const keys = Object.fromEntries(['A1','A2','B1','B2'].map(name => [name,key(named(root,name))]));
    const ui = await frame({ fixedFormArea:true,state:{title:main.panel.title} });
    await until(async () => !!await measure(ui,keys), input.kind+' rendered');
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await until(() => ui.evaluate("document.querySelector('.taxi-preview')?.dataset.preferredX === 'true'"),input.kind+' preferred width');
    const boxes = await measure(ui,keys);
    assert.ok(Math.abs(boxes.A1.y - boxes.B1.y) <= 2, input.kind + ' first row');
    if (['ColumnsFF','NestedFF'].includes(input.kind)) assert.ok(sameRow(boxes),input.kind);
    else if (['ColumnsTF','NestedFT'].includes(input.kind)) assert.ok(belowLeft(boxes),input.kind);
    else assert.ok(boxes.B2.y < boxes.A2.y,input.kind);
    const currentWidths = [boxes.A1.width,boxes.A2.width,boxes.B1.width,boxes.B2.width];
    widths ??= currentWidths;
    assert.deepEqual(currentWidths,widths,input.kind+' preserves natural column widths');
    results.push({kind:input.kind,leftGap:boxes.A2.y-boxes.A1.y,rightGap:boxes.B2.y-boxes.B1.y,widths:currentWidths});
    if (input.kind === 'ColumnsFF') {
      const left = key(named(root,'Left'));
      await ui.evaluate(`document.getElementById(${JSON.stringify('form-row-'+left)}).click()`);
      await until(() => ui.evaluate(`document.querySelector('[data-palette-id="platform:United"] input')?.checked===false`), 'false in property palette');
      const mainWindow = await ui.nativeWindow();
      await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
      await until(() => view.frames.get('preview')?.ready,'detached view ready');
      const preview = view.frames.get('preview');
      const floating = await frame({detached:true,state:{title:preview.panel.title}});
      const native = await floating.nativeWindow({detached:true});
      assert.notEqual(native.targetId,mainWindow.targetId);
      await until(async () => { const value=await measure(floating,keys); return value && sameRow(value); },'aligned in separate window');
      await floating.evaluate("globalThis.__unitedNodes=[...document.querySelectorAll('.taxi-element')];true");
      const initialRevision = view.snapshot.revision;
      for (const [width,height] of [[460,300],[920,640]]) {
        await floating.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
        await floating.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        await until(async () => { const value=await measure(floating,keys); return value && sameRow(value); },'rows share after resize');
        assert.equal(view.snapshot.revision,initialRevision);
      }
      const text = document.getText(), setting = '<United>false</United>', at = text.indexOf(setting);
      assert.ok(at >= 0);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(at),document.positionAt(at+setting.length)), '<United>true</United>');
      assert.equal(await vscode.workspace.applyEdit(edit),true);
      await until(async () => { const value=await measure(floating,keys); return value && belowLeft(value); },'dirty United in floating window');
      await until(() => ui.evaluate(`document.querySelector('[data-palette-id="platform:United"] input')?.checked===true`), 'true in main property palette');
      assert.equal(await floating.evaluate("__unitedNodes.every(node=>node.isConnected)"),true);
      await floating.screenshot('united-dirty-floating-'+vscode.env.language+'.png');
      preview.panel.dispose();
    }
    assert.deepEqual(await fs.readFile(input.path),before);
    main.panel.dispose();
    await until(() => service.views.size === 0,input.kind+' released');
    await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({
    passed:true,locale:vscode.env.language,results,dirtyDetached:true,sourceWritesDuringViewing:false,
  }));
};
