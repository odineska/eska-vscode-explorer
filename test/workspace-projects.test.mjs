import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Emitter {
  callbacks = new Set();
  event = callback => { this.callbacks.add(callback); return { dispose: () => this.callbacks.delete(callback) }; };
  fire(value) { for (const callback of this.callbacks) callback(value); }
  dispose() { this.callbacks.clear(); }
}
function uri(value) { return { toString: () => value, scheme: value.startsWith("/") ? "file" : value.split(":")[0], fsPath: value }; }
function folder(value, index = 0) { return { uri: uri(value), name: value.split('/').at(-1), index }; }
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(t, folders = [], files = new Map()) {
  const changed = new Emitter(), watchers = [], native = [], stats = [], writes = [], contexts = new Map();
  const created = new Emitter(), deleted = new Emitter(), renamed = new Emitter();
  const vscode = {
    EventEmitter: Emitter, FileType: { File: 1, Directory: 2 },
    Disposable: { from: (...values) => ({ dispose() { for (const value of values) value.dispose(); } }) },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    Uri: { joinPath: (base, part) => uri(`${base.toString()}/${part}`) },
    commands: { async executeCommand(command, key, value) { assert.equal(command, 'setContext'); writes.push([key, value]); contexts.set(key, value); } },
    workspace: {
      workspaceFolders: folders, onDidChangeWorkspaceFolders: changed.event,
      onDidCreateFiles: created.event, onDidDeleteFiles: deleted.event, onDidRenameFiles: renamed.event,
      fs: { async stat(value) {
        const key = value.toString(); stats.push(key);
        const result = files.get(key);
        if (result === undefined) throw new Error('not found');
        return typeof result === 'number' ? { type: result } : result;
      } },
      createFileSystemWatcher(pattern, ignoreCreate, ignoreChange, ignoreDelete) {
        const created = new Emitter(), deleted = new Emitter();
        const watcher = { pattern, ignoreCreate, ignoreChange, ignoreDelete, disposed: false, created, deleted,
          onDidCreate: created.event, onDidDelete: deleted.event,
          dispose() { this.disposed = true; created.dispose(); deleted.dispose(); },
        };
        watchers.push(watcher); return watcher;
      },
    },
  };
  const filesystem = {
    watch(path, options, change) {
      const watcher = { path, options, change, closed: false,
        on(event, callback) { assert.equal(event, 'error'); this.fail = callback; },
        close() { this.closed = true; },
      };
      native.push(watcher);
      return watcher;
    },
  };
  const module = { exports: {} };
  runInNewContext('(function(require,module,exports){' + readFileSync(new URL('../out/workspace-projects.js', import.meta.url), 'utf8') + '\n})')(
    name => { if (name === 'node:fs') return filesystem; assert.equal(name, 'vscode'); return vscode; }, module, module.exports);
  const projects = new module.exports.WorkspaceProjects();
  t.after(() => projects.dispose());
  return { projects, vscode, files, changed, created, deleted, renamed, watchers, native, stats, writes, contexts,
    roots: () => Array.from(projects.folders, value => value.uri.toString()),
    visible: () => contexts.get('eska.hasProject'),
  };
}

test('only root files enable the context, independently of contents, editors and debug state', async t => {
  const roots = ['/work/ordinary', '/work/nested', '/work/parent/child', '/work/directory', '/work/invalid'];
  const files = new Map([
    ['/work/nested/src/eska.toml', 1], ['/work/parent/eska.toml', 1], ['/work/directory/eska.toml', 2],
    ['/work/invalid/eska.toml', 1],
  ]);
  const f = fixture(t, roots.map(folder), files);
  await f.projects.settled();
  assert.equal(f.visible(), true);
  assert.deepEqual(f.roots(), ['/work/invalid']);
  assert.deepEqual(f.stats, roots.map(value => `${value}/eska.toml`));
  for (const watcher of f.watchers) {
    assert.equal(watcher.pattern.pattern, 'eska.toml');
    assert.deepEqual([watcher.ignoreCreate, watcher.ignoreChange, watcher.ignoreDelete], [false, true, false]);
  }
});

test('empty and ordinary workspaces stay hidden without recursive discovery', async t => {
  const f = fixture(t);
  await f.projects.settled();
  assert.equal(f.visible(), false);
  assert.equal(f.watchers.length, 0);
  f.vscode.workspace.workspaceFolders = [folder('remote://host/project')]; f.changed.fire();
  await f.projects.settled();
  assert.equal(f.visible(), false);
  assert.deepEqual(f.stats, ['remote://host/project/eska.toml']);
});

