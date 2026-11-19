const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, returned, closeQueryTabs } = require('./query-modal-host.cjs');

/** Exercise native editor permissions, typing and Ctrl+S's command, never a provider write shortcut. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const accepted = [], errors = [];
  try {
    const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
    assert.ok(extension);
    const title = extension.packageJSON.contributes.commands.find(value => value.command === 'eska.explorer.editBslQuery')?.title;
    assert.equal(title?.value ?? title, vscode.env.language === 'ru' ? 'Открыть запрос отдельно' : 'Open Query Separately');
    const explorer = await extension.activate();
    await until(() => explorer.tree && explorer.connection.state.kind === 'ready' && !explorer.support.loading, 'backend ready');
    const explain = explorer.queries.explain.bind(explorer.queries);
    explorer.queries.explain = error => { errors.push({ code: error.code, domain: error.domain, details: error.details }); explain(error); };
    const ownerUri = vscode.Uri.file(fixture.module);
    const files = vscode.workspace.getConfiguration('files', ownerUri);
    const initial = await fs.readFile(fixture.module);
    assert.deepEqual([...initial.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(initial.toString('utf8').includes('\r\n'));
    const unrelated = path.join(fixture.root, 'ReadonlyUnrelated.bsl');
    const unrelatedBytes = Buffer.from('\ufeff// unrelated\r\nOther = 99;\r\n');
    await fs.writeFile(unrelated, unrelatedBytes);
    let expected = initial.toString('utf8');
    let selected = '1';
    for (const scenario of [
      { name: 'query_only_native_unlock', rules: { '**/*.bsl': true, '**/*.sdbl': true }, next: '2' },
      { name: 'both_native_unlocks', rules: { '**/*.bsl': true, '**/*.sdbl': true }, parentUnlock: true, next: '3' },
      { name: 'owner_only_rule_is_inherited', rules: { '**/*.bsl': true }, next: '4' },
      { name: 'no_readonly_rules', next: '5' },
    ]) {
      await files.update('readonlyInclude', scenario.rules, vscode.ConfigurationTarget.Global);
      await explorer.tree.synchronizeInputs();
      const settingsBefore = JSON.stringify(files.inspect('readonlyInclude'));
      const owner = await vscode.workspace.openTextDocument(ownerUri);
      await vscode.window.showTextDocument(owner, { preview: false });
      await vscode.commands.executeCommand('workbench.action.files.resetActiveEditorReadonlyInSession');
      if (scenario.parentUnlock) await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession');
      const startOfQuery = owner.getText().indexOf('SELECT ' + selected);
      assert.ok(startOfQuery >= 0, 'owner contains the current query');
      const at = owner.positionAt(startOfQuery + 3);
      await vscode.window.showTextDocument(owner, { preview: false, selection: new vscode.Range(at, at) });
      await vscode.commands.executeCommand('eska.explorer.editBslQuery');
      const draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query'
        && vscode.window.activeTextEditor.document, 'query editor opened');
      const editor = vscode.window.activeTextEditor;
      editor.selection = new vscode.Selection(draft.positionAt(0), draft.positionAt(0));
      if (scenario.rules) {
        const before = draft.getText();
        await vscode.commands.executeCommand('type', { text: 'blocked' });
        assert.equal(draft.getText(), before, 'configured readonly query initially rejects native typing');
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession');
      }
      const start = draft.getText().indexOf('SELECT ' + selected);
      assert.ok(start >= 0);
      editor.selection = new vscode.Selection(draft.positionAt(start), draft.positionAt(start + ('SELECT ' + selected).length));
      await vscode.commands.executeCommand('type', { text: 'SELECT ' + scenario.next });
      assert.ok(draft.getText().includes('SELECT ' + scenario.next), 'native query typing succeeds after unlock');
      assert.equal(draft.isDirty, true);
      await vscode.commands.executeCommand('workbench.action.files.save');
      expected = expected.replace('SELECT ' + selected, 'SELECT ' + scenario.next);
      await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(Buffer.from(expected)),
        'native Save persists the correct BSL with BOM, CRLF and unrelated text intact: ' + scenario.name);
      assert.equal(vscode.window.activeTextEditor?.document, draft, 'Save keeps query focus');
      assert.ok(!vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === ownerUri.toString())), 'clean owner stays hidden during query session');
      await closeQueryTabs(draft);
      const parent = await returned(ownerUri);
      await until(() => explorer.queries.sessions.size === 0, 'closed query releases its source');
      assert.equal(parent.getText(), expected.slice(1), 'returned parent reloads persisted source');
      assert.equal(parent.isDirty, false);
      const end = parent.positionAt(parent.getText().length);
      vscode.window.activeTextEditor.selection = new vscode.Selection(end, end);
      const parentBefore = parent.getText();
      await vscode.commands.executeCommand('type', { text: 'x' });
      assert.equal(parent.getText(), parentBefore + 'x', 'returned parent accepts native typing');
      await vscode.commands.executeCommand('undo');
      assert.equal(parent.getText(), parentBefore);
      assert.deepEqual(await fs.readFile(fixture.module), Buffer.from(expected));
      assert.deepEqual(await fs.readFile(unrelated), unrelatedBytes);
      assert.equal(JSON.stringify(files.inspect('readonlyInclude')), settingsBefore, 'query lifecycle preserves user/workspace readonly settings');
      await vscode.window.showTextDocument(vscode.Uri.file(unrelated), { preview: false });
      const unrelatedDocument = vscode.window.activeTextEditor.document;
      const before = unrelatedDocument.getText();
      if (scenario.rules) {
        await vscode.commands.executeCommand('type', { text: 'blocked' });
        assert.equal(unrelatedDocument.getText(), before, 'query unlock never grants unrelated BSL write access');
      }
      selected = scenario.next;
      accepted.push(scenario.name);
    }
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, accepted, locale: vscode.env.language }));
  } catch (error) {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, accepted, errors, error: String(error.stack ?? error) }));
    throw error;
  }
};
