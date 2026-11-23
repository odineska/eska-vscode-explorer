import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve('monitor-repository');
const snapshot = () => ({ schema_version: 1, kind: 'snapshot', repository: { root, root_encoding: 'utf-8', head: 'attached', branch: 'main', branch_encoding: 'utf-8', commit: 'a'.repeat(40) }, changes: [] });
function load(overrides = {}) {
  const url = new URL('../out/scm-monitor.js', import.meta.url), module = { exports: {} }, require = createRequire(url);
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, Buffer, TextDecoder, setTimeout, clearTimeout })(name => {
    if (name === 'vscode') return { Uri: { file: fsPath => ({ fsPath }) } };
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
      assert.deepEqual(Array.from(args), ['--project-dir', root, 'monitor', '--format', 'json']);
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
