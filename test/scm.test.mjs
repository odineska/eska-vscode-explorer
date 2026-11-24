import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve, relative, join, win32 } from 'node:path';
import { sourceKey } from '../out/source.js';
import { message } from '../out/messages.js';
import { changeCaption, changeIdentity, insideRepository, matchChanges, monitoredChanges } from '../out/scm-model.js';
import { Status } from '../out/git-status.js';

class EventEmitter {
  callbacks = new Set();
  event = callback => { this.callbacks.add(callback); return { dispose: () => this.callbacks.delete(callback) }; };
  fire(value) { for (const callback of this.callbacks) callback(value); }
  dispose() { this.callbacks.clear(); }
}
const disposable = { dispose() {} }, uri = fsPath => ({ scheme: 'file', fsPath, toString: () => `file:${fsPath}` });
const wire = value => ({ value, encoding: 'utf-8' });
const root = resolve('fake SCM project Кириллица #1'), source = join(root, 'src');
const file = 'Documents/ВыдачаЗайма/Ext/ObjectModule.bsl';
function load(name, overrides = {}, globals = {}) {
  const url = new URL(`../out/${name}.js`, import.meta.url), require = createRequire(url), module = { exports: {} };
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, Buffer, TextDecoder, setTimeout, clearTimeout, ...globals })(
    name => overrides[name] ?? require(name), module, module.exports);
  return module.exports;
}
function change(path = file, status = 5, original = path, base = source) {
  return { uri: uri(join(base, path)), originalUri: uri(join(base, original)), status };
}
function repository(base = root, working = [change()]) {
  const changed = new EventEmitter(), calls = [];
  return { rootUri: uri(base), calls, inputBox: { value: "" },
    state: { HEAD: { commit: 'first', name: 'main' }, indexChanges: [], workingTreeChanges: working, mergeChanges: [], untrackedChanges: [], onDidChange: changed.event },
    status: async () => {}, add: async paths => { calls.push(['add', ...paths]); },
    revert: async paths => { calls.push(['revert', ...paths]); }, clean: async paths => { calls.push(['clean', ...paths]); } };
}
function context(base = root) {
  const requests = [], info = { scope: { kind: 'standalone' }, rootPath: wire(base), sourcePath: wire(join(base, 'src')), generation: 1 };
  return { projects: [{ info }], requests, connection: { state: { kind: 'ready', sourceLabels: true,
    target: { path: base, executable: join(base, 'bin', 'eska-project') } } },
    request: async (project, method, params) => {
      requests.push([project, method, params]);
      return { labels: params.paths.map(path => ({ path, translations: path.value.endsWith('ObjectModule.bsl')
        ? { 'ru-RU': 'Документ.ВыдачаЗайма.МодульОбъекта', 'en-US': 'Document.ВыдачаЗайма.ObjectModule' } : null })) };
    } };
}
const viewId = 'eska.explorer.scm';
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(repositories = [repository()], trees = [context()]) {
  const registered = new Map(), invoked = [], warnings = [], errors = [], snapshots = [];
  const gitChanged = new EventEmitter(), received = new EventEmitter();
  const projects = trees.map(tree => tree.connection.state.target).map(target => ({ root: target.path, projectExecutable: target.executable, mode: 'both' }));
  const git = { retryScm() {}, modeFor: root => projects.find(project => project.root === root || project.root.startsWith(root + '/'))?.mode, onDidChange: gitChanged.event, get repositories() { return this.api.repositories; },
    api: { repositories, getRepository(value) {
      return [...this.repositories].sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length).find(repo =>
        value.fsPath === repo.rootUri.fsPath || value.fsPath.startsWith(repo.rootUri.fsPath + '/'));
    }, toGitUri: (value, ref) => ({ ...value, scheme: 'git', ref }) } };
  const visibility = new EventEmitter();
  const view = { visible: true, onDidChangeVisibility: visibility.event, onDidDispose: () => disposable,
    webview: { cspSource: 'test-webview', asWebviewUri: value => value, onDidReceiveMessage: received.event,
      postMessage: async value => { snapshots.push(value); return true; } } };
  let registeredView;
  const vscode = { env: { language: 'ru' }, ViewColumn: { Active: -1 }, Uri: { file: uri, joinPath: (base, ...parts) => uri(join(base.fsPath, ...parts)) },
    workspace: { isTrusted: true, textDocuments: [], onDidChangeConfiguration: () => disposable,
      getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    window: { registerWebviewViewProvider: (id, provider) => { registeredView = { id, provider }; return disposable; },
      showErrorMessage: async text => { errors.push(text); },
      showWarningMessage: async (...args) => { warnings.push(args); return args.at(-1); } },
    commands: { registerCommand: (name, callback) => { registered.set(name, callback); return disposable; },
      executeCommand: async (...args) => { invoked.push(args); } } };
  const fileActions = load('scm-file-actions', { vscode }, { Error });
  const observed = new Map(), monitor = { targets: [] }, save = { calls: [], modes: [], run: async () => true };
  class ScmMonitors {
    constructor(changed) { monitor.update = (root, snapshot) => { observed.set(root, snapshot); changed(root); }; }
    synchronize(targets) { monitor.targets = targets; }
    get(root) { return observed.get(root); }
    restart() {}
    dispose() {}
  }
  const { MetadataChanges } = load('scm', { vscode, './git-api.js': {}, './scm-file-actions.js': fileActions,
    './scm-monitor.js': { ScmMonitors }, './scm-save.js': { ScmSaveError: class extends Error {}, async saveScmScope(scope, input) {
      scope.validate(); save.calls.push([scope, input]); const saved = await save.run(scope, input);
      if (saved) { save.modes.push(await scope.refresh()); scope.validate(); }
      return saved;
    } } }, { Error });
  const provider = new MetadataChanges({ extensionUri: uri(resolve('.')) }, git, () => 'ru-RU', async () => {}, () => {});
  assert.equal(registeredView.id, viewId);
  registeredView.provider.setTrees(trees);
  registeredView.provider.setProjects(projects);
  registeredView.provider.resolveWebviewView(view);
  const send = async value => { received.fire(value); await flush(); };
  const snapshot = () => snapshots.findLast(value => value.type === 'snapshot');
  const input = () => snapshots.findLast(value => value.type === 'input');
  const pages = () => snapshots.filter(value => value.type === 'rows');
  const requestRows = (group, start, count, revision = snapshot().revision) => send({ type: 'rows', revision, group, start, count });
  const rows = () => snapshot().repositories.flatMap(repo => repo.groups.flatMap(group => group.rows));
  const command = (action, item, overrides) => registered.get(`${viewId}.${action}`)({
    ...item.context, webview: viewId, eskaScmRevision: snapshot().revision, ...overrides,
  });
  const payload = (repository, value, editId) => ({
    repository,
    value,
    editId,
    repositoryToken: snapshot().repositories.find(repo => repo.key === repository)?.repositoryToken,
    revision: snapshot().revision,
  });
  return { provider, vscode, git, gitChanged, invoked, warnings, errors, view, trees, snapshot, input, rows, pages, requestRows, command, send, save, monitor, visibility,
    ready: () => send({ type: 'ready' }),
    refresh: () => registered.get(`${viewId}.refresh`)(),
    edit: (repository, value, editId, overrides) => send({ type: 'message', ...payload(repository, value, editId), ...overrides }),
    commit: (repository, value, editId, commitId, overrides) => send({ type: 'commit', ...payload(repository, value, editId), commitId, ...overrides }),
  };
}

