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
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, Buffer, AbortController, AbortSignal, Uint8Array })(name => {
    if (name === 'vscode') return vscode;
    if (name === './scm-monitor.js') {
      if (!real) return { parseScmSnapshot: data => data };
      const nested = { exports: {} }, childUrl = new URL('./scm-monitor.js', url);
      runInNewContext('(function(require,module,exports){' + readFileSync(childUrl, 'utf8') + '\n})', { process, Buffer, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval })(name => name === 'vscode' ? vscode : require(name), nested, nested.exports);
      return nested.exports;
    }
    if (name === './runtime-tools.js' && !real) return { runtimeJson: async (exe, args, options) => { calls.push(args); calls.inputs ??= []; calls.inputs.push(options.input); const data = handler ? await handler(args, options, calls.length) : args[3] === 'scm-blob' ? { content } : {}; return args[2] === 'switch' || data?.operation ? data : { schema_version: 1, operation: args[3].replaceAll('-', '_'), error: null, data }; } };
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

test('selecting a local ref runs the public literal switch with shelves and refreshes once', async () => {
  const { EskaRepository, calls } = load(false, '', (args, options) => {
    if (args[2] === 'switch') {
      assert.equal(options.timeout, 0);
      assert.equal(options.signal, undefined);
      return { schema_version: 1, operation: 'switch', dry_run: false, branch: args.at(-1), saved: {}, restored: null };
    }
    if (args[3] === 'scm-branches') return { branches: [{ name: 'main', name_encoding: 'utf-8' }, { name: 'feature/кириллица', name_encoding: 'utf-8' }, { name: '%FF', name_encoding: 'percent' }] };
    return snapshot('b');
  });
  const root = resolve('repo'), old = new EskaRepository(root, '/eska-vcs', key => key, true, true);
  await assert.rejects(old.checkout('main'), { message: 'scmBranchUpdateRequired' });
  assert.equal(calls.length, 0); old.dispose();
  const repo = new EskaRepository(root, '/eska-vcs', key => key, true, true, true, false, true, true);
  assert.deepEqual(Array.from(await repo.branches()), ['main', 'feature/кириллица']);
  const result = await repo.branchAction({ target: { kind: 'local', name: 'feature/кириллица' } });
  assert.equal(result.saved, true);
  assert.equal(result.restored, false);
  assert.deepEqual(Array.from(calls[1]), ['--project-dir', root, 'switch', '--format', 'json', '--', 'feature/кириллица']);
  assert.equal(calls.filter(args => args[3] === 'scm-status').length, 1);
  assert.equal(repo.state.HEAD.commit, 'b'.repeat(40)); repo.dispose();
});

test('checkout domain failures retain localized explanations and refresh the previous state', async () => {
  for (const [code, message] of [['command', 'scmBranchCheckoutFailed'], ['branch-missing', 'scmBranchMissing'],
    ['target-checked-out', 'scmBranchOccupied'], ['moved-branch', 'scmBranchShelfBlocked']]) {
    const { EskaRepository, calls } = load(false, '', args => args[2] === 'switch'
      ? { schema_version: 1, status: 'error', error: { code } } : snapshot('a'));
    const repo = new EskaRepository(resolve('repo'), '/eska-vcs', key => key, true, true, true, false, false, true);
    await assert.rejects(repo.checkout('feature'), { message });
    assert.equal(calls.filter(args => args[3] === 'scm-status').length, 1); repo.dispose();
  }
});

test('restored provider waits for an asynchronous owner and keeps URI alive across owner disposal', async () => {
  const { EskaRepository, EskaScmFileSystemProvider, vscode } = load();
  const root = resolve('repo'), first = new EskaRepository(root, '/eska-vcs', key => key);
  const second = new EskaRepository(root, '/eska-vcs', key => key);
  let ready, owner = new Promise(resolve => { ready = resolve; });
  const provider = new EskaScmFileSystemProvider(() => owner);
  const uri = first.toGitUri(vscode.Uri.file(resolve(root, 'module.bsl')), '');
  const read = provider.readFile(uri); let completed = false; read.then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false);
  ready(first); await read;
  const events = []; provider.onDidChangeFile(event => events.push(...event));
  owner = second; first.dispose(); assert.equal(events.length, 1);
  assert.equal(events[0].type, vscode.FileChangeType.Changed);
  assert.ok((await provider.readFile(uri)).length > 0);
  const foreign = uri.with({ query: JSON.stringify({ root: resolve('other'), revision: 'head' }) });
  await assert.rejects(provider.readFile(foreign));
  provider.dispose(); second.dispose();
});

test('read-only fallback never caches mutable HEAD or index blobs without a monitor', async () => {
  let reads = 0;
  const { EskaRepository, vscode, calls } = load(false, '', () => ({ content: Buffer.from(String(++reads)).toString('base64') }));
  const root = resolve('repo'), repo = new EskaRepository(root, '/eska-vcs', key => key, false, false, false);
  const file = vscode.Uri.file(resolve(root, 'a'));
  assert.equal(Buffer.from(await repo.readBlob(file, 'index')).toString(), '1');
  assert.equal(Buffer.from(await repo.readBlob(file, 'index')).toString(), '2');
  assert.equal(Buffer.from(await repo.readBlob(file, 'head')).toString(), '3');
  assert.equal(calls.filter(args => args[3] === 'scm-status').length, 0); repo.dispose();
});

test('stat and read retain the monitored cache and use uncached content after ownership changes', async () => {
  const { EskaRepository, EskaScmFileSystemProvider, vscode, calls } = load();
  const root = resolve('repo'), monitored = new EskaRepository(root, '/eska-vcs', key => key);
  let owner = monitored;
  const fallback = new EskaRepository(root, '/eska-vcs', key => key, false, false, false);
  const provider = new EskaScmFileSystemProvider(() => owner), uri = monitored.toGitUri(vscode.Uri.file(resolve(root, 'a')), '');
  monitored.accept(snapshot('a'));
  await provider.stat(uri); await provider.readFile(uri); await provider.stat(uri);
  assert.equal(calls.length, 1);
  monitored.accept(snapshot('b')); await provider.stat(uri); await provider.readFile(uri);
  assert.equal(calls.length, 2);
  owner = fallback; monitored.dispose(); await provider.stat(uri); await provider.readFile(uri);
  assert.equal(calls.length, 4);
  const before = calls.length;
  await assert.rejects(provider.readFile(uri.with({ query: JSON.stringify({ root: resolve('outside'), revision: 'index' }) })));
  assert.equal(calls.length, before); provider.dispose(); fallback.dispose();
});

test('cacheless readers coalesce concurrent blobs but release completed values', async () => {
  let release;
  const { EskaRepository, EskaScmFileSystemProvider, vscode, calls } = load(false, '', () => new Promise(resolve => { release = resolve; }));
  const root = resolve('repo'), repo = new EskaRepository(root, '/eska-vcs', key => key, false, false, false);
  const provider = new EskaScmFileSystemProvider(() => repo), uri = repo.toGitUri(vscode.Uri.file(resolve(root, 'a')), '');
  const stat = provider.stat(uri), read = provider.readFile(uri);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1);
  release({ content: 'YQ==' }); await Promise.all([stat, read]);
  const next = provider.readFile(uri); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 2);
  release({ content: 'Yg==' }); assert.equal(Buffer.from(await next).toString(), 'b');
  provider.dispose(); repo.dispose();
});

