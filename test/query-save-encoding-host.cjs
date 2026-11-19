const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, returned, closeQueryTabs } = require('./query-modal-host.cjs');
const { connectWorkbench } = require('./query-constructor-dom.cjs');

/** Installed-window regression: native input and actual Ctrl+S, without private provider access. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), accepted = [];
  let ui;
  try {
    assert.equal(process.env.ESKA_HOST_NORMAL, '1', 'requires an ordinary installed window');
    assert.ok(process.env.ESKA_TEST_VSIX, 'requires the installed VSIX');
    const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
    assert.equal(await extension.activate(), undefined, 'normal mode exports no test controller');
    ui = await connectWorkbench(until);
    await until(async () => /^ESKA v[0-9.]+$/.test(await ui.evaluate('[...document.querySelectorAll(".statusbar-item")].find(node=>node.id.endsWith("eska.explorer.connection"))?.textContent.trim() ?? ""')), 'backend ready');
    const uri = vscode.Uri.file(fixture.module), original = await fs.readFile(fixture.module);
    let expected = original.toString('utf8'), previous = 'SELECT 1\r\n|AS Value';
    const files = vscode.workspace.getConfiguration('files');
    // Parent participants are deliberately separate from query participants: a source plan owns exact output.
    await files.update('trimTrailingWhitespace', false, vscode.ConfigurationTarget.Global);
    await files.update('insertFinalNewline', false, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('editor').update('formatOnSave', false, vscode.ConfigurationTarget.Global);
    for (const scenario of [
      { name: 'utf8', global: 'utf8', query: 'utf8' },
      { name: 'utf8bom_repeated_ctrl_s', global: 'utf8bom', query: 'utf8bom' },
      { name: 'windows1251_query_unicode_native_model', global: 'utf8', query: 'windows1251', unicode: true },
      { name: 'global_windows1251_initial_virtual_read', global: 'windows1251' },
    ]) {
      await files.update('encoding', scenario.global, vscode.ConfigurationTarget.Global);
      let owner = await vscode.workspace.openTextDocument(uri, { encoding: 'utf8bom' });
      const editor = await vscode.window.showTextDocument(owner, { preview: false });
      const at = owner.positionAt(owner.getText().indexOf('SELECT ') + 3);
      editor.selection = new vscode.Selection(at, at);
      await vscode.commands.executeCommand('eska.explorer.editBslQuery');
      let draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query' && vscode.window.activeTextEditor.document, 'query opens: ' + scenario.name);
      assert.ok(draft.getText().includes(previous.replaceAll('\r\n|', '\n').replaceAll('""', '"')), 'initial native query retains Russian text under configured encoding');
      if (scenario.query) {
        draft = await vscode.workspace.openTextDocument(draft.uri, { encoding: scenario.query });
        assert.equal(draft.encoding, scenario.query);
      }
      await vscode.window.showTextDocument(draft, { preview: false });
      for (let iteration = 0; iteration < 2; iteration++) {
        const number = accepted.length * 10 + iteration + 2;
        // The first edit ends exactly at the BSL continuation before an unchanged suffix.
        const alias = accepted.length === 0 && iteration === 0 ? 'Value' : 'Значение';
        const query = `SELECT ${number}\n    AS ${alias}${scenario.unicode ? ', "😀" AS Символ' : ''}`;
        await ui.focus();
        await ui.key('a', 'KeyA', 65, 2);
        await ui.typeText(query);
        await until(() => draft.getText().replaceAll('\r\n', '\n') === query && draft.isDirty, 'native typing updates query');
        await ui.key('s', 'KeyS', 83, 2);
        const literal = query.replaceAll('"', '""').replaceAll('\n', '\r\n|');
        expected = expected.replace(previous, literal);
        await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(Buffer.from(expected)), 'Ctrl+S persists exact UTF8 BOM owner bytes: ' + scenario.name + '/' + iteration);
        assert.equal(vscode.window.activeTextEditor?.document, draft, 'Ctrl+S retains query focus');
        assert.equal(draft.getText().replaceAll('\r\n', '\n'), query, 'save preserves the full Unicode native draft');
        previous = literal;
      }
      await closeQueryTabs(draft);
      owner = await returned(uri);
      assert.equal(owner.isDirty, false);
      assert.equal(owner.getText(), expected.slice(1));
      const bytes = await fs.readFile(fixture.module);
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.ok(bytes.toString('utf8').includes('// owner 😀\r\n'));
      assert.ok(bytes.toString('utf8').includes('Other = 42;\r\nSecond = "SELECT 9";'));
      accepted.push(scenario.name);
    }
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, locale: vscode.env.language, accepted, nativeCtrlS: true }));
  } catch (error) {
    const notifications = await ui?.evaluate('[...document.querySelectorAll(".notification-message")].map(node=>node.textContent)').catch(() => undefined);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, accepted, error: String(error.stack ?? error), notifications,
      active: vscode.window.activeTextEditor && { encoding: vscode.window.activeTextEditor.document.encoding, text: vscode.window.activeTextEditor.document.getText(), dirty: vscode.window.activeTextEditor.document.isDirty } }));
    throw error;
  } finally { ui?.close(); }
};