test('semantic labels leave file identities intact and keep index and worktree changes separate', async t => {
  const repo = repository(); repo.state.indexChanges = [change(file, 0)]; repo.state.untrackedChanges = [change('notes.txt', 7)];
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  const [staged, working, untracked] = h.rows();
  assert.equal(h.snapshot().repositories[0].groups.map(group => group.kind).join(','), 'index,working,untracked');
  assert.equal(staged.label, 'Документ.ВыдачаЗайма.МодульОбъекта');
  assert.notEqual(staged.key, working.key);
  assert.equal(staged.context.eskaScmKey, staged.key);
  assert.equal(staged.context.webviewSection, 'scmChange');
  assert.equal(staged.description, join('src', file));
  assert.equal(untracked.label, 'notes.txt');
  assert.equal(untracked.context.eskaScmReveal, false);
  assert.equal(h.trees[0].requests.length, 1);

  await h.command('diff', staged);
  assert.equal(h.invoked[0][0], 'vscode.diff'); assert.equal(h.invoked[0][1].ref, 'HEAD'); assert.equal(h.invoked[0][2].ref, '');
  await h.send({ type: 'action', action: 'openChange', key: working.key, revision: h.snapshot().revision });
  assert.equal(h.invoked[1][0], 'vscode.diff'); assert.equal(h.invoked[1][1].ref, '~');
  await h.command('open', untracked);
  assert.equal(h.invoked[2][0], 'vscode.open'); assert.equal(h.invoked[2][1].fsPath, join(source, 'notes.txt'));
});

test('clicking a deleted row with openDiffOnClick disabled opens the committed path', async t => {
  const repo = repository(root, [change(file, 6)]);
  const h = setup([repo]); t.after(() => h.provider.dispose());
  h.vscode.workspace.getConfiguration = () => ({
    get: (name, fallback) => name === 'openDiffOnClick' ? false : fallback,
  });
  await h.ready();
  const [row] = h.rows();
  await h.send({ type: 'action', action: 'openChange', key: row.key, revision: h.snapshot().revision });
  assert.equal(h.errors.length, 0);
  assert.equal(h.invoked.length, 1);
  const [action, target] = h.invoked[0];
  assert.equal(action, 'vscode.open');
  assert.equal(target.ref, 'HEAD');
  assert.equal(target.fsPath, join(source, file));
});

