const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, returned, closeQueryTabs, queryWriteEvidence } = require('./query-modal-host.cjs');

/** Chat and native editor focus are independent of activeTextEditor in recent workbenches. */
async function focusEditor(ui) {
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  if (ui) {
    await ui.focus();
    const box = await until(() => ui.evaluate(`(()=>{const e=[...document.querySelectorAll('.part.editor .monaco-editor .view-lines')].find(e=>e.getBoundingClientRect().width>0);if(!e)return;const r=e.getBoundingClientRect();return {x:r.left+80,y:r.top+8}})()`), 'native source editor bounds');
    await ui.movePointer(box.x, box.y);
    await ui.click(box.x, box.y);
    await ui.evaluate(`document.querySelector('.part.editor .monaco-editor .native-edit-context, .part.editor .monaco-editor textarea.inputarea')?.focus()`);
    await until(() => ui.evaluate(`!!document.activeElement?.closest('.part.editor')`), 'native editor keyboard focus');
  }
}

/** Selection and input cross independent host/renderer channels; let each notification settle. */
async function typingProbe(document, ui) {
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  await until(() => vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString(), 'permission probe editor is active');
  await focusEditor(ui);
  const dirtyBefore = document.isDirty;
  const before = document.getText(), end = document.positionAt(before.length);
  editor.selection = new vscode.Selection(end, end);
  await new Promise(resolve => setTimeout(resolve, 150));
  if (ui) await ui.typeText('x');
  else await vscode.commands.executeCommand('type', { text: 'x' });
  await new Promise(resolve => setTimeout(resolve, 150));
  const writable = document.getText() !== before;
  assert.equal(document.getText(), before + (writable ? 'x' : ''), 'permission probe only inserts its own character');
  if (writable) {
    await vscode.commands.executeCommand('undo');
    await until(() => document.getText() === before, 'permission probe undo acknowledged');
  }
  assert.equal(document.isDirty, dirtyBefore, 'permission probe preserves document dirty state');
  return writable;
}

