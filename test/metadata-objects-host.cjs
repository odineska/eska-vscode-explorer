const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

/** Public commands, native review webviews and real metadata publication use an isolated host. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  await fs.mkdir(path.join(fixture.source, 'Ext'), { recursive: true });
  await fs.writeFile(path.join(fixture.source, 'Ext', 'ParentConfigurations.bin'), '{6,0,0,0,0,0}');
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  assert.ok(extension);
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.disconnect');
  await vscode.commands.executeCommand('eska.explorer.connect');
  await until(() => explorer.connection.state.kind === 'ready' && !explorer.support.loading, 'ready metadata tree');
  assert.equal(explorer.connection.state.metadataObjects, true);
  const root = (await explorer.getChildren()).find(value => value.node);
  const service = explorer.metadataObjects, originalApi = service.api, originalReview = service.review.show.bind(service.review);
  const inputs = [], errors = [], reviews = [];
  let kind = 'CommonForm', cancel = false, duringReview;
  service.api = { Uri: vscode.Uri, CancellationTokenSource: vscode.CancellationTokenSource, workspace: vscode.workspace, window: {
    async showQuickPick(items) { return items.find(item => item.option?.value === kind) ?? items[0]; },
    async showInputBox(options) {
      const value = inputs.shift(); assert.notEqual(value, undefined, options.title);
      assert.equal(options.validateInput?.(value), undefined); return value;
    },
    async showErrorMessage(message) { errors.push(message); },
    async showInformationMessage() {},
  } };
  service.review.show = async (title, detail, accept, dismiss) => {
    const result = originalReview(title, detail, accept, dismiss);
    const dom = await frame({ state: { title } });
    try {
      const rendered = await dom.evaluate(`({detail:document.getElementById('changes').textContent,accept:document.getElementById('accept').textContent})`);
      assert.equal(rendered.detail, detail); assert.equal(rendered.accept, accept); reviews.push(rendered);
      await duringReview?.();
      // Acknowledge CDP evaluation before the click destroys its webview context.
      await dom.evaluate(`setTimeout(() => document.getElementById(${JSON.stringify(cancel ? 'cancel' : 'accept')}).click(), 50); true`);
      return await result;
    } finally { dom.close(); }
  };
  const descriptor = name => path.join(fixture.source, 'CommonForms', `${name}.xml`);
  try {
    for (const locale of ['en-US', 'ru-RU']) {
      await vscode.workspace.getConfiguration('eska.explorer').update('treeLanguage', locale, vscode.ConfigurationTarget.Workspace);
      await until(() => explorer.treeLanguage === locale, 'tree locale changed');
      inputs.push(locale === 'en-US' ? 'NativeForm' : 'РусскаяФорма');
      await vscode.commands.executeCommand('eska.explorer.createObject', root);
      assert.deepEqual(errors, []);
      const name = locale === 'en-US' ? 'NativeForm' : 'РусскаяФорма';
      await until(() => explorer.view.selection[0]?.node?.label?.text === name, 'created form selected');
      assert.ok(await fs.readFile(descriptor(name)));
    }
    const original = explorer.view.selection[0];
    assert.equal(original.node.label.text, 'РусскаяФорма');
    assert.equal(explorer.getTreeItem(original).contextValue, 'eskaForm');
    const originalXml = await fs.readFile(descriptor('РусскаяФорма'), 'utf8');
    inputs.push('ФормаДвойник');
    await vscode.commands.executeCommand('eska.explorer.copyObject', original);
    assert.deepEqual(errors, []);
    await until(() => explorer.view.selection[0]?.node?.label?.text === 'ФормаДвойник', 'copy selected');
    const twin = explorer.view.selection[0];
    const copiedXml = await fs.readFile(descriptor('ФормаДвойник'), 'utf8');
    assert.notEqual(/<CommonForm uuid="([^"]+)"/.exec(copiedXml)[1], /<CommonForm uuid="([^"]+)"/.exec(originalXml)[1]);
    const formPath = name => path.join(fixture.source, 'CommonForms', name, 'Ext', 'Form.xml');
    assert.deepEqual(await fs.readFile(formPath('РусскаяФорма')), await fs.readFile(formPath('ФормаДвойник')));

    cancel = true;
    await vscode.commands.executeCommand('eska.explorer.deleteObject', twin);
    assert.deepEqual(await fs.readFile(descriptor('ФормаДвойник'), 'utf8'), copiedXml);
    cancel = false;
    await vscode.commands.executeCommand('eska.explorer.deleteObject', twin);
    assert.deepEqual(errors, []);
    await assert.rejects(fs.readFile(descriptor('ФормаДвойник')), error => error.code === 'ENOENT');
    assert.equal(await fs.readFile(descriptor('РусскаяФорма'), 'utf8'), originalXml);

    // Unsaved input created while the native review is open must not be copied or saved.
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(formPath('РусскаяФорма')));
    duringReview = async () => {
      const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(0, 0), '<!-- unsaved -->');
      assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(document.isDirty, true);
    };
    inputs.push('НеЗаписывать');
    await vscode.commands.executeCommand('eska.explorer.copyObject', original);
    assert.equal(errors.length, 1); assert.match(errors[0], /несохран|unsaved/i);
    assert.equal(document.isDirty, true);
    await assert.rejects(fs.readFile(descriptor('НеЗаписывать')), error => error.code === 'ENOENT');
    duringReview = undefined;
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    assert.equal(document.isDirty, false);
  } finally { service.api = originalApi; service.review.show = originalReview; }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'metadata-objects',
    treeLanguages: ['en-US', 'ru-RU'], nativeReviews: reviews.length,
    checked: ['public create/copy/delete commands', 'real review DOM', 'form reveal', 'fresh UUID', 'payload bytes', 'cancel delete', 'dirty copy source'] }));
};
