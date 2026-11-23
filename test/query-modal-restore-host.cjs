const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, parentTabs, returned, closeQueryTabs, waitForQueryCheckpoint } = require('./query-modal-host.cjs');
const { connectWorkbench } = require('./query-constructor-dom.cjs');

/** Drive the restored native editor without reopening its query command or unlocking it. */
async function typeQuery(ui, draft, text) {
  await vscode.window.showTextDocument(draft, { preview: false });
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  if (ui) {
    await ui.focus();
    await ui.key('a', 'KeyA', 65, 2);
    await ui.typeText(text);
  } else {
    await vscode.commands.executeCommand('editor.action.selectAll');
    await vscode.commands.executeCommand('type', { text });
  }
  await until(() => draft.getText().replaceAll('\r\n', '\n') === text && draft.isDirty,
    'native keyboard input changes the restored query under global readonly rules');
}

/** Normal hot exit preserves a dirty query, whose restored native editor accepts input and Ctrl+S. */
exports.run = async function () {
  assert.ok(process.env.ESKA_HOST_RESTART && process.env.ESKA_TEST_VSIX);
  assert.equal(vscode.env.language, process.env.ESKA_HOST_LOCALE);
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  assert.equal(await extension.activate(), undefined, 'ordinary installed window exports no test controller');
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), uri = vscode.Uri.file(fixture.module);
  const marker = path.join(fixture.root, 'modal-recovery.json');
  const files = vscode.workspace.getConfiguration('files', uri);
  const accepted = [];
  let ui;
  try {
    if (process.env.ESKA_HOST_DEBUG_PORT) ui = await connectWorkbench(until);
    const backendReady = async () => /^ESKA v[0-9.]+$/.test(await ui.evaluate('[...document.querySelectorAll(".statusbar-item")].find(node=>node.id.endsWith("eska.explorer.connection"))?.textContent.trim() ?? ""'));
    if (process.env.ESKA_HOST_RUN === '0') {
      if (ui) await until(backendReady, 'backend ready for initial query open');
      await files.update('readonlyInclude', { '**/*.bsl': true, '**/*.os': true, '**/*.sdbl': true }, vscode.ConfigurationTarget.Global);
      const settings = JSON.stringify(files.inspect('readonlyInclude'));
      const owner = await vscode.workspace.openTextDocument(uri), original = owner.getText(), disk = await fs.readFile(fixture.module);
      const editor = await vscode.window.showTextDocument(owner, { preview: false });
      const at = owner.positionAt(original.indexOf('SELECT ') + 3); editor.selection = new vscode.Selection(at, at);
      await vscode.commands.executeCommand('eska.explorer.editBslQuery');
      const draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query'
        && vscode.window.activeTextEditor.document, 'query replaces parent before hot exit');
      await typeQuery(ui, draft, 'SELECT 6\nAS Value');
      await waitForQueryCheckpoint(fixture, draft);
      assert.equal(parentTabs(uri).length, 0); assert.deepEqual(await fs.readFile(fixture.module), disk);
      assert.equal(JSON.stringify(files.inspect('readonlyInclude')), settings);
      await fs.writeFile(marker, JSON.stringify({ uri: draft.uri.toString(), draft: draft.getText(), original, settings, disk: disk.toString('hex') }));
      accepted.push('readonly_query_native_input_checkpointed_before_real_hot_exit');
    } else {
      const checkpoint = JSON.parse(await fs.readFile(marker, 'utf8'));
      const draft = await until(() => vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === checkpoint.uri)?.document,
        'normal workbench restores modal query');
      assert.equal(draft.getText(), checkpoint.draft); assert.equal(parentTabs(uri).length, 0);
      let owner = await vscode.workspace.openTextDocument(uri);
      assert.equal(owner.getText(), checkpoint.original, 'restoration does not write its source');
      await typeQuery(ui, draft, 'SELECT 7\nAS Value');
      if (ui) {
        await until(backendReady, 'backend ready for restored query Save');
        await ui.key('s', 'KeyS', 83, 2);
      } else await vscode.commands.executeCommand('workbench.action.files.save');
      const expected = Buffer.from('\ufeff' + checkpoint.original.replace('SELECT 1', 'SELECT 7'));
      await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(expected), 'restored native Ctrl+S persists exact source bytes');
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), checkpoint.uri);
      assert.equal(JSON.stringify(files.inspect('readonlyInclude')), checkpoint.settings);
      accepted.push('restored_query_accepts_keyboard_and_ctrl_s_without_reopen_or_unlock');
      if (process.env.ESKA_HOST_QUERY_AUTOSAVE === '1') {
        await files.update('autoSaveDelay', 500, vscode.ConfigurationTarget.Global);
        await files.update('autoSave', 'afterDelay', vscode.ConfigurationTarget.Global);
        await typeQuery(ui, draft, 'SELECT 8\nAS Value');
        const autoExpected = Buffer.from('\ufeff' + checkpoint.original.replace('SELECT 1', 'SELECT 8'));
        await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(autoExpected), 'native query autosave persists the exact source without Ctrl+S');
        assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), checkpoint.uri);
        assert.equal(JSON.stringify(files.inspect('readonlyInclude')), checkpoint.settings);
        accepted.push('native_after_delay_autosave_persists_exact_source_and_retains_query_focus');
        await files.update('autoSave', 'off', vscode.ConfigurationTarget.Global);
      }
      await closeQueryTabs(draft);
      owner = await returned(uri);
      assert.equal(owner.isDirty, false);
      const before = owner.getText();
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await vscode.commands.executeCommand('type', { text: 'x' });
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(owner.getText(), before, 'native owner remains readonly after restored query closes');
    }
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'query-modal-native-recovery',
      run: process.env.ESKA_HOST_RUN, locale: vscode.env.language, installedNormalProcesses: true, accepted }));
  } catch (error) {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, suite: 'query-modal-native-recovery',
      error: String(error.stack ?? error), run: process.env.ESKA_HOST_RUN, accepted,
      active: vscode.window.activeTextEditor && { uri: vscode.window.activeTextEditor.document.uri.toString(), text: vscode.window.activeTextEditor.document.getText(), dirty: vscode.window.activeTextEditor.document.isDirty } }));
    throw error;
  } finally { ui?.close(); }
};
