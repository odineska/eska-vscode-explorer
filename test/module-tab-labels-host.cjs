const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');

function named(entries, name) {
  const entry = entries.find(entry => entry.node && (entry.node.label.kind === 'name'
    ? entry.node.label.text : entry.node.label.translations['ru-RU']) === name);
  assert.ok(entry, `Missing ${name}`);
  return entry;
}

async function activeTab(uri, label) {
  await until(() => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return tab?.label === label && tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()
      && vscode.window.activeTextEditor?.document.uri.toString() === uri.toString();
  }, `Expected active tab ${label} for ${uri}`);
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

/** Compare VS Code's actual expansion of each contributed pattern with the SCM label for that path. */
async function checkPatterns(extension, tree, fixture, locale) {
  const patterns = extension.packageJSON.contributes.configurationDefaults['workbench.editor.customLabels.patterns'];
  const paths = Object.keys(patterns).map(pattern => {
    assert.ok(pattern.startsWith('**/'), pattern);
    let depth = 0;
    return { value: pattern.slice(3).replaceAll('*', () => `Объект${++depth}`), encoding: 'utf-8' };
  });
  const { labels } = await tree.request(tree.projects[0], 'metadata/sourceLabels', { paths });
  assert.deepEqual(labels.map(label => label.path), paths);
  // Keep synthetic modules outside the monitored source tree.
  for (const { path: relative, translations } of labels) {
    const caption = translations?.[locale];
    assert.ok(caption, `Missing SCM label for ${relative.value}`);
    const uri = vscode.Uri.file(path.join(fixture.root, 'label-samples', relative.value));
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    await fs.writeFile(uri.fsPath, '// module\n');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    // Root modules have no owner placeholder; VS Code requires an ASCII token in a custom template.
    await activeTab(uri, relative.value.startsWith('Ext/') ? caption + '.bsl' : caption);
  }
  return paths.length;
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.getExtension('1c-tooling.eska-explorer');
  const explorer = await extension.activate();
  const { name, object: objectPath, manager: managerPath } = fixture.documentModules;
  const objectUri = vscode.Uri.file(objectPath);
  const russian = vscode.env.language.toLowerCase().startsWith('ru');
  const prefix = (russian ? 'Документ.' : 'Document.') + name + '.';
  const objectLabel = prefix + (russian ? 'МодульОбъекта' : 'ObjectModule');
  const managerLabel = prefix + (russian ? 'МодульМенеджера' : 'ManagerModule');
  const commonLabel = (russian ? 'ОбщийМодуль.' : 'CommonModule.') + 'Обмен';
  const workspace = vscode.ConfigurationTarget.Workspace;
  const treeLocale = russian ? 'en-US' : 'ru-RU';
  await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', treeLocale, workspace);
  await until(() => explorer.treeLanguage === treeLocale, 'opposite tree locale applied');
  await vscode.commands.executeCommand('eska.explorer.connect');
  await until(() => explorer.connection.state.kind === 'ready' && !explorer.support.loading, 'backend ready');
  const children = async entry => (await explorer.getChildren(entry)).filter(child => child.node);
  const [root] = await children();
  const groups = await children(root);
  const document = named(await children(named(groups, 'Документы')), name);
  const modules = await children(named(await children(document), 'Модули'));
  const object = modules.find(entry => entry.node.id.role === 'object');
  const manager = modules.find(entry => entry.node.id.role === 'manager');
  assert.ok(object && manager);
  const commonGroups = await children(named(groups, 'Общие'));
  const commonModule = named(await children(named(commonGroups, 'Общие модули')), 'Обмен');

  async function openEntry(entry, uri, label, pinned = false) {
    if (pinned) await vscode.commands.executeCommand('eska.explorer.openInNewTab', entry);
    else {
      const command = explorer.getTreeItem(entry).command;
      await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    }
    const tab = await activeTab(uri, label);
    if (pinned) assert.equal(tab.isPreview, false);
    return vscode.window.activeTextEditor;
  }
  await openEntry(manager, vscode.Uri.file(managerPath), managerLabel, true);
  await openEntry(commonModule, vscode.Uri.file(path.join(fixture.source, 'CommonModules', 'Обмен', 'Ext', 'Module.bsl')), commonLabel, true);
  const ordinary = vscode.Uri.file(path.join(fixture.root, 'ordinary.bsl'));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(ordinary));
  await activeTab(ordinary, 'ordinary.bsl');

  const files = vscode.workspace.getConfiguration('files', objectUri);
  const labels = vscode.workspace.getConfiguration('workbench.editor.customLabels', objectUri);
  const previousReadonly = files.inspect('readonlyInclude')?.workspaceValue;
  const previousPatterns = labels.inspect('patterns')?.workspaceValue;
  const previousEnabled = labels.inspect('enabled')?.workspaceValue;
  const original = await fs.readFile(objectPath, 'utf8');
  try {
    // Load the native file model for the first time with its read-only rule already in effect.
    await files.update('readonlyInclude', { ...previousReadonly, '**/Documents/*/Ext/ObjectModule.bsl': true }, workspace);
    const editor = await openEntry(object, objectUri, objectLabel);
    await vscode.commands.executeCommand('type', { text: 'blocked' });
    assert.equal(editor.document.getText(), original);
    assert.equal(editor.document.isDirty, false);
    await labels.update('patterns', { ...previousPatterns, '**/Documents/*/Ext/ObjectModule.bsl': 'My document module' }, workspace);
    await activeTab(objectUri, 'My document module');
    await labels.update('enabled', false, workspace);
    await activeTab(objectUri, 'ObjectModule.bsl');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } finally {
    await labels.update('patterns', previousPatterns, workspace);
    await labels.update('enabled', previousEnabled, workspace);
    await files.update('readonlyInclude', previousReadonly, workspace);
  }
  const editor = await openEntry(object, objectUri, objectLabel, true);
  const marker = '// saved through the semantic tab ';
  await vscode.commands.executeCommand('type', { text: marker });
  assert.equal(editor.document.getText(), marker + original);
  assert.equal(await editor.document.save(), true);
  assert.equal(await fs.readFile(objectPath, 'utf8'), marker + original);

  const testedPatterns = await checkPatterns(extension, explorer.tree, fixture, russian ? 'ru-RU' : 'en-US');
  await vscode.commands.executeCommand('eska.explorer.disconnect');
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'module-tab-labels',
    vscode: vscode.version, locale: vscode.env.language, testedPatterns, savedOriginalFile: true, nativeReadonly: true,
    samePatternOverride: true, customLabelsDisabled: true }));
};