test('renamed captions and unstage address both real paths', async t => {
  const repo = repository(root, []); repo.state.indexChanges = [change('renamed name.bsl', 3, 'old name.bsl')];
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  const [row] = h.rows();
  assert.equal(row.label, 'old name.bsl → renamed name.bsl');
  await h.command('diff', row);
  assert.equal(h.invoked[0][1].fsPath, join(source, 'old name.bsl'));
  await h.command('unstage', row);
  assert.deepEqual(repo.calls, [['revert', join(source, 'old name.bsl'), join(source, 'renamed name.bsl')]]);
});

test('group actions reject files discovered after the displayed snapshot', async t => {
  const repo = repository(), h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  const group = h.snapshot().repositories[0].groups[0];
  repo.status = async () => { repo.state.workingTreeChanges = [change(), change('newly-discovered.bsl')]; };
  await h.command('stageAll', group);
  assert.equal(repo.calls.length, 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.invoked.length, 0, 'do not delegate an unchecked broad operation to Git');
  await h.command('stageAll', h.snapshot().repositories[0].groups[0]);
  assert.deepEqual(repo.calls, [['add', join(source, file), join(source, 'newly-discovered.bsl')]]);
});

test('opening a merge row opens that row, independently of the context menu and multi-selection', async t => {
  const repo = repository(); repo.state.mergeChanges = [change('conflict.bsl', 18)];
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  const [merge, working] = h.rows();
  await h.send({ type: 'action', action: 'openChange', key: merge.key, revision: h.snapshot().revision,
    selection: [merge.key, working.key] });
  assert.equal(h.invoked.length, 1);
  assert.equal(h.invoked[0][0], 'vscode.open');
  assert.equal(h.invoked[0][1].fsPath, join(source, 'conflict.bsl'));
  assert.equal(h.errors.length, 0);
});

test('multi-root captions use the owning tree and mutations never silently use another repository', async t => {
  const second = resolve('second ESKA repo'), other = repository(second, [change(file, 5, file, join(second, 'src'))]);
  const repo = repository(), trees = [context(), context(second)], h = setup([repo, other], trees); t.after(() => h.provider.dispose());
  await h.ready();
  const rows = h.rows();
  assert.equal(rows.length, 2);
  assert.equal(trees[0].requests.length, 1);
  assert.equal(trees[1].requests.length, 1);
  await h.command('stage', rows[1]);
  assert.equal(repo.calls.length, 0);
  assert.deepEqual(other.calls, [['add', join(second, 'src', file)]]);
  h.git.api.getRepository = () => repo;
  await h.command('discard', h.rows()[1]);
  assert.equal(other.calls.length, 1);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.errors.length, 1);
});

test('large groups publish their count and request semantic names only for the requested pages', async t => {
  const repo = repository(root, Array.from({ length: 513 }, (_, index) => change(`notes/${index}.txt`)));
  repo.state.workingTreeChanges.push(change());
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  const group = h.snapshot().repositories[0].groups[0];
  assert.equal(group.count, 514);
  assert.equal(group.rows, undefined);
  assert.equal(h.trees[0].requests.length, 0);
  await h.requestRows(group.key, 0, 201);
  await h.requestRows(group.key, -1, 1);
  await h.requestRows(group.key, group.count, 1);
  await h.requestRows(group.key, 0, 1, h.snapshot().revision - 1);
  assert.equal(h.pages().length, 0);
  const received = [];
  for (let start = 0; start < group.count; start += 200) {
    await h.requestRows(group.key, start, 200);
    const page = h.pages().at(-1);
    assert.equal(page.revision, h.snapshot().revision);
    assert.equal(page.group, group.key);
    assert.equal(page.start, start);
    received.push(...page.rows);
  }
  assert.equal(received.length, group.count);
  assert.equal(new Set(received.map(row => row.key)).size, group.count);
  assert.deepEqual(received.map(row => row.description), repo.state.workingTreeChanges.map(change => relative(root, change.uri.fsPath)).sort());
  assert.equal(received.find(row => row.description === join('src', file)).label, 'Документ.ВыдачаЗайма.МодульОбъекта');
  await h.requestRows(group.key, 0, 50);
  assert.deepEqual(h.trees[0].requests.map(request => request[2].paths.length), [200, 200, 114]);
});

test('a late page cannot resurrect a closed project', async t => {
  const repo = repository(root, Array.from({ length: 201 }, (_, index) => change(`notes/${index}.txt`)));
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  let release;
  h.trees[0].request = async (_project, _method, { paths }) => new Promise(resolve => {
    release = () => resolve({ labels: paths.map(path => ({ path, translations: null })) });
  });
  await h.requestRows(h.snapshot().repositories[0].groups[0].key, 0, 40);
  assert.equal(typeof release, 'function');
  h.git.modeFor = () => undefined;
  h.provider.setProjects([]);
  h.provider.setTrees([]);
  await h.refresh();
  release();
  await flush();
  assert.equal(h.pages().length, 0);
  assert.equal(h.snapshot().repositories.length, 0);
});

