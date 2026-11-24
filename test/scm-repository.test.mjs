import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
function load(real = false, content = Buffer.from([255, 254, 65, 0]).toString("base64"), handler) {
  const url = process.env.ESKA_SCM_TEST_OUT_DIR ? pathToFileURL(resolve(process.env.ESKA_SCM_TEST_OUT_DIR, "scm-repository.js")) : new URL('../out/scm-repository.js', import.meta.url), module = { exports: {} }, require = createRequire(url);
  const calls = [], controls = [];
  class Uri {
    constructor(fsPath, scheme = 'file', query = '', fragment = '') { Object.assign(this, { fsPath, scheme, query, fragment }); }
    static file(path) { return new Uri(path); }
    with(update) { return Object.assign(new Uri(this.fsPath, this.scheme, this.query, this.fragment), update); }
  }
  class EventEmitter { listeners = new Set(); event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; }; fire(value) { for (const fn of this.listeners) fn(value); } dispose() { this.listeners.clear(); } }
  const vscode = { scm: { createSourceControl(id, label, rootUri) { const control = { id, label, rootUri, inputBox: {}, disposed: false, dispose() { this.disposed = true; } }; controls.push(control); return control; } }, Uri, EventEmitter, workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, Disposable: class { constructor(fn) { this.dispose = fn; } }, FileType: { File: 1 }, FilePermission: { Readonly: 1 }, FileChangeType: { Changed: 1, Deleted: 3 }, FileSystemError: { NoPermissions: () => new Error('readonly'), FileNotFound: () => new Error('missing') } };
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, Buffer, AbortController, Uint8Array })(name => {
    if (name === 'vscode') return vscode;
    if (name === './scm-monitor.js') {
      if (!real) return { parseScmSnapshot: data => data };
      const nested = { exports: {} }, childUrl = new URL('./scm-monitor.js', url);
      runInNewContext('(function(require,module,exports){' + readFileSync(childUrl, 'utf8') + '\n})', { process, Buffer, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval })(name => name === 'vscode' ? vscode : require(name), nested, nested.exports);
      return nested.exports;
    }
    if (name === './runtime-tools.js' && !real) return { runtimeJson: async (exe, args, options) => { calls.push(args); calls.inputs ??= []; calls.inputs.push(options.input); return { schema_version: 1, operation: args[3].replaceAll('-', '_'), error: null, data: handler ? await handler(args, options, calls.length) : args[3] === 'scm-blob' ? { content } : {} }; } };
    return require(name);
  }, module, module.exports);
  return { ...module.exports, vscode, calls, controls };
}
test('maps HEAD/index and all conflict stages without silently accepting revisions', () => {
  const { revisionForRef } = load();
  for (const [ref, revision] of [['HEAD', 'head'], ['', 'index'], ['~', 'index'], ['~1', 'base'], ['~2', 'ours'], ['~3', 'theirs']]) assert.equal(revisionForRef(ref), revision);
  assert.throws(() => revisionForRef('main'));
});
test('read-only provider retains raw BOM bytes and rejects foreign roots and paths', async () => {
  const { EskaRepository, EskaScmFileSystemProvider, vscode, calls } = load();
  const root = resolve('repo'), repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  const provider = new EskaScmFileSystemProvider(value => value === root ? repo : undefined);
  const uri = repo.toGitUri(vscode.Uri.file(resolve(root, 'file.bsl')), '~2');
  assert.deepEqual(Buffer.from(await provider.readFile(uri)), Buffer.from([255, 254, 65, 0]));
  assert.deepEqual(Array.from(calls[0]), ['--project-dir', root, '__bridge', 'scm-blob', '--revision', 'ours', '--', 'file.bsl']);
  assert.throws(() => repo.toGitUri(vscode.Uri.file(resolve(root, '../outside')), 'HEAD'));
  await assert.rejects(provider.readFile(uri.with({ query: JSON.stringify({ root: resolve('other'), revision: 'head' }) })));
  assert.throws(() => provider.writeFile(uri, Buffer.alloc(0)));
  repo.dispose(); await assert.rejects(provider.readFile(uri));
});
test('accept publishes resident arrays without invoking status commands', () => {
  const { EskaRepository, calls } = load(), repo = new EskaRepository(resolve('repo'), '/bin/eska-vcs', key => key);
  const snapshot = { branch: 'main', commit: 'a'.repeat(40), indexChanges: [], workingTreeChanges: [], mergeChanges: [], untrackedChanges: [] };
  repo.accept(snapshot); assert.equal(repo.state.indexChanges, snapshot.indexChanges); assert.equal(repo.state.HEAD.commit, snapshot.commit); assert.equal(calls.length, 0);
  repo.dispose();
});