test('blob reads retry against the restored owner when a mode transition disposes the monitored owner', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { EskaRepository, EskaScmFileSystemProvider, vscode, calls } = load(false, '', (_args, options, count) => {
    if (count > 1) return { content: 'YQ==' };
    started(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('owner closed')), { once: true }));
  });
  const root = resolve('repo'), monitored = new EskaRepository(root, '/eska-vcs', key => key);
  const fallback = new EskaRepository(root, '/eska-vcs', key => key, false, false, false);
  let owner = monitored;
  const provider = new EskaScmFileSystemProvider(() => owner), uri = monitored.toGitUri(vscode.Uri.file(resolve(root, 'a')), '');
  const read = provider.readFile(uri); await ready;
  owner = fallback; monitored.dispose();
  assert.equal(Buffer.from(await read).toString(), 'a'); assert.equal(calls.length, 2);
  provider.dispose(); fallback.dispose();
});
test('extended branch bridge is capability gated and uses typed literal arguments', async () => {
  const { EskaRepository, calls } = load(false, undefined, args => args[3] === 'scm-refs'
    ? { refs: [{ name: 'origin/topic', kind: 'remote' }] } : { saved: true, restored: false });
  const root = resolve('repo');
  const old = new EskaRepository(root, '/bin/eska-vcs', key => key, true, true);
  await assert.rejects(old.branchRefs(), /scmBranchUpdateRequired/);
  await assert.rejects(old.branchAction({ target: { name: 'HEAD', kind: 'head' }, branch: 'new' }), /scmBranchUpdateRequired/);
  assert.equal(calls.length, 0);
  const repo = new EskaRepository(root, '/bin/eska-vcs', key => key, true, true, true, false, true, true);
  assert.equal((await repo.branchRefs())[0].kind, 'remote');
  const result = await repo.branchAction({ target: { name: 'origin/topic', kind: 'remote' }, branch: 'new/ветка' });
  assert.equal(result.saved, true);
  assert.deepEqual(Array.from(calls[1]), ['--project-dir', root, '__bridge', 'scm-switch', '--kind', 'remote', '--branch', 'new/ветка', '--', 'origin/topic']);
  assert.equal(calls[2][3], 'scm-status');
});

test('history keeps old backends usable and distinguishes a stale cursor from a damaged reply', async t => {
  const { EskaRepository, calls } = load(false, '', async args => {
    if (args.includes('stale')) return { schema_version: 1, operation: 'scm_history', error: 'stale_cursor', data: null };
    if (args.includes('bad')) return { commits: [{ id: 1 }], next_cursor: null };
    return { commits: [], next_cursor: null };
  });
  const root = resolve('history project');
  const repo = new EskaRepository(root, '/bin/eska-vcs', key => key);
  t.after(() => repo.dispose());
  const signal = new AbortController().signal;
  await assert.rejects(repo.history(undefined, signal), { message: 'scmHistoryUpdateRequired' });
  assert.equal(calls.length, 0);
  repo.historyAvailable = true;
  assert.equal((await repo.history(undefined, signal)).commits.length, 0);
  await assert.rejects(repo.history('stale', signal), { code: 'stale_cursor' });
  assert.deepEqual(Array.from(calls.at(-1)), ['--project-dir', root, '__bridge', 'scm-history', '--cursor', 'stale']);
  await assert.rejects(repo.history('bad', signal), { message: 'scmHistoryFailed' });
});