test('commands on paged ranges apply to the exact files across a page boundary', async t => {
  const names = Array.from({ length: 260 }, (_, index) => `notes/${String(index).padStart(3, '0')}.txt`);
  const repo = repository(root, names.map(name => change(name)));
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  const group = h.snapshot().repositories[0].groups[0].key;
  await h.requestRows(group, 128, 1);
  const [target] = h.pages().at(-1).rows;
  const selection = { eskaScmSelectionRanges: [{ group, start: 127, end: 129 }, { group, start: 128, end: 130 }] };
  const old = h.snapshot().revision;
  await h.command('stage', target, selection);
  assert.deepEqual(repo.calls, [['add', ...names.slice(127, 131).map(name => join(source, name))]]);
  await h.command('stage', target, { ...selection, eskaScmRevision: old });
  await h.command('stage', target, { eskaScmSelectionRanges: [{ group, start: 128, end: 260 }] });
  assert.equal(repo.calls.length, 1);
  assert.equal(h.errors.length, 2);
});

test('foreign files, forged contexts, stale revisions and removed rows cannot mutate Git', async t => {
  const repo = repository(root, [change(), change('../outside.bsl', 5, '../outside.bsl', root)]);
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  assert.equal(h.rows().length, 1);
  const [row] = h.rows(), oldRevision = h.snapshot().revision;
  await h.command('stage', row, { webview: 'another.view' });
  await h.command('stage', row, { eskaScmKey: 'missing' });
  await h.command('stage', row, { eskaScmRevision: oldRevision });
  await h.command('stage', row, { eskaScmRevision: undefined });
  h.provider.invalidate();
  await h.command('stage', row);
  assert.equal(h.errors.length, 5);
  repo.state.workingTreeChanges = [];
  await h.command('discard', row);
  assert.equal(repo.calls.length, 0);
  assert.equal(h.warnings.length, 0);
});

test('commit selects the exact repository, shares the native draft and only acknowledges each attempt once', async t => {
  const second = resolve('another commit repository'), first = repository(), other = repository(second, []);
  first.inputBox.value = 'existing first draft';
  other.inputBox.value = 'existing second draft';
  const h = setup([first, other], [context(), context(second)]);
  t.after(() => h.provider.dispose());
  await h.ready();
  assert.equal(h.vscode.window.activeTextEditor, undefined);
  const selected = () => h.snapshot().repositories.find(repo => repo.description === second);
  const key = selected().key;
  assert.equal(selected().message, 'existing second draft');
  assert.equal(typeof selected().repositoryToken, 'string');

  await h.edit(key, 'Message from panel', 1);
  assert.equal(other.inputBox.value, 'Message from panel');
  assert.equal(h.input().acknowledgedEditId, 1);
  assert.equal(h.input().repository, key);
  assert.equal(h.input().message, 'Message from panel');
  assert.ok(!('repositories' in h.input()), 'typing acknowledges only the input, without resending the file list');
  assert.equal(first.inputBox.value, 'existing first draft');
  other.inputBox.value = 'Updated in native Git';
  await h.refresh();
  assert.equal(selected().message, 'Updated in native Git');

  let outcome = 'cancel';
  h.save.run = async () => {
    if (outcome === 'fail') throw new Error('commit failed');
    return outcome === 'success';
  };
  await h.commit(key, 'Retain this message', 2, 1);
  assert.equal(h.save.calls[0][0].root, second);
  assert.equal(h.save.calls[0][0].repositoryRoot, second);
  assert.equal(h.save.calls[0][1], 'Retain this message');
  assert.equal(selected().message, 'Retain this message');
  assert.equal(selected().acknowledgedCommitId, 1);

  outcome = 'fail';
  await h.commit(key, 'Retain this message', 2, 2);
  assert.equal(h.errors.at(-1), 'commit failed');
  assert.equal(selected().message, 'Retain this message');
  assert.equal(selected().acknowledgedCommitId, 2);

  outcome = 'success';
  await h.commit(key, 'Retain this message', 2, 3);
  assert.equal(selected().message, '');
  assert.equal(selected().acknowledgedCommitId, 3);
  await h.commit(key, 'Retain this message', 2, 3);
  await h.commit(key, 'Invalid attempt', 4, 1.5);
  assert.equal(h.save.calls.length, 3);
  assert.equal(h.invoked.length, 0);
  assert.equal(other.inputBox.value, '');
  assert.equal(first.inputBox.value, 'existing first draft');
});

test('commit rejects an unknown or closed repository without using another root', async t => {
  const repo = repository(), h = setup([repo]);
  t.after(() => h.provider.dispose());
  await h.ready();
  const [rootRow] = h.snapshot().repositories;
  await h.commit('unknown repository', 'invalid target', 1, 1);
  h.git.api.repositories = [];
  await h.commit(rootRow.key, 'closed target', 1, 1);
  assert.equal(h.invoked.length, 0);
  assert.equal(h.save.calls.length, 0);
  assert.equal(h.errors.length, 2);
  assert.equal(repo.inputBox.value, '');
});

