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
  return { rootUri: uri(base), calls,
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
function setup(repositories = [repository()], trees = [context()]) {
  const registered = new Map(), invoked = [], warnings = [], errors = [], changed = new EventEmitter();
  const git = { onDidChange: changed.event, get repositories() { return this.api.repositories; }, api: { repositories, getRepository: value => repositories.find(repo => value.fsPath.startsWith(repo.rootUri.fsPath + '/')),
    toGitUri: (value, ref) => ({ ...value, scheme: 'git', ref }) } };
  const view = { onDidChangeVisibility: () => disposable, dispose() {} };
  const vscode = { env: { language: 'ru' }, EventEmitter, TreeItemCollapsibleState: { None: 0, Expanded: 2 },
    TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
    ThemeIcon: class { constructor(id, color) { Object.assign(this, { id, color }); } }, ThemeColor: class { constructor(id) { this.id = id; } },
    workspace: { isTrusted: true, textDocuments: [], onDidChangeConfiguration: () => disposable, getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    window: { createTreeView: () => view, showErrorMessage: text => { errors.push(text); },
      showWarningMessage: async (...args) => { warnings.push(args); return args.at(-1); } },
    commands: { registerCommand: (name, callback) => { registered.set(name, callback); return disposable; }, executeCommand: async (...args) => { invoked.push(args); } } };
  let fileVersion = 1;
  const fs = { lstat: async () => ({ dev: 1n, ino: 2n, size: 5n, mtimeNs: BigInt(fileVersion), ctimeNs: 1n }) };
  const { MetadataChanges } = load('scm', { vscode, './git-api.js': {}, 'node:fs/promises': fs });
  const provider = new MetadataChanges(git, () => 'ru-RU', async () => {}, () => {});
  provider.setTrees(trees);
  return { provider, vscode, git, registered, invoked, warnings, errors, view, trees,
    updateFile: () => { fileVersion++; },
    command: (action, ...args) => registered.get(`eska.explorer.scm.${action}`)(...args),
    rows: async () => (await provider.getChildren()).flatMap(repo => repo.groups.flatMap(group => group.entries)) };
}

test('SCM adds its own view without altering the native Git UI or user settings', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.contributes.views.scm, [{ id: 'eska.explorer.scm', name: '%scmView%', when: 'eska.hasProject', visibility: 'visible' }]);
  for (const command of ['open', 'diff', 'stage', 'unstage', 'discard', 'refresh']) {
    assert.ok(manifest.contributes.commands.some(item => item.command === `eska.explorer.scm.${command}`));
  }
});

test('semantic labels leave file identities intact and keep index and worktree changes separate', async t => {
  const repo = repository(); repo.state.indexChanges = [change(file, 0)]; repo.state.untrackedChanges = [change('notes.txt', 7)];
  const h = setup([repo]); t.after(() => h.provider.dispose());
  const rows = await h.rows(); assert.equal(rows.length, 3);
  h.git.api.getRepository = () => ({ ...repo });
  assert.equal(rows[0].label, 'Документ.ВыдачаЗайма.МодульОбъекта'); assert.notEqual(rows[0].key, rows[1].key);
  assert.equal(rows[2].label, 'notes.txt');
  const item = h.provider.getTreeItem(rows[0]); assert.equal(item.resourceUri, rows[0].change.uri);
  assert.ok(item.description.includes('src')); assert.equal(h.trees[0].requests.length, 1);
  await h.command('diff', rows[0]);
  assert.equal(h.invoked[0][0], 'vscode.diff'); assert.equal(h.invoked[0][1].ref, 'HEAD'); assert.equal(h.invoked[0][2].ref, '');
  await h.rows(); await h.command('diff', (await h.rows())[1]); assert.equal(h.invoked[1][0], 'git.openChange');
  await h.command('open', (await h.rows())[2]); assert.equal(h.invoked[2][0], 'vscode.open');
});

test('renamed captions and unstage address both real paths', async t => {
  const repo = repository(root, []); repo.state.indexChanges = [change('renamed name.bsl', 3, 'old name.bsl')];
  const h = setup([repo]); t.after(() => h.provider.dispose());
  const [row] = await h.rows(); assert.equal(row.label, 'old name.bsl → renamed name.bsl');
  await h.command('diff', row); assert.equal(h.invoked[0][1].fsPath, join(source, 'old name.bsl'));
  await h.command('unstage', (await h.rows())[0]);
  assert.deepEqual(repo.calls, [['revert', join(source, 'renamed name.bsl'), join(source, 'old name.bsl')]]);
});

