const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, editFormSource } = require('./webview-host.cjs');

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
const linuxGaps = {
  ColumnsFF:[60,60],ColumnsFT:[64,32],ColumnsTF:[60,92],ColumnsTT:[60,32],
  NestedFF:[60,60],NestedFT:[60,92],
};

function columnsMatch(boxes, united) {
  if (!boxes || boxes.A1.x !== boxes.B1.x) return false;
  if (united) return boxes.A2.x < boxes.B2.x && boxes.B1.width > boxes.A1.width;
  return boxes.A2.x === boxes.B2.x && boxes.A1.width === boxes.B1.width && boxes.A2.width === boxes.B2.width;
}

function verifyColumns(kind, boxes) {
  const united = kind === 'RowsT';
  assert.ok(columnsMatch(boxes, united), kind + ' native column partition');
  assert.equal(boxes.A1.y, boxes.A2.y);
  assert.equal(boxes.B1.y, boxes.B2.y);
  if (process.platform === 'linux') {
    const relative = Object.values(boxes).map(box => [box.x - boxes.A1.x, box.y - boxes.A1.y, box.width, box.height]);
    const expected = united
      ? [[0, 0, 131, 51], [216, 0, 151, 23], [0, 60, 367, 23], [395, 60, 101, 23]]
      : [[0, 0, 191, 51], [276, 0, 151, 23], [0, 60, 191, 23], [276, 60, 151, 23]];
    assert.deepEqual(relative, expected, kind + ' native field rectangles');
  }
}

async function verifyMixedRow(ui, view, document, original, keys) {
  const right = original.match(/<UsualGroup name="Right"[^>]*>[\s\S]+?<\/UsualGroup>/u)?.[0];
  const field = right?.match(/<InputField name="B1"[^>]*>[\s\S]+?<\/InputField>/u)?.[0];
  assert.ok(field, 'fixture has a standalone field to reuse beside the left group');
  const mixed = original.replace(right, field);
  const selection = { A1: keys.A1, A2: keys.A2, B1: keys.B1 };
  await editFormSource(document, view, mixed);
  await until(async () => {
    const boxes = await measure(ui, selection);
    return boxes && Math.abs(boxes.A1.y - boxes.B1.y) <= 2 && boxes.B1.y + boxes.B1.height < boxes.A2.y;
  }, 'a standalone field aligns with the first row of a separated group');
  await editFormSource(document, view, mixed.replace('<United>false</United>', '<United>true</United>'));
  await until(async () => {
    const boxes = await measure(ui, selection);
    return boxes && boxes.B1.y > boxes.A1.y + 2;
  }, 'a united group aligns as a single box');
}

async function editColumns(service, view, main, ui, keys, document) {
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'detached columns ready');
  const preview = view.frames.get('preview');
  const floating = await frame({ detached: true, state: { title: preview.panel.title } });
  const native = await floating.nativeWindow({ detached: true });
  assert.notEqual(native.targetId, workbench.targetId);
  await until(async () => columnsMatch(await measure(floating, keys), false), 'detached columns align');
  await floating.evaluate("globalThis.__columnElements = [...document.querySelectorAll('.taxi-element')];true");
  const revision = view.snapshot.revision;
  for (const [width, height] of [[430, 310], [960, 640]]) {
    await floating.evaluate(`Object.assign(document.querySelector('#root').style, {width:'${width}px',height:'${height}px'});true`);
    await floating.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await until(async () => columnsMatch(await measure(floating, keys), false), 'column tracks remain shared after resize');
    assert.equal(view.snapshot.revision, revision);
  }
  const setting = '<United>false</United>';
  const source = document.getText();
  const start = source.indexOf(setting, source.indexOf('<UsualGroup name="Left"'));
  assert.ok(start >= 0);
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(document.positionAt(start), document.positionAt(start + setting.length));
  edit.replace(document.uri, range, '<United>true</United>');
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await until(async () => columnsMatch(await measure(floating, keys), true), 'dirty United consumes one column track');
  assert.equal(await floating.evaluate('__columnElements.every(node => node.isConnected)'), true);
  await floating.screenshot('united-columns-dirty-' + vscode.env.language + '.png');
  await service.receive(view, preview, { type: 'dock' });
  await until(() => !view.frames.has('preview'), 'columns returned to workbench');
  await until(async () => columnsMatch(await measure(ui, keys), true), 'updated columns remain after return');
}

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
    if (input.kind === 'RowsF' || input.kind === 'RowsT') {
      verifyColumns(input.kind, boxes);
      results.push({ kind: input.kind, boxes });
      if (input.kind === 'RowsF') await editColumns(service, view, main, ui, keys, document);
      assert.deepEqual(await fs.readFile(input.path), before);
      main.panel.dispose();
      await until(() => service.views.size === 0, input.kind + ' released');
      await Promise.all([...service.closing]);
      continue;
    }
    assert.ok(Math.abs(boxes.A1.y - boxes.B1.y) <= 2, input.kind + ' first row');
    if (['ColumnsFF','NestedFF'].includes(input.kind)) assert.ok(sameRow(boxes),input.kind);
    else if (['ColumnsTF','NestedFT'].includes(input.kind)) assert.ok(belowLeft(boxes),input.kind);
    else assert.ok(boxes.B2.y < boxes.A2.y,input.kind);
    const currentWidths = [boxes.A1.width,boxes.A2.width,boxes.B1.width,boxes.B2.width];
    widths ??= currentWidths;
    assert.deepEqual(currentWidths,widths,input.kind+' preserves natural column widths');
    const leftGap = boxes.A2.y-boxes.A1.y, rightGap = boxes.B2.y-boxes.B1.y;
    const horizontalGap = boxes.B1.x-boxes.A1.x;
    if (process.platform === 'linux') {
      assert.deepEqual([leftGap,rightGap],linuxGaps[input.kind],input.kind+' native row distances');
      assert.equal(horizontalGap,349,input.kind+' native column offset');
      assert.deepEqual(currentWidths,[151,151,191,191],input.kind+' native input widths');
    }
    results.push({kind:input.kind,leftGap,rightGap,horizontalGap,widths:currentWidths});
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
      main.panel.reveal();
      await verifyMixedRow(ui, view, document, before.toString('utf8'), keys);
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