test('the repository token and SCM revision fence off stale commit messages', async t => {
  const repo = repository(), h = setup([repo]);
  t.after(() => h.provider.dispose());
  await h.ready();
  const [initial] = h.snapshot().repositories;
  await h.commit(initial.key, 'stale revision', 1, 1, { revision: h.snapshot().revision - 1 });
  await h.commit(initial.key, 'invalid token', 1, 2, { repositoryToken: 'unknown token' });
  await h.edit(initial.key, 'invalid token', 1, { repositoryToken: 'unknown token' });
  await h.command('commit', h.rows()[0]);
  assert.equal(h.invoked.length, 0);
  assert.equal(h.save.calls.length, 0);
  assert.equal(repo.inputBox.value, '');
  assert.equal(h.snapshot().repositories[0].acknowledgedCommitId, 1);

  const replacement = repository();
  h.git.api.repositories = [replacement];
  await h.refresh();
  const [current] = h.snapshot().repositories;
  assert.equal(current.key, initial.key);
  assert.notEqual(current.repositoryToken, initial.repositoryToken);
  await h.commit(current.key, 'old repository instance', 1, 2, { repositoryToken: initial.repositoryToken });
  assert.equal(h.invoked.length, 0);
  assert.equal(h.save.calls.length, 0);
  assert.equal(replacement.inputBox.value, '');
});

test('a commit received while one is in flight is acknowledged without running or replacing the draft', async t => {
  const repo = repository(), h = setup([repo]);
  t.after(() => h.provider.dispose());
  await h.ready();
  const [entry] = h.snapshot().repositories;
  let finish;
  h.save.run = () => new Promise(resolve => { finish = resolve; });
  await h.commit(entry.key, 'first message', 1, 1);
  assert.equal(h.save.calls.length, 1);
  try {
    await h.commit(entry.key, 'duplicate click while busy', 2, 2);
    assert.equal(h.errors.length, 1);
    assert.equal(h.snapshot().repositories[0].acknowledgedCommitId, 2);
    assert.equal(repo.inputBox.value, 'first message');
  } finally {
    finish(true);
  }
  await flush();
  assert.equal(h.save.calls.length, 1);
  assert.equal(h.snapshot().repositories[0].acknowledgedCommitId, 2);
});

test('monitor changes reach the semantic list before the native Git status and reuse labels', async t => {
  const repo = repository(root, []), h = setup([repo]);
  t.after(() => h.provider.dispose());
  let scans = 0;
  repo.status = async () => { scans++; };
  await h.ready();
  assert.equal(h.monitor.targets[0].root, root);
  const snapshot = { branch: 'monitor-branch', mergeChanges: [], indexChanges: [], workingTreeChanges: [change()], untrackedChanges: [] };
  h.monitor.update(root, snapshot);
  await h.ready();
  assert.equal(h.snapshot().repositories[0].branch, 'monitor-branch');
  assert.equal(h.rows()[0].label, 'Документ.ВыдачаЗайма.МодульОбъекта');
  h.monitor.update(root, { ...snapshot, untrackedChanges: [change('notes.txt', 7)] });
  await h.ready();
  assert.equal(h.rows().length, 2);
  assert.equal(h.snapshot().repositories[0].groups.length, 1, 'mixed mode groups untracked files with worktree files');
  assert.deepEqual(Array.from(h.trees[0].requests[1][2].paths, path => path.value), ['notes.txt']);
  assert.equal(scans, 0);
  h.view.visible = false;
  h.visibility.fire();
  assert.equal(h.monitor.targets.length, 0);
  const shown = h.snapshot(), lookups = h.trees[0].requests.length;
  h.monitor.update(root, { ...snapshot, workingTreeChanges: [change('hidden.bsl')] });
  await h.provider.publish();
  assert.equal(h.snapshot(), shown);
  assert.equal(h.trees[0].requests.length, lookups);
  h.view.visible = true;
  h.visibility.fire();
  await h.provider.publish();
  assert.equal(h.rows()[0].description, join('src', 'hidden.bsl'));
});

test('native Windows paths, UNC, Cyrillic and spaces retain path boundaries', () => {
  const globals = { process: { platform: 'win32' } };
  const source = load('source', { 'node:path': win32 }, globals);
  const reveal = load('reveal', { 'node:path': win32, './source.js': source }, globals);
  const model = load('scm-model', { 'node:path': win32, './source.js': source, './reveal.js': reveal }, globals);
  const base = 'C:\\Работа #1\\База', current = uri(win32.join(base, 'src', 'Documents', 'Выдача Займа.xml'));
  const renamed = { uri: current, originalUri: uri(win32.join(base, 'src', 'Documents', 'Старое.xml')), status: 3 };
  const labels = new Map([[source.sourceKey(current.fsPath.toUpperCase()), 'Документ.Выдача Займа']]);
  assert.equal(model.changeCaption(renamed, labels), 'Старое.xml → Документ.Выдача Займа');
  assert.equal(model.insideRepository({ rootUri: uri(base) }, renamed), true);
  assert.equal(model.insideRepository({ rootUri: uri(base + '-other') }, renamed), false);
  const unc = '\\\\server\\share\\Работа'; assert.equal(model.insideRepository({ rootUri: uri(unc) }, { uri: uri(unc + '\\file'), originalUri: uri(unc + '\\file'), status: 5 }), true);
  assert.notEqual(changeIdentity(change(), 'index'), changeIdentity(change(), 'working'));
  assert.equal(changeCaption(change(), new Map([[sourceKey(join(root, 'src', file)), 'label']])), 'label');
});

