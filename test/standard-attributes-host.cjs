const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

/** Inspect implicit platform attributes without creating overrides or mutating source files. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const files = [fixture.descriptor, fixture.module, path.join(fixture.source, 'Configuration.xml')];
  const before = await Promise.all(files.map(file => fs.readFile(file)));
  assert.ok(!before[0].toString('utf8').includes('<StandardAttributes>'));
  await vscode.workspace.getConfiguration('eska.explorer').update('executable', process.env.ESKA_TEST_BINARY, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', 'ru-RU', vscode.ConfigurationTarget.Workspace);
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const [root] = (await explorer.getChildren()).filter(entry => entry.node);
  const catalogs = (await explorer.getChildren(root)).find(entry => entry.node.id.collection?.metadataKind === 'catalog');
  const goods = (await explorer.getChildren(catalogs)).find(entry => entry.node.label.text === 'Товары');
  const group = (await explorer.getChildren(goods)).find(entry => entry.node.id.collection?.kind === 'standardAttributes');
  assert.ok(group, 'implicit standard attribute group exists');
  assert.equal(explorer.getTreeItem(group).label, 'Стандартные реквизиты');
  const attributes = await explorer.getChildren(group);
  assert.deepEqual(attributes.map(entry => entry.node.id.name).sort(), ['Code', 'DeletionMark', 'Description', 'IsFolder', 'Owner', 'Parent', 'Predefined', 'Ref']);
  const deletion = attributes.find(entry => entry.node.id.name === 'DeletionMark');
  const item = explorer.getTreeItem(deletion);
  assert.equal(item.label, 'Пометка удаления');
  assert.equal(item.contextValue, 'eskaStandardAttribute');
  assert.equal(item.command.command, 'eska.explorer.properties');
  await vscode.commands.executeCommand(item.command.command, deletion);
  const tab = [...explorer.propertiesTabs.tabs.values()].find(value => value.entry === deletion);
  assert.equal(tab.state.status, 'ready');
  assert.equal(tab.state.readOnly, true);
  assert.equal(tab.state.sourceAvailable, false);
  assert.equal(tab.state.properties.find(value => value.key.name === 'Type').presentation.items[0].caption['ru-RU'], 'Булево');
  const editors = vscode.window.visibleTextEditors.length;
  await tab.receive({ type: 'toggleLock', revision: tab.state.revision });
  await tab.receive({ type: 'openXml', revision: tab.state.revision, index: 0 });
  assert.equal(tab.state.editing.unlocked, false);
  assert.equal(vscode.window.visibleTextEditors.length, editors);
  let inspected = false;
  if (process.env.ESKA_HOST_DEBUG_PORT) {
    const probe = await frame(tab);
    try {
      await until(async () => await probe.evaluate('Boolean(document.querySelector(".property"))'), 'property values visible');
      const dom = await probe.evaluate('({locked:document.getElementById("read-only").disabled,sourceButtons:document.querySelectorAll(".property-head .source-button").length,text:document.body.textContent})');
      assert.equal(dom.locked, true);
      assert.equal(dom.sourceButtons, 0);
      assert.ok(dom.text.includes('Булево'));
      inspected = true;
    } finally { await probe.close(); }
  }
  await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', 'en-US', vscode.ConfigurationTarget.Workspace);
  await until(() => tab.state.language === 'en-US', 'properties follow metadata language');
  assert.equal(explorer.getTreeItem(group).label, 'Standard attributes');
  assert.equal(tab.state.properties.find(value => value.key.name === 'Name').value.caption['en-US'], 'Deletion mark');
  for (let index = 0; index < files.length; index++) assert.deepEqual(await fs.readFile(files[index]), before[index]);
  await vscode.commands.executeCommand('eska.explorer.disconnect');
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'standard-attributes', vscode: vscode.version, implicit: true, readOnly: true, inspected, sourceUnchanged: true }));
};
