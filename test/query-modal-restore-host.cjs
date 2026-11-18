const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, replace, parentTabs, returned, closeQueryTabs, waitForQueryCheckpoint } = require('./query-modal-host.cjs');

/** Normal hot exit must restore the query without automatically changing its source. */
exports.run = async function () {
  assert.ok(process.env.ESKA_HOST_RESTART && process.env.ESKA_TEST_VSIX);
  assert.equal(vscode.env.language, process.env.ESKA_HOST_LOCALE);
  await vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer').activate();
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), uri = vscode.Uri.file(fixture.module);
  const marker = path.join(fixture.root, 'modal-recovery.json');
  await vscode.commands.executeCommand('eska.explorer.restart');
  if (process.env.ESKA_HOST_RUN === '0') {
    const owner = await vscode.workspace.openTextDocument(uri), original = owner.getText(), disk = await fs.readFile(fixture.module);
    const editor = await vscode.window.showTextDocument(owner, { preview: false });
    const at = owner.positionAt(original.indexOf('SELECT ') + 3); editor.selection = new vscode.Selection(at, at);
    await vscode.commands.executeCommand('eska.explorer.editBslQuery');
    const draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query'
      && vscode.window.activeTextEditor.document, 'query replaces parent before hot exit');
    await replace(draft, 'SELECT 1', 'SELECT 6');
    await waitForQueryCheckpoint(fixture, draft);
    assert.equal(parentTabs(uri).length, 0); assert.deepEqual(await fs.readFile(fixture.module), disk);
    await fs.writeFile(marker, JSON.stringify({ uri: draft.uri.toString(), draft: draft.getText(), original, disk: disk.toString('hex') }));
  } else {
    const checkpoint = JSON.parse(await fs.readFile(marker, 'utf8'));
    let draft = await until(() => vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === checkpoint.uri)?.document,
      'normal workbench restores modal query');
    assert.equal(draft.getText(), checkpoint.draft); assert.equal(parentTabs(uri).length, 0);
    let owner = await vscode.workspace.openTextDocument(uri);
    assert.equal(owner.getText(), checkpoint.original, 'opening recovered query does not write its source');
    await vscode.window.showTextDocument(draft, { preview: false });
    assert.equal(await draft.save(), true);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), checkpoint.uri);
    await closeQueryTabs(draft);
    owner = await returned(uri);
    assert.equal(owner.getText(), checkpoint.original.replace('SELECT 1', 'SELECT 6')); assert.equal(owner.isDirty, false);
    assert.notEqual((await fs.readFile(fixture.module)).toString('hex'), checkpoint.disk);
    await vscode.commands.executeCommand('undo'); assert.equal(owner.getText(), checkpoint.original);
  }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'query-modal-native-recovery',
    run: process.env.ESKA_HOST_RUN, locale: vscode.env.language, installedNormalProcesses: true }));
};