test('mutations use one bounded stdin batch and capability rejects writes', async () => {
  const { EskaRepository, calls } = load(), root = resolve('repo');
  const repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  await repo.add([resolve(root, 'a'), resolve(root, 'a'), resolve(root, 'b')]);
  assert.deepEqual(Array.from(calls[0]), ['--project-dir', root, '__bridge', 'scm-files', 'stage', '--paths-stdin']);
  assert.deepEqual(Array.from(calls.inputs[0]), ['a', 'b']);
  await repo.add(Array.from({ length: 2049 }, (_, n) => resolve(root, String(n))));
  const writes = calls.filter(args => args[3] === "scm-files");
  assert.equal(writes.length, 3);
  const count = calls.length;
  const readonly = new EskaRepository(root, '/bin/eska-vcs', key => key, false);
  await assert.rejects(readonly.clean([resolve(root, 'a')]));
  assert.equal(calls.length, count);
  repo.dispose(); readonly.dispose();
});

const backend = process.env.ESKA_VCS_TEST_BINARY ?? resolve('../eska/target/debug/eska-vcs');
test('real ESKA adapter stages, unstages and reads BOM/binary bytes without vscode.git', { skip: !existsSync(backend) }, async () => {
  const playground = resolve('../eska-playground'); await mkdir(playground, { recursive: true });
  const root = await mkdtemp(playground + '/explorer-scm-adapter-');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  const { EskaRepository, EskaScmFileSystemProvider, vscode } = load(true);
  const repo = new EskaRepository(root, backend, key => key);
  const provider = new EskaScmFileSystemProvider(value => value === root ? repo : undefined);
  try {
    git('init', '-q'); git('config', 'user.name', 'ESKA Test'); git('config', 'user.email', 'test@example.invalid');
    const path = resolve(root, 'bom.bsl'), uri = vscode.Uri.file(path), first = Buffer.from([255, 254, 65, 0, 0, 255]), second = Buffer.from([255, 254, 66, 0, 0, 254]);
    await writeFile(path, first); git('add', '--', 'bom.bsl'); git('commit', '-qm', 'fixture');
    await writeFile(path, second); await repo.status();
    assert.equal(repo.state.workingTreeChanges.length, 1);
    const head = repo.toGitUri(uri, 'HEAD'), index = repo.toGitUri(uri, '');
    assert.deepEqual(Buffer.from(await provider.readFile(head)), first);
    await repo.add([path]); assert.equal(repo.state.indexChanges.length, 1); assert.equal(repo.state.workingTreeChanges.length, 0);
    assert.deepEqual(Buffer.from(await provider.readFile(index)), second);
    assert.equal((await provider.stat(index)).size, second.length);
    await repo.revert([path]); assert.equal(repo.state.indexChanges.length, 0); assert.equal(repo.state.workingTreeChanges.length, 1);
    assert.deepEqual(Buffer.from(await provider.readFile(index)), first);
    assert.deepEqual(Buffer.from(await provider.readFile(head)), first);
  } finally { provider.dispose(); repo.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('stat reuses blob reads and snapshot publication refreshes cached diff URIs', async () => {
  const { EskaRepository, EskaScmFileSystemProvider, vscode, calls } = load();
  const root = resolve('repo'), repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  const provider = new EskaScmFileSystemProvider(() => repo), uri = repo.toGitUri(vscode.Uri.file(resolve(root, 'a')), '');
  const events = []; provider.onDidChangeFile(event => events.push(event));
  const before = await provider.stat(uri); await provider.readFile(uri); assert.equal(calls.length, 1);
  repo.accept({ branch: 'main', commit: 'a'.repeat(40), indexChanges: [], workingTreeChanges: [], mergeChanges: [], untrackedChanges: [] });
  const after = await provider.stat(uri); assert.equal(calls.length, 2); assert.ok(after.mtime > before.mtime); assert.equal(events.length, 1);
  provider.dispose(); repo.dispose();
});
test('maximum backend binary payload decodes without regexp stack growth', async () => {
  const bytes = Buffer.alloc(32 * 1024 * 1024, 255);
  const { EskaRepository, vscode } = load(false, bytes.toString('base64'));
  const root = resolve('repo'), repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  const result = await repo.readBlob(vscode.Uri.file(resolve(root, 'binary')), 'head');
  assert.equal(result.length, bytes.length); assert.equal(Buffer.compare(result, bytes), 0); repo.dispose();
});

const snapshot = commit => ({ branch: 'main', commit: commit.repeat(40), indexChanges: [], workingTreeChanges: [], mergeChanges: [], untrackedChanges: [] });
const until = async predicate => { for (let n = 0; n < 30; n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } throw new Error('No progress'); };
test('large selections obey both JSON limits, preserve selection and keep rename endpoints together', async () => {
  const { EskaRepository, calls, vscode } = load(), root = resolve('repo');
  const repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  const state = snapshot('a');
  state.indexChanges = [{ uri: vscode.Uri.file(resolve(root, 'new')), originalUri: vscode.Uri.file(resolve(root, 'old')), status: 3 }];
  repo.accept(state);
  const selected = [...Array.from({ length: 2047 }, (_, n) => String(n)), 'old', ...Array.from({ length: 1300 }, (_, n) => 'ю'.repeat(120) + String(n)), 'new'];
  await repo.revert(selected.map(path => resolve(root, path)));
  const batches = calls.flatMap((args, n) => args[3] === 'scm-files' ? [calls.inputs[n]] : []);
  assert.ok(batches.length >= 3);
  for (const batch of batches) { assert.ok(batch.length <= 2048); assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 262144); }
  assert.deepEqual(batches.flat().sort(), selected.toSorted());
  const renameBatch = batches.find(batch => batch.includes('old')); assert.ok(renameBatch.includes('new'));
  repo.dispose();
});
test('later batch failure reports localized partial completion and refreshes once', async () => {
  let writes = 0;
  const { EskaRepository, calls } = load(false, '', async args => {
    if (args[3] === 'scm-files' && ++writes === 2) throw new Error('backend failure');
    return snapshot('b');
  });
  const root = resolve('repo'), repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  await assert.rejects(repo.clean(Array.from({ length: 3000 }, (_, n) => resolve(root, String(n)))), { message: 'scmPartialFiles' });
  assert.equal(writes, 2); assert.equal(calls.filter(args => args[3] === 'scm-status').length, 1); assert.equal(repo.state.HEAD.commit, 'b'.repeat(40));
  repo.dispose();
});
test('monitor events during status reconcile once and continuous updates never loop', async () => {
  const releases = [];
  const { EskaRepository, calls } = load(false, '', args => new Promise(resolve => releases.push(resolve)));
  const repo = new EskaRepository(resolve('repo'), '/bin/eska-vcs', key => key), events = [];
  repo.state.onDidChange(() => events.push(repo.state.HEAD.commit));
  const status = repo.status(); repo.accept(snapshot('b')); releases.shift()(snapshot('a'));
  await until(() => releases.length === 1);
  repo.accept(snapshot('d')); releases.shift()(snapshot('c'));
  await status;
  assert.equal(repo.state.HEAD.commit, 'd'.repeat(40)); assert.equal(events.length, 1); assert.equal(calls.length, 2);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 2);
  repo.dispose();
});
test('resident event during writes is superseded by post-write status and not lost on failure', async () => {
  let release;
  const { EskaRepository } = load(false, '', args => args[3] === 'scm-files' ? new Promise((resolve, reject) => { release = reject; }) : snapshot('c'));
  const root = resolve('repo'), repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  const write = repo.add([resolve(root, 'a')]); repo.accept(snapshot('b')); release(new Error('failed'));
  await assert.rejects(write); assert.equal(repo.state.HEAD.commit, 'c'.repeat(40)); repo.dispose();
});


test('branch status follows resident HEAD, uses exact root and disposes without any status requests', () => {
  const { EskaRepository, SCM_CHECKOUT, controls, calls } = load();
  const root = resolve('repo'), repo = new EskaRepository(root, '/eska-vcs', key => key);
  repo.accept({ ...snapshot('a'), head: 'attached' }); repo.setBranchStatus(true);
  const control = controls[0];
  assert.equal(control.rootUri.fsPath, root); assert.equal(control.inputBox.visible, false);
  assert.equal(control.statusBarCommands[0].title, '$(git-branch) main');
  assert.equal(control.statusBarCommands[0].command, SCM_CHECKOUT);
  assert.deepEqual(Array.from(control.statusBarCommands[0].arguments), [root]);
  repo.accept({ ...snapshot('b'), head: 'detached', branch: undefined });
  assert.equal(control.statusBarCommands[0].title, '$(git-commit) bbbbbbb');
  repo.accept({ ...snapshot('a'), head: 'unborn', branch: 'new', commit: undefined });
  assert.equal(control.statusBarCommands[0].title, '$(git-branch) new');
  repo.setBranchStatus(false); assert.equal(control.disposed, true); assert.equal(repo.branchStatusEnabled, false);
  repo.setBranchStatus(true); assert.equal(controls.length, 2);
  repo.dispose(); assert.equal(controls[1].disposed, true); assert.equal(calls.length, 0);
});

test('branch bridge checks capability and keeps checkout argument literal with one post-write refresh', async () => {
  const { EskaRepository, calls } = load(false, '', args => args[3] === 'scm-branches'
    ? { branches: [{ name: 'main', name_encoding: 'utf-8' }, { name: 'feature/кириллица', name_encoding: 'utf-8' }, { name: '%FF', name_encoding: 'percent' }] }
    : snapshot('b'));
  const root = resolve('repo'), old = new EskaRepository(root, '/eska-vcs', key => key);
  await assert.rejects(old.branches(), { message: 'scmBranchUpdateRequired' });
  await assert.rejects(old.checkout('main'), { message: 'scmBranchUpdateRequired' });
  assert.equal(calls.length, 0); old.dispose();
  const repo = new EskaRepository(root, '/eska-vcs', key => key, true, true);
  assert.deepEqual(Array.from(await repo.branches()), ['main', 'feature/кириллица']);
  await repo.checkout('feature/кириллица');
  assert.deepEqual(Array.from(calls[1]), ['--project-dir', root, '__bridge', 'scm-checkout', '--', 'feature/кириллица']);
  assert.equal(calls.filter(args => args[3] === 'scm-status').length, 1);
  assert.equal(repo.state.HEAD.commit, 'b'.repeat(40)); repo.dispose();
});