test('one Git observer follows enablement, repository lifetime and disposal without duplicate subscriptions', async () => {
  const enabled = new EventEmitter(), opened = new EventEmitter(), closed = new EventEmitter(), state = new EventEmitter();
  const repo = { rootUri: uri(root), state: { onDidChange: state.event } }, api = { repositories: [repo], onDidOpenRepository: opened.event, onDidCloseRepository: closed.event };
  const extension = { enabled: true, onDidChangeEnablement: enabled.event, getAPI: () => api };
  const { GitRepositories } = load('git-api', {
    vscode: { EventEmitter, extensions: { getExtension: () => ({ activate: async () => extension }) } },
    './scm-repository.js': {}, './scm-monitor.js': { ScmMonitors: class { dispose() {} } },
  }, { AbortController });
  const observer = new GitRepositories(); await new Promise(resolve => setImmediate(resolve));
  const facade = observer.api; assert.deepEqual(Array.from(facade.repositories), [repo]); assert.equal(state.callbacks.size, 1);
  opened.fire({ ...repo }); assert.equal(state.callbacks.size, 1);
  assert.equal(observer.repositories[0], repo);
  closed.fire({ ...repo }); assert.equal(state.callbacks.size, 0); opened.fire({ ...repo }); assert.equal(state.callbacks.size, 1);
  assert.notEqual(observer.repositories[0], repo);
  extension.enabled = false; enabled.fire(false); assert.equal(observer.api, facade); assert.equal(facade.repositories.length, 0); assert.equal(state.callbacks.size, 0);
  extension.enabled = true; enabled.fire(true); assert.equal(state.callbacks.size, 1);
  observer.dispose(); assert.equal(state.callbacks.size, 0); assert.equal(enabled.callbacks.size, 0); assert.equal(opened.callbacks.size, 0);
});

test('monitor rename endpoints reconcile after native status without widening discard selection', async t => {
  for (const action of ['unstage', 'discard']) {
    const repo = repository(root, []), h = setup([repo]);
    t.after(() => h.provider.dispose());
    await h.ready();
    const index = action === 'unstage';
    const old = change('old.bsl', index ? 2 : 6), added = change('new.bsl', index ? 1 : 9);
    h.monitor.update(root, { branch: 'main', mergeChanges: [], indexChanges: index ? [old, added] : [],
      workingTreeChanges: index ? [] : [old, added], untrackedChanges: [] });
    await h.provider.publish();
    repo.status = async () => { repo.state[index ? 'indexChanges' : 'workingTreeChanges'] = [change('new.bsl', index ? 3 : 10, 'old.bsl')]; };
    await h.command(action, h.rows().find(row => row.description.endsWith('new.bsl')));
    if (index) {
      assert.deepEqual(repo.calls, [['revert', join(source, 'old.bsl'), join(source, 'new.bsl')]]);
      assert.deepEqual(h.errors, []);
    } else {
      assert.deepEqual(repo.calls, []);
      assert.equal(h.errors.length, 1);
      assert.equal(h.warnings.length, 0);
    }
  }
});

