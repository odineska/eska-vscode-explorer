import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve, posix, win32 } from 'node:path';
const root = resolve('monitor-repository');
const snapshot = () => ({ schema_version: 1, kind: 'snapshot', repository: { root, root_encoding: 'utf-8', head: 'attached', branch: 'main', branch_encoding: 'utf-8', commit: 'a'.repeat(40) }, changes: [] });
function load(overrides = {}, globals = {}) {
  const url = new URL('../out/scm-monitor.js', import.meta.url), module = { exports: {} }, require = createRequire(url);
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, Buffer, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, ...globals })(name => {
    if (name === 'vscode') return overrides.vscode ?? { Uri: { file: fsPath => ({ fsPath }) }, workspace: {
      createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: () => ({dispose(){}}), onDidChange: () => ({dispose(){}}), onDidDelete: () => ({dispose(){}}) }),
      ...Object.fromEntries(['onDidSaveTextDocument', 'onDidCreateFiles', 'onDidDeleteFiles', 'onDidRenameFiles'].map(name => [name, () => ({dispose(){}})]))
    } };
    return overrides[name] ?? require(name);
  }, module, module.exports);
  return module.exports;
}
const waitFor = async predicate => { for (let count = 0; count < 200; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timed out'); };
test('maps all groups, rejects foreign roots and traversal, skips unrepresentable Unix bytes', () => {
  const { parseScmSnapshot } = load(), value = snapshot();
  value.changes = [
    { path: 'a', path_encoding: 'utf-8', index: 'modified', worktree: 'deleted' },
    { path: 'b', path_encoding: 'utf-8', index: null, worktree: 'untracked' },
    { path: 'c', path_encoding: 'utf-8', index: 'conflict', worktree: 'modified' },
  ];
  const result = parseScmSnapshot(value, root);
  assert.equal(result.branch, 'main');
  assert.equal(result.indexChanges[0].status, 0); assert.equal(result.workingTreeChanges[0].status, 6);
  assert.equal(result.untrackedChanges[0].status, 7); assert.equal(result.mergeChanges[0].status, 18);
  assert.throws(() => parseScmSnapshot(value, resolve('elsewhere')));
  value.changes[0].path = '../escape'; assert.throws(() => parseScmSnapshot(value, root));
  value.changes = [{ path: '%FF', path_encoding: 'percent', index: null, worktree: 'untracked' }];
  assert.equal(parseScmSnapshot(value, root).untrackedChanges.length, 0);
  value.schema_version = 2; assert.throws(() => parseScmSnapshot(value, root));
});
test('frames fragmented UTF-8 and multiple lines with a per-line byte bound', () => {
  const { ScmMonitorLines } = load(), output = [], lines = new ScmMonitorLines(value => output.push(value), 24);
  const bytes = Buffer.from(JSON.stringify('Привет') + '\n42\n');
  for (const byte of bytes) lines.push(Buffer.from([byte]));
  assert.equal(output[0], 'Привет'); assert.equal(output[1], 42);
  assert.throws(() => lines.push(Buffer.alloc(25, 65)));
  assert.throws(() => new ScmMonitorLines(() => {}).push(Buffer.from([255, 10])));
});
test('real child streams publish snapshots and remain dormant after death until explicit restart', async () => {
  const children = [], logs = []; let changes = 0, launches = 0;
  const api = load({ './tooling/inspect.js': { findTool: async () => process.execPath }, 'node:child_process': {
    spawn(executable, args, options) {
      launches++; assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.deepEqual(Array.from(args), ['--project-dir', root, 'monitor', '--events-stdin', '--format', 'json']);
      const value = JSON.stringify(snapshot()) + '\n';
      const child = spawn(executable, ['-e', `const s=${JSON.stringify(value)};process.stdout.write(s.slice(0,9));setTimeout(()=>process.stdout.write(s.slice(9)),10);setTimeout(()=>process.exit(0),150);`], { stdio: 'pipe' });
      children.push(child); return child;
    }
  } });
  const monitors = new api.ScmMonitors(() => changes++, message => logs.push(message));
  const target = { root, projectExecutable: '/tools/eska-project' };
  try {
    monitors.synchronize([target, target]); monitors.synchronize([target]);
    await waitFor(() => monitors.get(root)); assert.equal(launches, 1); assert.equal(monitors.get(root).branch, 'main');
    await waitFor(() => logs.length); assert.equal(monitors.get(root), undefined);
    monitors.synchronize([target]); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(launches, 1);
    monitors.restart(root); await waitFor(() => monitors.get(root)); assert.equal(launches, 2);
    monitors.synchronize([]); assert.equal(monitors.get(root), undefined);
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(logs.length, 1); assert.ok(changes >= 3);
  } finally { monitors.dispose(); for (const child of children) child.kill(); }
});
test('late executable discovery cannot start a removed or disposed monitor', async () => {
  let release, launches = 0;
  const api = load({ './tooling/inspect.js': { findTool: () => new Promise(resolve => { release = resolve; }) }, 'node:child_process': { spawn() { launches++; } } });
  const monitors = new api.ScmMonitors(() => {}, () => {});
  monitors.synchronize([{ root, projectExecutable: '/tools/eska-project' }]); monitors.dispose();
  release(process.execPath); await new Promise(resolve => setImmediate(resolve)); assert.equal(launches, 0);
});
test('terminal errors, malformed JSON, and excessive stderr kill only the monitor and fall back once', async () => {
  for (const source of [
    `process.stdout.write(${JSON.stringify(JSON.stringify({schema_version:1,kind:'error',code:'unsupported'})+'\n')})`,
    `process.stdout.write('invalid\\n')`,
    `process.stderr.write(Buffer.alloc(65537,65))`,
  ]) {
    const children = [], logs = [];
    const api = load({ './tooling/inspect.js': { findTool: async () => process.execPath }, 'node:child_process': {
      spawn(executable) { const child = spawn(executable, ['-e', source + ';setInterval(()=>{},1000)'], { stdio: 'pipe' }); children.push(child); return child; }
    } });
    const monitors = new api.ScmMonitors(() => {}, value => logs.push(value));
    try {
      monitors.synchronize([{ root, projectExecutable: '/tools/eska-project' }]);
      await waitFor(() => logs.length); await waitFor(() => children[0].exitCode !== null || children[0].signalCode !== null);
      assert.equal(logs.length, 1); assert.equal(monitors.get(root), undefined);
    } finally { monitors.dispose(); for (const child of children) child.kill(); }
  }
});

test('shares workspace events, bounds backpressure and reconciles on a fixed cadence', async () => {
  const listeners = {}, writes = [], children = [], intervals = []; let watched = 0, disposed = 0;
  const subscribe = name => callback => { listeners[name] = callback; return { dispose() { delete listeners[name]; } }; };
  const vscode = { Uri: { file: fsPath => ({ fsPath }) }, workspace: {
    createFileSystemWatcher(glob) {
      assert.equal(glob, '**/*'); watched++;
      return { dispose() { disposed++; }, onDidCreate: subscribe('create'), onDidChange: subscribe('change'), onDidDelete: subscribe('delete') };
    }, onDidSaveTextDocument: subscribe('save'), onDidCreateFiles: subscribe('created'),
    onDidDeleteFiles: subscribe('deleted'), onDidRenameFiles: subscribe('rename'),
  } };
  const api = load({ vscode, './tooling/inspect.js': { findTool: async () => '/tool' }, 'node:child_process': {
    spawn() {
      const stream = () => Object.assign(new EventEmitter(), { destroy() {} });
      const child = Object.assign(new EventEmitter(), { stdin: stream(), stdout: stream(), stderr: stream(), kill() {} });
      child.stdin.write = data => { writes.push(JSON.parse(data)); return false; };
      children.push(child); return child;
    },
  } }, {
    // Advance long timeouts immediately to exercise a slow first status without sleeping.
    setTimeout(callback, delay) { return setTimeout(callback, delay >= 1000 ? 0 : delay); },
    setInterval(callback, delay) { assert.equal(delay, 30000); intervals.push(callback); return intervals.length; },
    clearInterval() {},
  });
  const monitors = new api.ScmMonitors(() => {}, () => {});
  const uri = path => ({ scheme: 'file', authority: '', fsPath: resolve(root, path) });
  try {
    monitors.synchronize([{ root, projectExecutable: '/tool' }, { root: resolve('second'), projectExecutable: '/tool' }]);
    await waitFor(() => children.length === 2); assert.equal(watched, 1);
    // Child is live but has not published its baseline yet; edits must already reach stdin.
    listeners.change(uri('.git/objects/ab/blob')); listeners.change(uri('.git/logs/HEAD'));
    listeners.change(uri('.git/index.lock'));
    listeners.change(uri('a')); listeners.save({ uri: uri('excluded/b') });
    listeners.rename({ files: [{ oldUri: uri('old'), newUri: uri('new') }] });
    listeners.save({ uri: { scheme: 'eska-protected', fsPath: resolve(root, 'virtual') } });
    await waitFor(() => writes.length === 1);
    assert.deepEqual(writes[0], { schema_version: 1, paths: ['a', 'excluded/b', 'old', 'new'] });
    for (let i = 0; i < 2000; i++) listeners.change(uri(`burst/${i}`));
    intervals[0](); // Fixed recovery cadence is independent of file-event coalescing.
    assert.equal(writes.length, 1);
    children[0].stdin.emit('drain'); await waitFor(() => writes.length === 2);
    assert.deepEqual(writes[1], { schema_version: 1, refresh: true });
    children[0].stdin.emit('drain'); intervals[0]();
    assert.equal(writes[2].refresh, true);
    children[0].stdout.emit('data', Buffer.from(JSON.stringify(snapshot()) + '\n'));
    assert.equal(monitors.get(root).branch, 'main');
    monitors.synchronize([]); assert.equal(disposed, 1); assert.deepEqual(Object.keys(listeners), []);
    children[0].stdout.emit('data', Buffer.from(JSON.stringify(snapshot()) + '\n'));
    assert.equal(monitors.get(root), undefined);
  } finally { monitors.dispose(); }
});

for (const [platform, paths, repositoryRoot, local, foreign, expected] of [
  ['posix', posix, '/work/repo', '/work/repo/dir/модуль.bsl', '/work/repository/file', 'dir/модуль.bsl'],
  ['win32 drive', win32, 'C:\\work\\repo', 'C:\\work\\repo\\dir\\модуль.bsl', 'D:\\work\\repo\\file', 'dir/модуль.bsl'],
  ['win32 UNC', win32, '\\\\server\\share\\repo', '\\\\server\\share\\repo\\dir\\module.bsl', '\\\\server\\other\\repo\\file', 'dir/module.bsl'],
]) test(`routes ${platform} events inside the repository using slash UTF-8 paths`, async () => {
  let observe; const writes = [], stream = () => Object.assign(new EventEmitter(), { destroy() {} });
  const subscribe = () => ({ dispose() {} });
  const api = load({ 'node:path': paths, vscode: { workspace: {
    createFileSystemWatcher: () => ({ dispose() {}, onDidCreate: subscribe, onDidDelete: subscribe,
      onDidChange(callback) { observe = callback; return subscribe(); } }),
    onDidSaveTextDocument: subscribe, onDidCreateFiles: subscribe, onDidDeleteFiles: subscribe, onDidRenameFiles: subscribe,
  } }, './tooling/inspect.js': { findTool: async () => '/tool' }, 'node:child_process': {
    spawn() { return Object.assign(new EventEmitter(), { stdin: Object.assign(stream(), {
      write(data) { writes.push(JSON.parse(data)); return true; },
    }), stdout: stream(), stderr: stream(), kill() {} }); },
  } });
  const monitors = new api.ScmMonitors(() => {}, () => {});
  try {
    monitors.synchronize([{ root: repositoryRoot, projectExecutable: '/tool' }]);
    await new Promise(resolve => setImmediate(resolve));
    observe({ scheme: 'file', authority: platform.includes('UNC') ? 'server' : '', fsPath: local });
    observe({ scheme: 'file', authority: '', fsPath: foreign });
    observe({ scheme: 'file', authority: '', fsPath: paths.join(repositoryRoot, '..', 'outside', 'file') });
    await waitFor(() => writes.length);
    assert.deepEqual(writes, [{ schema_version: 1, paths: [expected] }]);
  } finally { monitors.dispose(); }
});

test('preserves authoritative attached, detached and unborn HEAD identity', () => {
  const { parseScmSnapshot } = load(), value = snapshot();
  let parsed = parseScmSnapshot(value, root);
  assert.equal(parsed.head, 'attached'); assert.equal(parsed.commit, 'a'.repeat(40));
  value.repository.head = 'detached'; value.repository.branch = null; value.repository.branch_encoding = null;
  parsed = parseScmSnapshot(value, root);
  assert.equal(parsed.head, 'detached'); assert.equal(parsed.branch, undefined); assert.equal(parsed.commit, 'a'.repeat(40));
  value.repository.head = 'unborn'; value.repository.commit = null;
  parsed = parseScmSnapshot(value, root);
  assert.equal(parsed.head, 'unborn'); assert.equal(parsed.commit, undefined);
  value.repository.commit = 'a'.repeat(40); assert.throws(() => parseScmSnapshot(value, root));
  value.repository.head = 'attached'; value.repository.commit = null;
  value.repository.branch = 'main'; value.repository.branch_encoding = 'utf-8';
  assert.throws(() => parseScmSnapshot(value, root));
});
test('pairs validated index renames without dropping independent worktree changes', () => {
  const { parseScmSnapshot } = load(), value = snapshot();
  value.changes = [
    { path: 'old #😀.bsl', path_encoding: 'utf-8', index: 'deleted', worktree: null },
    { path: 'new #😀.bsl', path_encoding: 'utf-8', index: 'added', worktree: 'modified' },
  ];
  value.renames = [{ stage: 'index', from: 'old #😀.bsl', from_encoding: 'utf-8', to: 'new #😀.bsl', to_encoding: 'utf-8' }];
  const result = parseScmSnapshot(value, root);
  assert.equal(result.indexChanges.length, 1);
  const change = result.indexChanges[0];
  assert.equal(change.status, 3);
  assert.equal(change.uri.fsPath, resolve(root, 'new #😀.bsl'));
  assert.equal(change.originalUri.fsPath, resolve(root, 'old #😀.bsl'));
  assert.equal(change.renameUri.fsPath, change.uri.fsPath);
  assert.equal(result.workingTreeChanges.length, 1); assert.equal(result.workingTreeChanges[0].status, 5);
  for (const mutate of [
    data => data.renames.push(data.renames[0]),
    data => { data.renames[0].from = '../outside'; },
    data => { data.renames[0].to = 'unrelated'; },
    data => { data.renames[0].stage = 'worktree'; },
    data => { data.changes[0].index = 'modified'; },
    data => { data.renames = {}; },
  ]) { const invalid = structuredClone(value); mutate(invalid); assert.throws(() => parseScmSnapshot(invalid, root)); }
});
test('maps every index conflict stage combination to native Git status', () => {
  const { parseScmSnapshot } = load(), statuses = [undefined, 17, 12, 15, 13, 14, 16, 18];
  for (let mask = 1; mask < 8; mask++) {
    const value = snapshot();
    value.changes = [{ path: 'conflict', path_encoding: 'utf-8', index: 'conflict', worktree: 'modified' }];
    value.conflicts = [{ path: 'conflict', path_encoding: 'utf-8', base: Boolean(mask & 1), ours: Boolean(mask & 2), theirs: Boolean(mask & 4) }];
    const result = parseScmSnapshot(value, root);
    assert.equal(result.mergeChanges[0].status, statuses[mask]);
    assert.equal(result.mergeChanges[0].originalUri.fsPath, resolve(root, 'conflict'));
    assert.equal(result.indexChanges.length, 0); assert.equal(result.workingTreeChanges.length, 0);
  }
});
test('rejects optional metadata not justified by complete snapshot paths and states', () => {
  const { parseScmSnapshot } = load(), value = snapshot();
  value.changes = [{ path: 'conflict', path_encoding: 'utf-8', index: 'conflict', worktree: null }];
  value.conflicts = [{ path: 'conflict', path_encoding: 'utf-8', base: true, ours: true, theirs: true }];
  for (const mutate of [
    data => { data.conflicts[0].path = 'unrelated'; },
    data => { data.conflicts[0].path = '../escape'; },
    data => { data.conflicts[0].ours = 1; },
    data => { Object.assign(data.conflicts[0], {base:false,ours:false,theirs:false}); },
    data => { data.conflicts.push(data.conflicts[0]); },
    data => { data.changes[0].index = 'modified'; },
    data => { data.conflicts = {}; },
    data => { data.changes.push(data.changes[0]); },
  ]) { const invalid = structuredClone(value); mutate(invalid); assert.throws(() => parseScmSnapshot(invalid, root)); }
  // Older monitor snapshots have no metadata and retain conservative conflict status.
  delete value.conflicts;
  assert.equal(parseScmSnapshot(value, root).mergeChanges[0].status, 18);
});

test('maps several independent rename pairs regardless of snapshot ordering', () => {
  const { parseScmSnapshot } = load(), value = snapshot();
  value.changes = ['new-a', 'old-b', 'old-a', 'new-b'].map(path => ({ path, path_encoding: 'utf-8', index: path.startsWith('old') ? 'deleted' : 'added', worktree: null }));
  value.renames = ['a', 'b'].map(suffix => ({stage:'index',from:`old-${suffix}`,from_encoding:'utf-8',to:`new-${suffix}`,to_encoding:'utf-8'}));
  const parsed = parseScmSnapshot(value, root);
  assert.equal(parsed.indexChanges.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(parsed.indexChanges[i].status, 3);
    assert.equal(parsed.indexChanges[i].uri.fsPath, resolve(root, `new-${i === 0 ? 'a' : 'b'}`));
    assert.equal(parsed.indexChanges[i].originalUri.fsPath, resolve(root, `old-${i === 0 ? 'a' : 'b'}`));
  }
});
