const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const exec = require('node:util').promisify(require('node:child_process').execFile);
const vscode = require('vscode');

async function until(predicate, reason) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const result = await predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail(reason);
}

/** Real Git repository and metadata backend; every mutation is confined to an owned playground fixture. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const second = process.env.ESKA_HOST_SECOND_FIXTURE && JSON.parse(process.env.ESKA_HOST_SECOND_FIXTURE);
  const git = (root, ...args) => exec('git', args, { cwd: root });
  for (const project of [fixture, second].filter(Boolean)) {
    await fs.writeFile(path.join(project.root, '.gitignore'), '.eska/\n.vscode/\nhost-result.json\n');
    await git(project.root, 'init'); await git(project.root, 'config', 'user.name', 'ESKA SCM Test');
    await git(project.root, 'config', 'user.email', 'scm@example.invalid');
    await git(project.root, 'add', '.'); await git(project.root, 'commit', '-m', 'owned fixture');
  }
  const gitApi = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
  const repo = await gitApi.openRepository(vscode.Uri.file(fixture.root)); assert.ok(repo);
  const otherRepo = second && await gitApi.openRepository(vscode.Uri.file(second.root));
  const explorer = await vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer').activate();
  // Choosing this document uses the existing project-selection mechanism in a multi-root window.
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.module)));
  await until(() => explorer.tree?.connection.state.kind === 'ready', 'project connection');
  await vscode.commands.executeCommand('workbench.view.scm');
  await vscode.commands.executeCommand('eska.explorer.scm.focus');
  const provider = explorer.scm;
  const rows = async () => (await provider.getChildren()).flatMap(root => root.groups.flatMap(group => group.entries));
  const row = async (file, group) => until(async () => (await rows()).find(entry => entry.change.uri.fsPath === file && entry.parent.group === group), `${group}: ${file}`);
  const action = (name, entry) => vscode.commands.executeCommand(`eska.explorer.scm.${name}`, entry);
  const expected = vscode.env.language.startsWith('ru') ? 'Справочник.Товары.МодульОбъекта' : 'Catalog.Товары.ObjectModule';
  await fs.appendFile(fixture.module, '// staged\n'); await repo.status();
  assert.equal((await row(fixture.module, 'working')).label, expected);
  await action('stage', await row(fixture.module, 'working'));
  await until(() => repo.state.indexChanges.some(change => change.uri.fsPath === fixture.module), 'stage through public Git API');
  await fs.appendFile(fixture.module, '// unstaged\n'); await repo.status();
  const staged = await row(fixture.module, 'index'); await action('diff', staged);
  const indexTab = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.equal(indexTab.original.scheme, 'git'); assert.equal(JSON.parse(indexTab.original.query).ref, 'HEAD');
  assert.equal(indexTab.modified.scheme, 'git'); assert.equal(JSON.parse(indexTab.modified.query).ref, '');
  assert.ok(!(await vscode.workspace.openTextDocument(indexTab.modified)).getText().includes('// unstaged'));
  await action('diff', await row(fixture.module, 'working'));
  const worktreeTab = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.equal(worktreeTab.original.scheme, 'git'); assert.equal(worktreeTab.modified.scheme, 'file');
  await action('unstage', await row(fixture.module, 'index'));
  await until(() => !repo.state.indexChanges.length, 'unstage through public Git API');

  // Unknown files preserve normal names and actual paths, including spaces and non-ASCII characters.
  const note = path.join(fixture.root, 'Заметка #1.txt'); await fs.writeFile(note, 'unknown file\n'); await repo.status();
  const untracked = await until(async () => (await rows()).find(entry => entry.change.uri.fsPath === note), 'untracked note');
  assert.equal(untracked.label, 'Заметка #1.txt'); await action('open', untracked);
  assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, note);
  await action('stage', await until(async () => (await rows()).find(entry => entry.change.uri.fsPath === note), 'stage note'));
  await until(() => repo.state.indexChanges.some(change => change.uri.fsPath === note), 'untracked staging');

  if (second) {
    await fs.appendFile(second.module, '// second project\n'); await otherRepo.status();
    const otherRow = await row(second.module, 'working'); assert.equal(otherRow.label, expected);
    await action('stage', otherRow);
    await until(() => otherRepo.state.indexChanges.some(change => change.uri.fsPath === second.module), 'secondary project stage');
    assert.ok(!repo.state.indexChanges.some(change => change.uri.fsPath === fixture.module), 'first repository remains unstaged');
    const firstHead = (await git(fixture.root, 'rev-parse', 'HEAD')).stdout.trim();
    repo.inputBox.value = 'Keep the first repository draft';
    otherRepo.inputBox.value = 'Commit only the second repository';
    const secondRoot = await until(async () => (await provider.getChildren()).find(root => root.repository.rootUri.fsPath === second.root), 'secondary repository entry');
    await action('commit', secondRoot);
    await until(async () => (await git(second.root, 'log', '-1', '--format=%s')).stdout.trim() === 'Commit only the second repository', 'commit selected repository without editor focus');
    assert.equal((await git(fixture.root, 'rev-parse', 'HEAD')).stdout.trim(), firstHead);
    assert.equal(repo.inputBox.value, 'Keep the first repository draft');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await git(fixture.root, 'add', '.'); await git(fixture.root, 'commit', '-m', 'test modifications');
  const moved = path.join(fixture.source, 'Catalogs', 'Покупатели', 'Ext', 'ObjectModule.bsl');
  await git(fixture.root, 'mv', fixture.module, moved); await repo.status();
  const renamed = await row(moved, 'index'); assert.ok(renamed.label.includes('Товары')); assert.ok(renamed.label.includes('Покупатели'));
  assert.ok(renamed.label.includes(' → ')); await action('diff', renamed);
  const renameTab = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.equal(JSON.parse(renameTab.original.query).path, fixture.module); assert.equal(JSON.parse(renameTab.modified.query).path, moved);
  await action('unstage', await row(moved, 'index')); await until(() => !repo.state.indexChanges.length, 'unstage both rename paths');
  const deleted = await row(fixture.module, 'working'); assert.equal(deleted.change.status, 6); assert.equal(deleted.label, expected);
  const project = explorer.tree.projects[0];
  const progress = await explorer.tree.request(project, 'metadata/index', { action: 'status' });
  assert.equal(progress.progress.state, 'not_started', 'semantic SCM does not start a full index');
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, vscode: vscode.version,
    semanticLabels: true, diffIndexWorktree: true, rename: true, deleted: true, untracked: true, stageUnstage: true,
    multiRoot: !!second, selectedRepositoryCommit: !!second, fullIndexStarted: false }));
};
