const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

async function replace(document, from, to) {
  const text = document.getText(); assert.ok(text.includes(from));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), text.replaceAll(from, to));
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), files = fixture.form;
  const paths = [files.path, ...Object.values(files.styles), path.join(fixture.root, 'eska.toml'),
    path.join(fixture.source, 'Configuration.xml'), path.join(fixture.source, 'CommonForms', 'Preview.xml')];
  const before = await Promise.all(paths.map(file => fs.readFile(file)));
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const source = await vscode.workspace.openTextDocument(vscode.Uri.file(files.path));
  await vscode.window.showTextDocument(source, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => [...service.views.values()][0]?.phase === 'ready', 'open form with FontA');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'detached dependency preview');
  const ui = await frame({ state: { title: view.frames.get('preview').panel.title } });
  await until(async () => await ui.evaluate("!!document.querySelector('.taxi-input')"), 'input visible');
  await ui.evaluate("globalThis.__dependencyInput=document.querySelector('.taxi-input');globalThis.__dependencyModels=[];window.addEventListener('message',event=>{if(event.data.type==='state'&&event.data.model)globalThis.__dependencyModels.push(event.data.model.root.children[0].children[0].presentation.font.points)})");
  const points = () => view.snapshot.model.root.children[0].children[0].presentation.font.points;
  assert.equal(points(), 12);
  const b = await vscode.workspace.openTextDocument(vscode.Uri.file(files.styles.FontB));
  await replace(b, 'height="12"', 'height="16"');
  assert.equal(view.inputs.has(files.styles.FontB), false, 'new dirty style is initially unrelated');
  await replace(source, 'style:FontA', 'style:FontB');
  await until(() => view.phase === 'ready' && points() === 16, 'new dependency uses its existing dirty buffer');
  await until(async () => await ui.evaluate('globalThis.__dependencyModels.at(-1)===16'), 'new dirty model reaches the renderer');
  assert.deepEqual(await ui.evaluate('globalThis.__dependencyModels'), [16], 'no disk-only intermediate model is published');
  const a = await vscode.workspace.openTextDocument(vscode.Uri.file(files.styles.FontA));
  await replace(a, 'height="12"', 'height="14"');
  await replace(source, 'style:FontB', 'style:FontA');
  await until(() => view.phase === 'ready' && points() === 14, 'dirty prior dependency returns without a foreign-overlay error');
  assert.equal(view.inputs.has(files.styles.FontB), false, 'retired style leaves the input set');
  await replace(b, 'height="16"', 'height="18"');
  assert.equal(points(), 14);
  await replace(source, 'style:FontA', 'style:FontB');
  await until(() => view.phase === 'ready' && points() === 18, 'latest detached dirty style returns');
  await until(async () => await ui.evaluate('globalThis.__dependencyModels.at(-1)===18'), 'returned dirty model reaches the renderer');
  const c = await vscode.workspace.openTextDocument(vscode.Uri.file(files.styles.FontC));
  await replace(c, 'height="12"', 'height="22"');
  const originalB = 'ref="sys:DefaultGUIFont" height="18" kind="WindowsFont"';
  const nestedB = 'xmlns:style="http://v8.1c.ru/8.1/data/ui/style" ref="style:FontC" kind="StyleItem"';
  await ui.evaluate('globalThis.__dependencyModels=[]');
  await replace(b, originalB, nestedB);
  await until(() => view.phase === 'ready' && points() === 22, 'a dirty resource discovers another dirty resource');
  await until(async () => await ui.evaluate('globalThis.__dependencyModels.at(-1)===22'), 'nested dirty model reaches the renderer');
  assert.deepEqual(await ui.evaluate('globalThis.__dependencyModels'), [22], 'nested dependency settles before publication');
  const validC = c.getText();
  await replace(c, validC, '<broken');
  await until(() => view.phase === 'stale', 'invalid dirty metadata retains the last good model');
  assert.equal(points(), 22);
  await replace(c, '<broken', validC);
  await until(() => view.phase === 'ready' && points() === 22, 'corrected dirty metadata recovers');
  await replace(b, nestedB, originalB);
  await until(() => view.phase === 'ready' && points() === 18, 'nested dirty dependency can retire');
  await until(async () => await ui.evaluate('globalThis.__dependencyModels.at(-1)===18'), 'retired dependency model reaches the renderer');
  assert.equal(view.inputs.has(files.styles.FontC), false);
  const validA = a.getText();
  await replace(a, validA, '<broken');
  await ui.evaluate('globalThis.__dependencyModels=[]');
  await replace(source, 'style:FontB', 'style:FontA');
  await until(() => view.phase === 'stale', 'invalid newly discovered dirty metadata retains the displayed model');
  assert.equal(points(), 18);
  assert.deepEqual(await ui.evaluate('globalThis.__dependencyModels'), [], 'a successful discovery pass is not published after dirty validation fails');
  await replace(a, '<broken', validA);
  await until(() => view.phase === 'ready' && points() === 14, 'newly discovered dirty metadata recovers');
  await until(async () => await ui.evaluate('globalThis.__dependencyModels.at(-1)===14'), 'recovered dirty model reaches the renderer');
  assert.equal(await ui.evaluate("globalThis.__dependencyInput===document.querySelector('.taxi-input')"), true);
  assert.equal(source.isDirty && a.isDirty && b.isDirty && c.isDirty, true);
  assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(file))), before);
  await ui.screenshot(`form-dependencies-${vscode.env.language}.png`);
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, formDependencies: true, locale: vscode.env.language,
    newDirtyDependency: true, retiredDirtyDependency: true, nestedDirtyDependency: true, invalidMetadataRecovery: true,
    atomicModelPublication: true, failedDiscoveryRetainsDisplayedModel: true, detached: true, stableDom: true, sourceWritesDuringViewing: false }));
};
