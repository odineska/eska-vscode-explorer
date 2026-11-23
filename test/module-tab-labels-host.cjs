const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function until(predicate, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
function named(entries, name) {
  const entry = entries.find(entry => entry.node && (entry.node.label.kind === 'name'
    ? entry.node.label.text : entry.node.label.translations['ru-RU']) === name);
  assert.ok(entry, `Missing ${name}`);
  return entry;
}

/** Native workbench captions must preserve ordinary file editing and policy enforcement. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  assert.ok(extension);
  const explorer = await extension.activate();
  const { name, object: objectPath, manager: managerPath } = fixture.documentModules;
  const unrelated = path.join(fixture.root, 'ordinary.bsl');
  const russian = vscode.env.language.toLowerCase().startsWith('ru');
  const prefix = russian ? 'Документ.ВыдачаЗайма.' : 'Document.ВыдачаЗайма.';
  const objectLabel = prefix + (russian ? 'МодульОбъекта' : 'ObjectModule');
  const managerLabel = prefix + (russian ? 'МодульМенеджера' : 'ManagerModule');
  const commonLabel = (russian ? 'ОбщийМодуль.' : 'CommonModule.') + 'Обмен';
  // Deliberately disagree with the workbench locale throughout the assertions.
  const treeLocale = russian ? 'en-US' : 'ru-RU';
  await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', treeLocale, vscode.ConfigurationTarget.Workspace);
  await until(() => explorer.treeLanguage === treeLocale, 'opposite tree locale applied');
  await vscode.commands.executeCommand('eska.explorer.connect');
  await until(() => explorer.connection.state.kind === 'ready' && !explorer.support.loading, 'backend ready');
  const children = async entry => (await explorer.getChildren(entry)).filter(child => child.node);
  const [root] = await children();
  const documents = named(await children(root), 'Документы');
  const document = named(await children(documents), name);
  const modules = await children(named(await children(document), 'Модули'));
  const object = modules.find(entry => entry.node.id.role === 'object');
  const manager = modules.find(entry => entry.node.id.role === 'manager');
  assert.ok(object);
  assert.ok(manager);
  const common = named(await children(root), 'Общие');
  const commonModule = named(await children(named(await children(common), 'Общие модули')), 'Обмен');
  function fileTab(file) {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file' && tab.input.uri.fsPath === file);
  }
  async function opened(entry, file, label, newTab = false) {
    if (newTab) await vscode.commands.executeCommand('eska.explorer.openInNewTab', entry);
    else {
      const command = explorer.getTreeItem(entry).command;
      assert.ok(command);
      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    }
    await until(() => fileTab(file)?.label === label && vscode.window.activeTextEditor?.document.uri.fsPath === file,
      `native file tab ${label}; actual: ${fileTab(file)?.label}`);
    if (newTab) assert.equal(fileTab(file).isPreview, false);
    return vscode.window.activeTextEditor;
  }
  await opened(manager, managerPath, managerLabel, true);
  await opened(commonModule, path.join(fixture.source, 'CommonModules', 'Обмен', 'Ext', 'Module.bsl'), commonLabel, true);

  const ordinaryEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(unrelated)), { preview: false });
  await until(() => fileTab(unrelated)?.label === 'ordinary.bsl', 'unrelated basename unchanged');
  await vscode.commands.executeCommand('type', { text: '// writable control\n' });
  assert.ok(ordinaryEditor.document.getText().includes('// writable control'), 'native type has a writable positive control');
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await until(() => !ordinaryEditor.document.isDirty, 'temporary edit reverted');

  const editor = await opened(object, objectPath, objectLabel);
  const files = vscode.workspace.getConfiguration('files');
  const previousReadonly = files.inspect('readonlyInclude')?.workspaceValue;
  const labels = vscode.workspace.getConfiguration('workbench.editor.customLabels');
  const previousPatterns = labels.inspect('patterns')?.workspaceValue;
  const readonlyPattern = '**/Documents/ВыдачаЗайма/Ext/ObjectModule.bsl';
  try {
    await files.update('readonlyInclude', { ...previousReadonly, [readonlyPattern]: true }, vscode.ConfigurationTarget.Workspace);
    await until(() => vscode.workspace.getConfiguration('files').get('readonlyInclude')[readonlyPattern] === true, 'readonly rule applied');
    await opened(object, objectPath, objectLabel, true);
    // Native file configuration listeners apply readonly state asynchronously.
    await new Promise(resolve => setTimeout(resolve, 300));
    const before = editor.document.getText();
    await vscode.commands.executeCommand('type', { text: 'blocked' });
    assert.equal(editor.document.getText(), before, 'semantic tab respects native readonlyInclude');
    assert.equal(editor.document.isDirty, false);
    await labels.update('patterns', { '**/Documents/ВыдачаЗайма/Ext/ObjectModule.bsl': 'My document module' }, vscode.ConfigurationTarget.Workspace);
    await until(() => fileTab(objectPath)?.label === 'My document module', 'explicit user label overrides extension defaults');
  } finally {
    await labels.update('patterns', previousPatterns, vscode.ConfigurationTarget.Workspace);
    await files.update('readonlyInclude', previousReadonly, vscode.ConfigurationTarget.Workspace);
  }
  await until(() => fileTab(objectPath)?.label === objectLabel, 'default caption restored');
  const marker = '// semantic caption saves original file\n';
  assert.equal(await editor.edit(edit => edit.insert(new vscode.Position(0, 0), marker)), true);
  assert.equal(await editor.document.save(), true);
  assert.equal(await fs.readFile(objectPath, 'utf8'), marker + '// Object\n');
  await vscode.commands.executeCommand('eska.explorer.disconnect');
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'module-tab-labels',
    vscode: vscode.version, locale: vscode.env.language, labels: [objectLabel, managerLabel, commonLabel],
    ordinaryFileTabs: true, savedOriginalFile: true, nativeReadonly: true, userLabelOverride: true }));
};