test('monitor conflict refinement keeps native conflict details available to stage', async t => {
  const base = await mkdtemp(join(process.env.ESKA_TEST_ROOT ?? resolve('../eska-playground'), 'scm-conflict-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = repository(base, []), h = setup([repo], [context(base)]);
  t.after(() => h.provider.dispose()); await h.ready();
  h.monitor.update(base, { branch: 'main', mergeChanges: [change('deleted.bsl', 18, 'deleted.bsl', base)], indexChanges: [], workingTreeChanges: [], untrackedChanges: [] });
  await h.provider.publish();
  repo.status = async () => { repo.state.mergeChanges = [change('deleted.bsl', 14, 'deleted.bsl', base)]; };
  // Cancellation proves refinement reached the native deletion-conflict prompt, without touching disk.
  h.vscode.window.showWarningMessage = async (...args) => { h.warnings.push(args); return undefined; };
  await h.command('stage', h.rows()[0]);
  assert.deepEqual(h.errors, []);
  assert.equal(h.warnings.length, 1);
  assert.deepEqual(repo.calls, []);
});

test('group unstage reconciles a complete rename but rejects newly discovered native files', async t => {
  for (const extra of [false, true]) {
    const repo = repository(root, []), h = setup([repo]);
    t.after(() => h.provider.dispose()); await h.ready();
    h.monitor.update(root, { branch: 'main', mergeChanges: [], indexChanges: [change('old.bsl', 2), change('new.bsl', 1)],
      workingTreeChanges: [], untrackedChanges: [] });
    await h.provider.publish();
    let statuses = 0;
    repo.status = async () => { statuses++; repo.state.indexChanges = [change('new.bsl', 3, 'old.bsl'), ...(extra ? [change('extra.bsl', 1)] : [])]; };
    await h.command('unstageAll', h.snapshot().repositories[0].groups[0]);
    assert.equal(statuses, 1);
    assert.equal(h.errors.length, extra ? 1 : 0);
    assert.equal(repo.calls.length, extra ? 0 : 1);
    if (!extra) assert.deepEqual(repo.calls[0], ['revert', join(source, 'old.bsl'), join(source, 'new.bsl')]);
  }
});

test('a previously confirmed native conflict changing type makes the selection stale', async t => {
  for (const monitored of [false, true]) {
    const repo = repository(root, []), h = setup([repo]);
    t.after(() => h.provider.dispose());
    repo.state.mergeChanges = [change('conflict.bsl', Status.BothModified)];
    await h.ready();
    if (monitored) {
      h.monitor.update(root, { mergeChanges: [change('conflict.bsl', Status.BothModified)],
        indexChanges: [], workingTreeChanges: [], untrackedChanges: [] });
      await h.provider.publish();
    }
    repo.status = async () => { repo.state.mergeChanges = [change('conflict.bsl', Status.DeletedByUs)]; };
    await h.command('stage', h.rows()[0]);
    assert.deepEqual(h.errors, [message(h.vscode.env.language, 'scmChanged')]);
    assert.equal(h.warnings.length, 0);
    assert.deepEqual(repo.calls, []);
  }
});

test('prompt drafts survive failed saves while later edits win on failure and success', async t => {
  for (const outcome of ['failure', 'deferred failure', 'deferred success', 'success']) {
    const repo = repository(), h = setup([repo]);
    t.after(() => h.provider.dispose()); await h.ready();
    const key = h.snapshot().repositories[0].key;
    h.save.run = async scope => {
      if (outcome.startsWith('deferred')) await h.edit(key, 'Later edit', 2);
      scope.acceptMessage('Prompt draft');
      if (outcome.endsWith('failure')) throw new Error('hook refused');
      return true;
    };
    await h.commit(key, '', 1, 1);
    await flush();
    assert.equal(repo.inputBox.value, outcome.startsWith('deferred') ? 'Later edit' : outcome === 'failure' ? 'Prompt draft' : '');
    assert.equal(h.snapshot().repositories[0].message, repo.inputBox.value);
  }
});

test('indexed matches keep independent renames, exact rows, renameUri and repository ownership', () => {
  const repo = repository(root, []);
  const first = { ...change('b.bsl', Status.IndexRenamed, 'a.bsl'), renameUri: uri(join(source, 'b.bsl')) };
  const second = change('d.bsl', Status.IndexRenamed, 'c.bsl');
  const exact = change('other.bsl', Status.IndexModified);
  repo.state.indexChanges = [first, second, exact];
  const available = [change('a.bsl', Status.IndexDeleted), change('b.bsl', Status.IndexAdded),
    change('c.bsl', Status.IndexDeleted), change('d.bsl', Status.IndexAdded), exact];
  const matched = matchChanges(repo, 'index', available);
  assert.equal(matched.get(changeIdentity(available[0], 'index')), first);
  assert.equal(matched.get(changeIdentity(available[1], 'index')), first);
  assert.equal(matched.get(changeIdentity(available[2], 'index')), second);
  assert.equal(matched.get(changeIdentity(exact, 'index')), exact);
  assert.equal(matchChanges(repo, 'index', available, path => !path.endsWith('b.bsl')).has(changeIdentity(available[0], 'index')), false);
  repo.state.indexChanges = [{ ...first, renameUri: uri(join(source, 'other-destination.bsl')) }];
  assert.equal(matchChanges(repo, 'index', available).size, 0, 'a different native destination cannot expand selection');
  repo.state.indexChanges = [first, change('b.bsl', Status.IndexRenamed, 'c.bsl')];
  assert.equal(matchChanges(repo, 'index', available).size, 0, 'competing destination invalidates both inferred renames');
});

test('separate untracked paths cannot complete a rename in the working group', () => {
  const repo = repository(root, []), old = change('old.bsl', Status.Deleted), added = change('new.bsl', Status.Untracked);
  const rename = change('new.bsl', Status.IntentToRename, 'old.bsl');
  repo.state.workingTreeChanges = [rename];
  const snapshot = { mergeChanges: [], indexChanges: [], workingTreeChanges: [old], untrackedChanges: [added] };
  assert.deepEqual(monitoredChanges(repo, 'working', snapshot, 'separate'), [old]);
  assert.deepEqual(monitoredChanges(repo, 'untracked', snapshot, 'separate'), [added]);
  assert.deepEqual(monitoredChanges(repo, 'working', snapshot, 'mixed'), [rename]);
  assert.equal(matchChanges(repo, 'working', [old]).size, 0);
});

test('save refreshes native HEAD around prompts and rejects same-commit branch switches or failed status', async t => {
  for (const outcome of ['unchanged', 'switch', 'status failure', 'closed']) {
    const repo = repository(), h = setup([repo]);
    t.after(() => h.provider.dispose()); await h.ready();
    let branch = 'main', statuses = 0;
    repo.status = async () => {
      statuses++;
      if (outcome === 'status failure' && statuses === 2) throw new Error('status failed');
      repo.state.HEAD = { name: branch, commit: 'same commit' };
    };
    h.save.run = async scope => {
      scope.acceptMessage('Accepted prompt message');
      if (outcome === 'switch') branch = 'other';
      if (outcome === 'closed') h.git.api.repositories = [];
      return true;
    };
    const key = h.snapshot().repositories[0].key;
    await h.commit(key, '', 1, 1);
    await flush();
    assert.equal(repo.inputBox.value, outcome === 'unchanged' ? '' : 'Accepted prompt message');
    assert.equal(h.errors.length, outcome === 'unchanged' ? 0 : 1);
    assert.equal(statuses, outcome === 'unchanged' ? 3 : outcome === 'closed' ? 1 : 2);
    if (outcome === 'switch') {
      h.save.run = async () => true;
      await h.commit(key, repo.inputBox.value, 2, 2);
      assert.equal(repo.inputBox.value, '', 'a conscious retry accepts the refreshed branch');
      assert.equal(h.errors.length, 1);
    }
  }
});

test('failed initial native status cancels before scope or message prompts and preserves the draft', async t => {
  const repo = repository(), h = setup([repo]);
  t.after(() => h.provider.dispose()); await h.ready();
  repo.status = async () => { throw new Error('initial status failed'); };
  await h.commit(h.snapshot().repositories[0].key, 'Existing draft', 1, 1);
  await flush();
  assert.deepEqual(h.errors, ['initial status failed']);
  assert.equal(h.save.calls.length, 0);
  assert.equal(repo.inputBox.value, 'Existing draft');
});

test('commit uses scoped staging from the panel or either refresh, even if a staged row disappears', async t => {
  const repositoryRoot = resolve('save parent'), project = join(repositoryRoot, 'project');
  const inside = change('src/selected.bsl', Status.IndexModified, 'src/selected.bsl', project);
  const outside = change('sibling.bsl', Status.IndexModified, 'sibling.bsl', repositoryRoot);
  const rename = change('sibling.bsl', Status.IndexRenamed, 'project/old.bsl', repositoryRoot);
  for (const [seen, initial, final, expected] of [
    [[outside], [outside], [outside], 'all'],
    [[inside], [], [], 'staged'],
    [[], [inside], [], 'staged'],
    [[], [], [inside], 'staged'],
    [[], [rename], [rename], 'staged'],
  ]) {
    const repo = repository(repositoryRoot, [change('edit', Status.Modified, 'edit', project)]);
    repo.state.indexChanges = seen;
    const h = setup([repo], [context(project)]);
    t.after(() => h.provider.dispose());
    await h.ready();
    const statuses = [initial, final];
    repo.status = async () => { repo.state.indexChanges = statuses.shift() ?? final; };
    await h.commit(h.snapshot().repositories[0].key, 'Commit visible selection', 1, 1);
    assert.deepEqual(h.save.modes, [expected]);
    assert.deepEqual(h.errors, []);
  }
});

test('ordinary Git status does not invalidate an action in the ESKA panel', async t => {
  const repo = repository(), ordinary = repository(resolve('ordinary'), []);
  const h = setup([repo, ordinary]); t.after(() => h.provider.dispose());
  await h.ready();
  const [row] = h.rows();
  h.gitChanged.fire(ordinary);
  await h.command('stage', row);
  assert.deepEqual(repo.calls, [['add', join(source, file)]]);
  assert.deepEqual(h.errors, []);
});

test('autonomous group opens one changes editor for modified, added and deleted paths', async t => {
  const repo = repository(root, [change('a.bsl'), change('b.bsl', Status.Untracked), change('c.bsl', Status.Deleted)]);
  repo.scmProvider = 'eska';
  const h = setup([repo]); t.after(() => h.provider.dispose());
  h.git.api.toGitUri = (uri, ref) => ({ ...uri, scheme: 'eska-scm', ref });
  await h.ready();
  await h.command('openAll', h.snapshot().repositories[0].groups[0]);
  assert.deepEqual(h.errors, []);
  assert.equal(h.invoked.length, 1);
  const [command, , rows] = h.invoked[0];
  assert.equal(command, 'vscode.changes');
  assert.deepEqual(Array.from(rows, ([uri, left, right]) => [uri.fsPath, left?.ref, right?.scheme]), [
    [join(source, 'a.bsl'), '~', 'file'], [join(source, 'b.bsl'), undefined, 'file'], [join(source, 'c.bsl'), '~', undefined],
  ]);
});