test('editor file operations reconcile root markers while native watchers are still starting', async t => {
  const f = fixture(t, [folder('/work')]);
  await f.projects.settled();
  f.created.fire({ files: [uri('/work/nested/eska.toml'), uri('/eska.toml')] });
  await f.projects.settled(); assert.equal(f.stats.length, 1);
  f.files.set('/work/eska.toml', 1); f.created.fire({ files: [uri('/work/eska.toml')] });
  await f.projects.settled(); assert.equal(f.visible(), true);
  f.files.delete('/work/eska.toml');
  f.renamed.fire({ files: [{ oldUri: uri('/work/eska.toml'), newUri: uri('/work/renamed.toml') }] });
  await f.projects.settled(); assert.equal(f.visible(), false);
  f.files.set('/work/eska.toml', 1);
  f.renamed.fire({ files: [{ oldUri: uri('/work/renamed.toml'), newUri: uri('/work/eska.toml') }] });
  await f.projects.settled(); assert.equal(f.visible(), true);
  f.files.delete('/work/eska.toml'); f.deleted.fire({ files: [uri('/work/eska.toml')] });
  await f.projects.settled(); assert.equal(f.visible(), false);
  f.projects.dispose();
  assert.equal(f.created.callbacks.size + f.deleted.callbacks.size + f.renamed.callbacks.size, 0);
});

test('creation, last-marker deletion and renaming update the same remote-safe root service', async t => {
  const f = fixture(t, [folder('vscode-remote://ssh-remote+server/work/project')]);
  await f.projects.settled();
  const marker = 'vscode-remote://ssh-remote+server/work/project/eska.toml';
  f.files.set(marker, 1); f.watchers[0].created.fire();
  await f.projects.settled(); assert.equal(f.visible(), true);
  f.files.delete(marker); f.files.set(`${marker}.old`, 1); f.watchers[0].deleted.fire();
  await f.projects.settled(); assert.equal(f.visible(), false);
  f.files.set(marker, 1); f.watchers[0].created.fire();
  await f.projects.settled(); assert.equal(f.visible(), true);
  f.files.delete(marker); f.watchers[0].deleted.fire();
  await f.projects.settled(); assert.equal(f.visible(), false);
});

test('multi-root changes retain watchers once, dispose removed folders and retain any matching root', async t => {
  const first = folder('/first'), second = folder('/second', 1);
  const f = fixture(t, [first], new Map([['/second/eska.toml', 1]]));
  await f.projects.settled();
  f.vscode.workspace.workspaceFolders = [first, second]; f.changed.fire();
  await f.projects.settled();
  assert.deepEqual(f.roots(), ['/second']); assert.equal(f.visible(), true);
  f.changed.fire(); await f.projects.settled(); assert.equal(f.watchers.length, 2);
  f.vscode.workspace.workspaceFolders = [first]; f.changed.fire();
  await f.projects.settled();
  assert.equal(f.watchers[1].disposed, true); assert.equal(f.visible(), false);
  f.projects.dispose();
  assert.equal(f.watchers[0].disposed, true); assert.equal(f.changed.callbacks.size, 0);
});

test('a stale positive stat cannot resurrect a removed marker or workspace folder', async t => {
  const stale = deferred();
  const f = fixture(t, [folder('/first')], new Map([['/first/eska.toml', stale.promise]]));
  f.vscode.workspace.workspaceFolders = []; f.changed.fire();
  await f.projects.settled(); assert.equal(f.visible(), false);
  stale.resolve({ type: 1 }); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.visible(), false); assert.deepEqual(f.roots(), []);
  assert.equal(f.writes.some(([, value]) => value), false);
});

test('a newer creation wins over a delayed negative check', async t => {
  const stale = deferred();
  const f = fixture(t, [folder('/first')], new Map([['/first/eska.toml', stale.promise]]));
  f.files.set('/first/eska.toml', 1); f.watchers[0].created.fire();
  await f.projects.settled(); assert.equal(f.visible(), true);
  stale.resolve({ type: 2 }); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.visible(), true); assert.deepEqual(f.roots(), ['/first']);
});

test('disposal wins over an in-flight context write and pending filesystem reads', async t => {
  const f = fixture(t, [folder('/first')], new Map([['/first/eska.toml', 1]]));
  const entered = deferred(), complete = deferred();
  f.vscode.commands.executeCommand = async (_command, key, value) => {
    if (value) { entered.resolve(); await complete.promise; }
    f.contexts.set(key, value);
  };
  await entered.promise;
  f.projects.dispose(); complete.resolve();
  await f.projects.settled(); await Promise.resolve();
  assert.equal(f.visible(), false); assert.deepEqual(f.roots(), []);
});

test('local directory feed covers root marker creation before the provider watcher and stops on disposal', async t => {
  const f = fixture(t, [folder('/work'), folder('vscode-remote://ssh/remote', 1)]);
  await f.projects.settled();
  assert.deepEqual(f.native.map(watcher => watcher.path), ['/work']);
  const watcher = f.native[0];
  assert.equal(watcher.options.persistent, false);
  const before = f.stats.length;
  watcher.change('rename', 'other-file');
  await f.projects.settled();
  assert.equal(f.stats.length, before);
  f.files.set('/work/eska.toml', 1);
  watcher.change('rename', 'eska.toml');
  await f.projects.settled();
  assert.equal(f.visible(), true);
  f.files.delete('/work/eska.toml');
  watcher.change('rename', null);
  await f.projects.settled();
  assert.equal(f.visible(), false);
  watcher.fail(new Error('watcher unavailable'));
  assert.equal(watcher.closed, true);
  watcher.change('rename', 'eska.toml');
  await f.projects.settled();
  assert.equal(f.stats.length, before + 4);
  f.projects.dispose();
  assert.ok(f.watchers.every(watcher => watcher.disposed));
});
