const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), file = fixture.form.path;
  const before = await fs.readFile(file);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, { preview:false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => service.views.size === 1 && [...service.views.values()][0].phase === 'ready', 'initial form ready');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'detached view ready');
  const preview = view.frames.get('preview'), ui = await frame({detached:true,state:{title:preview.panel.title}});
  await until(async () => await ui.evaluate("!!document.querySelector('.taxi-input')"), 'detached DOM ready');
  await ui.evaluate("globalThis.__reconnectRoot=document.querySelector('.taxi-form-frame');document.querySelector('.taxi-input').click()");
  await until(() => view.selected?.key.value === '2', 'selection shared with extension host');
  async function replace(from, to) {
    const text = document.getText(); assert.ok(text.includes(from));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), text.replace(from, to));
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  }
  const caption = value => ui.evaluate(`document.querySelector('.taxi-label')?.textContent === ${JSON.stringify(value)}`);
  await replace('First page', 'Unsaved before disconnect');
  await until(async () => view.phase === 'ready' && await caption('Unsaved before disconnect'), 'dirty form ready');
  const initialClient = view.client, initialPid = explorer.connection.child.child.pid;
  await vscode.commands.executeCommand('eska.explorer.disconnect');
  assert.equal(view.phase, 'disconnected'); assert.equal(view.watchers.length, 0); assert.equal(view.client, undefined);
  assert.equal(await caption('Unsaved before disconnect'), true, 'last model remains visible while disconnected');
  assert.equal(document.isDirty, true);
  await vscode.commands.executeCommand('eska.explorer.connect');
  await until(async () => view.phase === 'ready' && await caption('Unsaved before disconnect'), 'reconnect restores dirty input');
  assert.notEqual(view.client, initialClient);
  assert.notEqual(explorer.connection.child.child.pid, initialPid, 'reconnect starts a different backend process');
  assert.throws(() => process.kill(initialPid, 0), error => error.code === 'ESRCH');
  assert.equal(service.views.size, 1); assert.equal(view.frames.get('main'), main); assert.equal(view.frames.get('preview'), preview);
  const connection = explorer.connection, request = connection.request.bind(connection);
  let release, held;
  const gate = new Promise(resolve => { release = resolve; });
  connection.request = async (...args) => {
    const result = await request(...args);
    if (!held && args[1] === 'form/update') { held = result; await gate; }
    return result;
  };
  await replace('Unsaved before disconnect', 'Obsolete pending response');
  await until(() => held !== undefined, 'actual old backend update held');
  await replace('Obsolete pending response', 'Latest after restart');
  await ui.evaluate("globalThis.__obsoletePublished=false;window.addEventListener('message',e=>{if(e.data?.type==='state'&&e.data.model&&JSON.stringify(e.data.model).includes('Obsolete pending response'))globalThis.__obsoletePublished=true})");
  const previousClient = view.client, previousPid = connection.child.child.pid;
  const restarting = vscode.commands.executeCommand('eska.explorer.restart');
  await until(() => view.suspended && view.phase === 'disconnected', 'restart suspends visible form');
  release(); await restarting;
  connection.request = request;
  await until(async () => view.phase === 'ready' && await caption('Latest after restart'), 'latest dirty XML reopened in replacement backend');
  assert.notEqual(view.client, previousClient);
  assert.notEqual(connection.child.child.pid, previousPid, 'restart replaces the backend process');
  assert.throws(() => process.kill(previousPid, 0), error => error.code === 'ESRCH');
  assert.equal(view.selected.key.value, '2');
  assert.equal(await ui.evaluate("globalThis.__reconnectRoot===document.querySelector('.taxi-form-frame')"), true);
  assert.equal(await ui.evaluate('globalThis.__obsoletePublished'), false, 'late old response never becomes the displayed model');
  assert.equal(service.views.size, 1); assert.equal(view.frames.size, 2);
  assert.equal(document.isDirty, true); assert.deepEqual(await fs.readFile(file), before);
  await ui.screenshot(`form-reconnect-${vscode.env.language}.png`);
  ui.close();
  await explorer.shutdown();
  assert.equal(service.views.size, 0); assert.equal(service.closing.size, 0);
  await fs.writeFile(path.join(fixture.root,'host-result.json'), JSON.stringify({passed:true,formReconnect:true,locale:vscode.env.language,
    disconnectedModelRetained:true,dirtyPreserved:true,lateResponseSuppressed:true,detached:true,selectionRetained:true,stableDom:true,sourceWritesDuringViewing:false}));
};