test('multi-root captions use the owning tree and mutations never silently use another repository', async t => {
  const second = resolve('second ESKA repo'), other = repository(second, [change(file, 5, file, join(second, 'src'))]);
  const repo = repository(), trees = [context(), context(second)], h = setup([repo, other], trees); t.after(() => h.provider.dispose());
  const rows = await h.rows(); assert.equal(rows.length, 2); assert.equal(trees[0].requests.length, 1); assert.equal(trees[1].requests.length, 1);
  await h.command('stage', rows[1]); assert.equal(repo.calls.length, 0); assert.equal(other.calls[0][0], 'add');
  const fresh = await h.rows(); h.git.api.getRepository = () => repo;
  await h.command('discard', fresh[1]); assert.equal(other.calls.length, 1); assert.equal(h.warnings.length, 0); assert.equal(h.errors.length, 1);
});

test('semantic requests are bounded, changed-path only, and late tree responses are ignored', async t => {
  const repo = repository(root, Array.from({ length: 513 }, (_, index) => change(`notes/${index}.txt`)));
  const h = setup([repo]); t.after(() => h.provider.dispose());
  assert.equal((await h.rows()).length, 513); assert.deepEqual(h.trees[0].requests.map(request => request[2].paths.length), [512, 1]);
  let release; h.trees[0].request = async () => new Promise(resolve => { release = resolve; });
  h.provider.invalidate(); const old = h.rows(); await Promise.resolve();
  h.provider.setTrees([]); release({ labels: [] }); assert.equal((await old).length, 0); assert.equal((await h.rows()).length, 0);
});

test('closed projects, foreign files and stale rows cannot mutate repositories', async t => {
  const repo = repository(), h = setup([repo]); t.after(() => h.provider.dispose());
  const [row] = await h.rows(); repo.state.workingTreeChanges = [];
  await h.command('discard', row); assert.equal(repo.calls.length, 0); assert.equal(h.warnings.length, 0);
  repo.state.workingTreeChanges = [change()]; h.provider.invalidate(); const [fresh] = await h.rows();
  h.git.api.repositories = []; await h.command('stage', fresh); assert.equal(repo.calls.length, 0);
  assert.equal(insideRepository(repo, change('../outside.bsl', 5, '../outside.bsl', root)), false);
});

test('discard requires confirmation and rejects a file edited while the dialog is open', async t => {
  const repo = repository(), h = setup([repo]); t.after(() => h.provider.dispose());
  let [row] = await h.rows(); h.vscode.window.showWarningMessage = async () => undefined;
  await h.command('discard', row); assert.equal(repo.calls.length, 0);
  [row] = await h.rows(); h.vscode.window.showWarningMessage = async (...args) => { h.updateFile(); return args.at(-1); };
  await h.command('discard', row); assert.equal(repo.calls.length, 0); assert.equal(h.errors.length, 1);
  [row] = await h.rows(); h.vscode.window.showWarningMessage = async (...args) => args.at(-1);
  await h.command('discard', row); assert.equal(repo.calls[0][0], 'clean');
});

test('unsaved editors, branch changes and unresolved conflicts have explicit preflight', async t => {
  const repo = repository(), h = setup([repo]); t.after(() => h.provider.dispose());
  h.vscode.workspace.textDocuments = [{ uri: uri(join(source, file)), isDirty: true }];
  await h.command('discard', (await h.rows())[0]); assert.equal(repo.calls.length, 0); assert.equal(h.warnings.length, 0);
  h.vscode.workspace.textDocuments = []; h.vscode.window.showWarningMessage = async (...args) => { repo.state.HEAD = { commit: 'new' }; return args.at(-1); };
  await h.command('discard', (await h.rows())[0]); assert.equal(repo.calls.length, 0);
  repo.state.workingTreeChanges = []; repo.state.mergeChanges = [change(file, 18)]; h.provider.invalidate();
  h.vscode.window.showWarningMessage = async () => undefined;
  await h.command('stage', (await h.rows())[0]); assert.equal(repo.calls.length, 0);
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
