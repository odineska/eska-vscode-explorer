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

/** Read only models that VS Code has already opened in its two visible diff editors. */
async function verifyEditors(fixture) {
  const rel = path.relative(fixture.root, fixture.module).split(path.sep).join('/');
  const gitShow = async ref => (await execFile('git', ['-C', fixture.root, 'show', ref], { encoding: 'buffer' })).stdout;
  const expected = {
    head: await gitShow('HEAD:' + rel),
    index: await gitShow(':' + rel),
    worktree: await fs.readFile(fixture.module),
  };
  assert.notDeepEqual(expected.head, expected.index);
  assert.notDeepEqual(expected.index, expected.worktree);
  await until(() => diffTabs().length === 2, 'two native diff tabs');
  const tabs = diffTabs();
  assert.deepEqual(tabs.map(tab => pair(tab).map(raw => revision(vscode.Uri.parse(raw))).join('/')).sort(),
    ['head/index', 'index/worktree']);
  const visible = () => vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString());
  await until(() => tabs.every(tab => visible().includes(tab.input.modified.toString())), 'both modified panes rendered');
  for (const tab of tabs) {
    for (const uri of [tab.input.original, tab.input.modified]) {
      const bytes = expected[revision(uri)];
      const doc = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
      assert.ok(doc, `VS Code resolved ${uri}`);
      const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      assert.equal(normalize(doc.getText()), normalize(bytes.toString('utf8')));
      assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)), bytes);
    }
  }
  return tabs.map(pair).sort((a, b) => a[0].localeCompare(b[0]));
}

exports.run = async function () {
  assert.ok(process.env.ESKA_HOST_RESTART && process.env.ESKA_TEST_VSIX);
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const checkpoint = path.join(path.dirname(fixture.root), 'diff-tabs.json');
  if (process.env.ESKA_HOST_RUN === '0') {
    await command('workbench.view.scm');
    await command('eska.explorer.scm.focus');
    const ui = await attachScm();
    try {
      await openDiff(ui, 'index');
      await openDiff(ui, 'working');
      await command('workbench.action.moveEditorToRightGroup');
      await fs.writeFile(checkpoint, JSON.stringify(await verifyEditors(fixture)));
      await command('workbench.view.explorer');
    } finally {
      ui.close();
    }
  } else {
    const before = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
    assert.equal(vscode.workspace.getConfiguration('eska.explorer', vscode.Uri.file(fixture.root)).get('scm.mode'),
      process.env.ESKA_HOST_RESTORED_SCM_MODE ?? 'eska');
    assert.deepEqual(await verifyEditors(fixture), before, 'VS Code restored the same editors on startup');
  }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, suite: 'scm-diff-restore', vscode: vscode.version, run: process.env.ESKA_HOST_RUN,
    diffs: ['HEAD/index', 'index/worktree'],
  }));
};
