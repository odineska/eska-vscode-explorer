import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve, join, win32 } from 'node:path';
import { sourceKey } from '../out/source.js';
import { changeCaption, changeIdentity, insideRepository } from '../out/scm-model.js';

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
  const requests = [], info = { rootPath: wire(base), sourcePath: wire(join(base, 'src')), generation: 1 };
  return { projects: [{ info }], requests, connection: { state: { kind: 'ready', sourceLabels: true } },
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
  const git = { onDidChange: gitChanged.event, get repositories() { return this.api.repositories; },
    api: { repositories, getRepository(value) {
      return [...this.repositories].sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length).find(repo =>
        value.fsPath === repo.rootUri.fsPath || value.fsPath.startsWith(repo.rootUri.fsPath + '/'));
    }, toGitUri: (value, ref) => ({ ...value, scheme: 'git', ref }) } };
  const view = { visible: true, onDidChangeVisibility: () => disposable, onDidDispose: () => disposable,
    webview: { cspSource: 'test-webview', asWebviewUri: value => value, onDidReceiveMessage: received.event,
      postMessage: async value => { snapshots.push(value); return true; } } };
  let registeredView;
  const vscode = { env: { language: 'ru' }, ViewColumn: { Active: -1 }, Uri: { joinPath: (base, ...parts) => uri(join(base.fsPath, ...parts)) },
    workspace: { isTrusted: true, textDocuments: [], onDidChangeConfiguration: () => disposable,
      getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    window: { registerWebviewViewProvider: (id, provider) => { registeredView = { id, provider }; return disposable; },
      showErrorMessage: async text => { errors.push(text); },
      showWarningMessage: async (...args) => { warnings.push(args); return args.at(-1); } },
    commands: { registerCommand: (name, callback) => { registered.set(name, callback); return disposable; },
      executeCommand: async (...args) => { invoked.push(args); } } };
  const fileActions = load('scm-file-actions', { vscode }, { Error });
  const { MetadataChanges } = load('scm', { vscode, './git-api.js': {}, './scm-file-actions.js': fileActions }, { Error });
  const provider = new MetadataChanges({ extensionUri: uri(resolve('.')) }, git, () => 'ru-RU', async () => {}, () => {});
  assert.equal(registeredView.id, viewId);
  registeredView.provider.setTrees(trees);
  registeredView.provider.resolveWebviewView(view);
  const send = async value => { received.fire(value); await flush(); };
  const snapshot = () => snapshots.findLast(value => value.type === 'snapshot');
  const input = () => snapshots.findLast(value => value.type === 'input');
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
  return { provider, vscode, git, invoked, warnings, errors, view, trees, snapshot, input, rows, command, send,
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

test('semantic requests are bounded and a late response cannot resurrect a closed project', async t => {
  const repo = repository(root, Array.from({ length: 513 }, (_, index) => change(`notes/${index}.txt`)));
  const h = setup([repo]); t.after(() => h.provider.dispose());
  await h.ready();
  assert.equal(h.rows().length, 513);
  assert.deepEqual(h.trees[0].requests.map(request => request[2].paths.length), [512, 1]);
  let release;
  h.trees[0].request = async () => new Promise(resolve => { release = resolve; });
  const old = h.refresh();
  await flush();
  assert.equal(typeof release, 'function');
  h.provider.setTrees([]);
  const current = h.refresh();
  await current;
  release({ labels: [] });
  await old;
  assert.equal(h.snapshot().repositories.length, 0);
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
  h.vscode.commands.executeCommand = async (command, target) => {
    h.invoked.push([command, target]);
    if (outcome === 'fail') throw new Error('commit failed');
    if (outcome === 'success') other.inputBox.value = '';
  };
  await h.commit(key, 'Retain this message', 2, 1);
  assert.deepEqual(h.invoked[0], ['git.commit', other.rootUri]);
  assert.equal(h.invoked[0][1], other.rootUri);
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
  assert.equal(h.invoked.length, 3);
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
  assert.equal(replacement.inputBox.value, '');
});

test('a commit received while one is in flight is acknowledged without running or replacing the draft', async t => {
  const repo = repository(), h = setup([repo]);
  t.after(() => h.provider.dispose());
  await h.ready();
  const [entry] = h.snapshot().repositories;
  let finish;
  h.vscode.commands.executeCommand = (...args) => {
    h.invoked.push(args);
    return new Promise(resolve => { finish = resolve; });
  };
  await h.commit(entry.key, 'first message', 1, 1);
  assert.equal(h.invoked.length, 1);
  try {
    await h.commit(entry.key, 'duplicate click while busy', 2, 2);
    assert.equal(h.errors.length, 1);
    assert.equal(h.snapshot().repositories[0].acknowledgedCommitId, 2);
    assert.equal(repo.inputBox.value, 'first message');
  } finally {
    finish();
  }
  await flush();
  assert.equal(h.invoked.length, 1);
  assert.equal(h.snapshot().repositories[0].acknowledgedCommitId, 2);
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
  const { GitRepositories } = load('git-api', { vscode: { EventEmitter, extensions: { getExtension: () => ({ activate: async () => extension }) } } });
  const observer = new GitRepositories(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(observer.api, api); assert.equal(state.callbacks.size, 1);
  opened.fire({ ...repo }); assert.equal(state.callbacks.size, 1);
  assert.equal(observer.repositories[0], repo);
  closed.fire({ ...repo }); assert.equal(state.callbacks.size, 0); opened.fire({ ...repo }); assert.equal(state.callbacks.size, 1);
  assert.notEqual(observer.repositories[0], repo);
  extension.enabled = false; enabled.fire(false); assert.equal(observer.api, undefined); assert.equal(state.callbacks.size, 0);
  extension.enabled = true; enabled.fire(true); assert.equal(state.callbacks.size, 1);
  observer.dispose(); assert.equal(state.callbacks.size, 0); assert.equal(enabled.callbacks.size, 0); assert.equal(opened.callbacks.size, 0);
});
