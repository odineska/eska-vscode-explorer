const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function until(predicate, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
function named(elements, label) {
  const result = elements.find(value => value.node && (value.node.label.text ?? value.node.label.translations['ru-RU']) === label);
  assert.ok(result, `Missing ${label}`); return result;
}

/** Native documents, diff tabs, metadata watcher and reveal use a real extension host and Rust backend. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  await fs.mkdir(path.join(fixture.source, 'Ext'), { recursive: true });
  await fs.writeFile(path.join(fixture.source, 'Ext', 'ParentConfigurations.bin'), '{6,0,0,0,0,0}');
  // A clean VS Code buffer normalizes mixed endings; byte-preserving backend previews must still apply.
  const original = (await fs.readFile(fixture.descriptor, 'utf8')).replace('<ChildObjects>', '\n<ChildObjects>');
  await fs.writeFile(fixture.descriptor, original);
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  assert.ok(extension);
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.disconnect');
  await vscode.commands.executeCommand('eska.explorer.connect');
  await until(() => explorer.connection.state.kind === 'ready' && !explorer.support.loading, 'ready metadata tree');
  assert.equal(explorer.connection.state.metadataCreation, true);
  const roots = await explorer.getChildren();
  const root = roots.find(value => value.node);
  const catalogGroup = named(await explorer.getChildren(root), 'Справочники');
  const goods = named(await explorer.getChildren(catalogGroup), 'Товары');
  assert.match(explorer.getTreeItem(goods).contextValue, /Creatable$/);
  const service = explorer.metadataCreation, originalApi = service.api;
  const providerDocuments = [], notices = [], errors = [], inputs = [];
  let kind = 'attribute', apply = true, beforeApply;
  const window = { tabGroups: vscode.window.tabGroups,
    async showQuickPick(items, options) {
      if (options.canPickMany) return [items.find(value => value.value.kind === 'boolean')];
      return items.find(value => value.value === kind) ?? items[0];
    },
    async showInputBox(options) {
      const value = inputs.shift(); assert.notEqual(value, undefined, options.title);
      assert.equal(options.validateInput?.(value), undefined); return value;
    },
    async showInformationMessage(message, ...items) {
      notices.push(message);
      if (!items.length) return;
      const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputTextDiff
        && tab.input.modified.scheme === 'eska-metadata-creation');
      assert.ok(tab, 'review opens a native readonly diff');
      const before = await vscode.workspace.openTextDocument(tab.input.original);
      const after = await vscode.workspace.openTextDocument(tab.input.modified);
      assert.equal(before.isDirty, false); assert.equal(after.isDirty, false);
      providerDocuments.push({ before: before.getText(), after: after.getText() });
      await beforeApply?.();
      return apply ? items[0] : undefined;
    },
    async showErrorMessage(message) { errors.push(message); },
  };
  service.api = { Uri: vscode.Uri, TabInputTextDiff: vscode.TabInputTextDiff, CancellationTokenSource: vscode.CancellationTokenSource,
    workspace: vscode.workspace, commands: vscode.commands, window };
  try {
    // Run the public command, review exact snapshots and observe automatic tree reveal.
    inputs.push('НовыйРеквизит', '');
    await vscode.commands.executeCommand('eska.explorer.createMetadata', goods);
    assert.deepEqual(errors, []);
    assert.equal(providerDocuments.length, 1);
    const changed = await fs.readFile(fixture.descriptor, 'utf8');
    assert.ok(changed.includes('<Name>НовыйРеквизит</Name>'));
    assert.ok(changed.startsWith('\uFEFF')); assert.ok(changed.includes('\r\n')); assert.ok(changed.includes('\n<ChildObjects>'));
    assert.ok(providerDocuments[0].after.includes('<Name>НовыйРеквизит</Name>'));
    await until(() => explorer.view.selection[0]?.node?.label?.text === 'НовыйРеквизит', 'new object selected in native tree');
    assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).every(tab => !(tab.input instanceof vscode.TabInputTextDiff)
      || tab.input.modified.scheme !== 'eska-metadata-creation'), 'owned review is closed');

    // The same command creates a tabular section, then an attribute inside it, without stale replay.
    await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', 'ru-RU', vscode.ConfigurationTarget.Workspace);
    await until(() => explorer.treeLanguage === 'ru-RU', 'Russian creation captions');
    kind = 'table-part'; inputs.push('НовыеСтроки', '');
    await vscode.commands.executeCommand('eska.explorer.createMetadata', goods);
    assert.deepEqual(errors, []);
    const section = explorer.view.selection[0];
    assert.equal(section.node.label.text, 'НовыеСтроки');
    assert.ok(notices.some(text => text === 'Создан объект НовыеСтроки.'));
    assert.deepEqual(section.node.creationKinds, ['attribute']);
    kind = 'attribute'; inputs.push('Проверен', '');
    await vscode.commands.executeCommand('eska.explorer.createMetadata', section);
    assert.deepEqual(errors, []);
    assert.equal(explorer.view.selection[0].node.label.text, 'Проверен');

    // Cancelling the native review changes neither source nor selection.
    await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', 'en-US', vscode.ConfigurationTarget.Workspace);
    await until(() => explorer.treeLanguage === 'en-US', 'English creation captions');
    const saved = await fs.readFile(fixture.descriptor);
    apply = false; inputs.push('НеСоздавать', '');
    await vscode.commands.executeCommand('eska.explorer.createMetadata', goods);
    assert.deepEqual(await fs.readFile(fixture.descriptor), saved);
    apply = true;

    // A dirty native XML buffer must remain unsaved and unchanged, including a change made during review.
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.descriptor));
    const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(0, 0), '<!-- unsaved -->');
    beforeApply = async () => { assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(document.isDirty, true); };
    inputs.push('НеПерезаписывать', '');
    await vscode.commands.executeCommand('eska.explorer.createMetadata', goods);
    assert.equal(errors.length, 1); assert.match(errors[0], /несохран|unsaved/i);
    assert.equal(document.isDirty, true); assert.ok(document.getText().startsWith('<!-- unsaved -->'));
    assert.deepEqual(await fs.readFile(fixture.descriptor), saved);
    beforeApply = undefined;
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    assert.equal(document.isDirty, false);
  } finally { service.api = originalApi; }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true,
    suite: 'metadata-creation', treeLanguages: ['en-US', 'ru-RU'], created: ['НовыйРеквизит', 'НовыеСтроки', 'Проверен'], nativeDiffs: providerDocuments.length,
    preserved: ['mixed line endings', 'BOM', 'cancelled preview', 'dirty XML during review'], notifications: notices.length }));
};
