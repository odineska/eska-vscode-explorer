const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');
const { attachScm } = require('./scm-view-host.cjs');

const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
const diffTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
  .filter(tab => tab.input instanceof vscode.TabInputTextDiff);
const pair = tab => [tab.input.original.toString(), tab.input.modified.toString()];
const revision = uri => uri.scheme === 'file' ? 'worktree' : JSON.parse(uri.query).revision;

async function openDiff(ui, group) {
  let context;
  await until(async () => {
    context = await ui.webview(`[...document.querySelectorAll('.scm-row')].map(row => JSON.parse(row.dataset.vscodeContext))
      .find(context => context.eskaScmGroup === ${JSON.stringify(group)})`);
    return context;
  }, `ESKA row for ${group}`);
  await command('eska.explorer.scm.diff', { ...context, webview: 'eska.explorer.scm' });
  await until(() => diffTabs().some(tab => tab.isActive && revision(tab.input.modified) ===
    (group === 'index' ? 'index' : 'worktree')), `opened ${group} diff`);
  await command('workbench.action.keepEditor');
}

async function openGroupDiff(ui, group) {
  let context;
  await until(async () => {
    context = await ui.webview(`[...document.querySelectorAll('[data-vscode-context]')]
      .map(node => JSON.parse(node.dataset.vscodeContext))
      .find(context => context.webviewSection === 'scmGroup' && context.eskaScmGroup === ${JSON.stringify(group)})`);
    return context;
  }, `ESKA group for ${group}`);
  await command(group === 'index' ? 'eska.explorer.scm.openAllStaged' : 'eska.explorer.scm.openAll',
    { ...context, webview: 'eska.explorer.scm' });
  await command('workbench.action.keepEditor');
}

async function expectedContents(fixture) {
  const rel = path.relative(fixture.root, fixture.module).split(path.sep).join('/');
  const gitShow = async ref => (await execFile('git', ['-C', fixture.root, 'show', ref], { encoding: 'buffer' })).stdout;
  const expected = { head: await gitShow('HEAD:' + rel), index: await gitShow(':' + rel),
    worktree: await fs.readFile(fixture.module) };
  assert.notDeepEqual(expected.head, expected.index);
  assert.notDeepEqual(expected.index, expected.worktree);
  return expected;
}

async function verifyDocument(doc, expected) {
  const bytes = expected[revision(doc.uri)];
  const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  assert.ok(bytes, `known revision for ${doc.uri}`);
  assert.equal(normalize(doc.getText()), normalize(bytes.toString('utf8')), `rendered model ${doc.uri}`);
  assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(doc.uri)), bytes);
}

/** Inspect models resolved by restored multi-diff editors before invoking any SCM command. */
async function verifyGroupEditors(fixture) {
  const expected = await expectedContents(fixture);
  const documents = () => vscode.workspace.textDocuments.filter(doc => doc.uri.fsPath === fixture.module &&
    ['eska-scm', 'file'].includes(doc.uri.scheme));
  await until(() => {
    const docs = documents();
    return ['head', 'index', 'worktree'].every(kind => docs.some(doc => revision(doc.uri) === kind));
  }, 'grouped editors resolve HEAD, index and worktree models on startup');
  const docs = documents();
  for (const doc of docs) await verifyDocument(doc, expected);
  return docs.map(doc => doc.uri.toString()).sort();
}

/** Read only models that VS Code has already opened in its two visible diff editors. */
async function verifyEditors(fixture) {
  const expected = await expectedContents(fixture);
  await until(() => diffTabs().length === 2, 'two native diff tabs');
  const tabs = diffTabs();
  assert.deepEqual(tabs.map(({ input }) => [revision(input.original), revision(input.modified)].join('/')).sort(),
    ['head/index', 'index/worktree']);
  const visible = () => vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString());
  await until(() => tabs.every(tab => visible().includes(tab.input.modified.toString())), 'both modified panes rendered');
  for (const tab of tabs) {
    for (const uri of [tab.input.original, tab.input.modified]) {
      const doc = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
      assert.ok(doc, `VS Code resolved ${uri}`);
      await verifyDocument(doc, expected);
    }
  }
  return tabs.map(pair).sort((a, b) => a[0].localeCompare(b[0]));
}

exports.run = async function () {
  assert.ok(process.env.ESKA_HOST_RESTART && process.env.ESKA_TEST_VSIX);
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const checkpoint = path.join(path.dirname(fixture.root), 'diff-tabs.json');
  const grouped = process.env.ESKA_HOST_SCM_GROUP_DIFF === '1';
  const open = grouped ? openGroupDiff : openDiff;
  const verify = grouped ? verifyGroupEditors : verifyEditors;
  if (process.env.ESKA_HOST_RUN === '0') {
    await command('workbench.view.scm');
    await command('eska.explorer.scm.focus');
    const ui = await attachScm();
    try {
      await open(ui, 'index');
      await open(ui, 'working');
      await command('workbench.action.moveEditorToRightGroup');
      await fs.writeFile(checkpoint, JSON.stringify(await verify(fixture)));
      await command('workbench.view.explorer');
    } finally {
      ui.close();
    }
  } else {
    const before = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
    assert.equal(vscode.workspace.getConfiguration('eska.explorer', vscode.Uri.file(fixture.root)).get('scm.mode'),
      process.env.ESKA_HOST_RESTORED_SCM_MODE ?? 'eska');
    assert.deepEqual(await verify(fixture), before, 'VS Code restored the same editors on startup');
  }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, suite: 'scm-diff-restore', vscode: vscode.version, run: process.env.ESKA_HOST_RUN,
    diffs: ['HEAD/index', 'index/worktree'], grouped,
  }));
};