/** Exercise native editor permissions, typing and Ctrl+S's command, never a provider write shortcut. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const accepted = [], errors = [];
  let ui;
  try {
    if (process.env.ESKA_HOST_DEBUG_PORT) ui = await require('./query-constructor-dom.cjs').connectWorkbench(until);
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
    const scenarios = [{ name: 'ordinary-owner', next: '2' }];
    for (const glob of ['/*', '**/*']) {
      for (const queryRule of [false, true]) {
        for (const permission of ['configured', 'session-readonly', 'manual-unlock']) {
          scenarios.push({ name: glob + ':' + permission + ':query-rule=' + queryRule,
            rules: { [glob + '.bsl']: true, [glob + '.os']: true, ...(queryRule ? { [glob + '.sdbl']: true } : {}) },
            permission, next: String(scenarios.length + 2) });
        }
      }
    }
    scenarios.push({ name: 'session-readonly-owner', permission: 'session-readonly', next: String(scenarios.length + 2) });
    scenarios.push({ name: 'readonly-owner-excluded-from-file-watching', excludeWatcher: true,
      rules: { '**/*.bsl': true, '**/*.sdbl': true }, next: String(scenarios.length + 2) });
    scenarios.push({ name: 'dirty-owner-manual-readonly', permission: 'session-readonly', dirtyOwner: true,
      rules: { '**/*.bsl': true, '**/*.os': true }, next: String(scenarios.length + 2) });
    for (const scenario of scenarios) {
      const diskBefore = await fs.readFile(fixture.module);
      await files.update('readonlyInclude', scenario.rules, vscode.ConfigurationTarget.Global);
      if (scenario.excludeWatcher) await files.update('watcherExclude', { '**/*.bsl': true }, vscode.ConfigurationTarget.Workspace);
      await explorer.tree.synchronizeInputs();
      const settingsBefore = JSON.stringify(files.inspect('readonlyInclude'));
      const owner = await vscode.workspace.openTextDocument(ownerUri);
      await vscode.window.showTextDocument(owner, { preview: false });
      await explorer.support.settleWorkspaceReadonlyRule(ownerUri);
      await vscode.commands.executeCommand('workbench.action.files.resetActiveEditorReadonlyInSession');
      if (scenario.permission === 'manual-unlock') await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession');
      if (scenario.permission === 'session-readonly') await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
      const parentWritable = await typingProbe(owner, ui);
      if (scenario.permission === 'session-readonly' || scenario.rules?.['**/*.bsl'] && scenario.permission !== 'manual-unlock') {
        assert.equal(parentWritable, false, 'strict readonly baseline: ' + scenario.name);
      }
      if (scenario.permission === 'manual-unlock' || !scenario.rules && !scenario.permission) {
        assert.equal(parentWritable, true, 'writable baseline: ' + scenario.name);
      }
      const unrelatedDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(unrelated));
      await vscode.window.showTextDocument(unrelatedDocument, { preview: false });
      await explorer.support.settleWorkspaceReadonlyRule(unrelatedDocument.uri);
      const unrelatedWritable = await typingProbe(unrelatedDocument, ui);
      if (scenario.dirtyOwner) {
        await vscode.window.showTextDocument(owner, { preview: false });
        await explorer.support.settleWorkspaceReadonlyRule(ownerUri);
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession');
        await focusEditor(ui);
        vscode.window.activeTextEditor.selection = new vscode.Selection(owner.positionAt(0), owner.positionAt(0));
        await new Promise(resolve => setTimeout(resolve, 150));
        if (ui) await ui.typeText('// unsaved owner\r\n');
        else await vscode.commands.executeCommand('type', { text: '// unsaved owner\r\n' });
        await until(() => owner.getText().startsWith('// unsaved owner'), 'native unsaved owner edit');
        assert.equal(owner.isDirty, true);
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
        expected = '\ufeff// unsaved owner\r\n' + expected.slice(1);
      }
      const startOfQuery = owner.getText().indexOf('SELECT ' + selected);
      assert.ok(startOfQuery >= 0, 'owner contains the current query');
      const at = owner.positionAt(startOfQuery + 3);
      await vscode.window.showTextDocument(owner, { preview: false, selection: new vscode.Range(at, at) });
      await vscode.commands.executeCommand('eska.explorer.editBslQuery');
      const draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query'
        && vscode.window.activeTextEditor.document, 'query editor opened');
      const editor = vscode.window.activeTextEditor;
      await focusEditor(ui);
      const start = draft.getText().indexOf('SELECT ' + selected);
      assert.ok(start >= 0);
      editor.selection = new vscode.Selection(draft.positionAt(start), draft.positionAt(start + ('SELECT ' + selected).length));
      await new Promise(resolve => setTimeout(resolve, 150));
      const draftBefore = draft.getText();
      if (ui) await ui.typeText('SELECT ' + scenario.next);
      else await vscode.commands.executeCommand('type', { text: 'SELECT ' + scenario.next });
      await until(() => draft.getText().includes('SELECT ' + scenario.next),
        'native query typing succeeds immediately without manual unlock: ' + scenario.name)
        .catch(async error => {
          throw new Error(error.message + '\n' + JSON.stringify({
            ...(await queryWriteEvidence(explorer, draft, owner)), draftBefore, draftAfter: draft.getText(),
            active: vscode.window.activeTextEditor?.document.uri.toString(), selection: vscode.window.activeTextEditor?.selection,
          }));
        });
      assert.equal(draft.isDirty, true);
      if (ui) await ui.key('s', 'KeyS', 83, 2);
      else await vscode.commands.executeCommand('workbench.action.files.save');
      expected = expected.replace('SELECT ' + selected, 'SELECT ' + scenario.next);
      await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(scenario.dirtyOwner ? diskBefore : Buffer.from(expected)),
        'native Save preserves expected owner bytes: ' + scenario.name);
      assert.equal(vscode.window.activeTextEditor?.document, draft, 'Save keeps query focus');
      if (!scenario.dirtyOwner) assert.ok(!vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === ownerUri.toString())), 'clean owner stays hidden during query session');
      const repeat = scenario.next + '0';
      const repeatStart = draft.getText().indexOf('SELECT ' + scenario.next);
      editor.selection = new vscode.Selection(draft.positionAt(repeatStart),
        draft.positionAt(repeatStart + ('SELECT ' + scenario.next).length));
      await new Promise(resolve => setTimeout(resolve, 150));
      if (ui) await ui.typeText('SELECT ' + repeat);
      else await vscode.commands.executeCommand('type', { text: 'SELECT ' + repeat });
      await until(() => draft.getText().includes('SELECT ' + repeat), 'query remains editable after first Save');
      assert.equal(draft.isDirty, true);
      expected = expected.replace('SELECT ' + scenario.next, 'SELECT ' + repeat);
      if (ui) await ui.key('s', 'KeyS', 83, 2);
      else await vscode.commands.executeCommand('workbench.action.files.save');
      await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(scenario.dirtyOwner ? diskBefore : Buffer.from(expected)),
        'second native Save persists all owner bytes: ' + scenario.name);
      assert.equal(vscode.window.activeTextEditor?.document, draft, 'second Save keeps query focus');
      await closeQueryTabs(draft);
      const parent = await returned(ownerUri);
      await until(() => explorer.queries.sessions.size === 0, 'closed query releases its source');
      assert.equal(parent.getText(), expected.slice(1), 'returned parent contains accepted source edits');
      assert.equal(parent.isDirty, !!scenario.dirtyOwner, 'source preserves pre-query dirty state');
      assert.equal(await typingProbe(parent, ui), parentWritable,
        'returned parent preserves its observed native permission: ' + scenario.name);
      assert.deepEqual(await fs.readFile(fixture.module), scenario.dirtyOwner ? diskBefore : Buffer.from(expected));
      assert.deepEqual(await fs.readFile(unrelated), unrelatedBytes);
      assert.equal(JSON.stringify(files.inspect('readonlyInclude')), settingsBefore, 'query lifecycle preserves user/workspace readonly settings');
      if (scenario.dirtyOwner) {
        await vscode.window.showTextDocument(parent, { preview: false });
        await focusEditor(ui);
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession');
        await vscode.commands.executeCommand('undo');
        await until(() => parent.getText().includes('SELECT ' + scenario.next + '\r\n'), 'dirty owner Undo restores first query save');
        await vscode.commands.executeCommand('undo');
        await until(() => parent.getText().includes('SELECT ' + selected + '\r\n'), 'dirty owner Undo restores pre-query text');
        assert.ok(parent.getText().startsWith('// unsaved owner\r\n'), 'Undo preserves earlier unsaved owner edits');
        assert.equal(parent.isDirty, true);
        assert.deepEqual(await fs.readFile(fixture.module), diskBefore);
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
        assert.equal(await typingProbe(parent, ui), false, 'user can lock dirty owner again after Undo');
      }
      assert.equal(await typingProbe(unrelatedDocument, ui), unrelatedWritable,
        'query lifecycle preserves unrelated native permission: ' + scenario.name);
      selected = repeat;
      accepted.push(scenario.name);
      if (scenario.excludeWatcher) await files.update('watcherExclude', undefined, vscode.ConfigurationTarget.Workspace);
    }
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, accepted, locale: vscode.env.language }));
  } catch (error) {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, accepted, errors, error: String(error.stack ?? error) }));
    throw error;
  } finally { ui?.close(); }
};
