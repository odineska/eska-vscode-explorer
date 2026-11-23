import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { posix, win32 } from 'node:path';

function fixture(platform = 'linux') {
  const path = platform === 'win32' ? win32 : posix;
  const root = platform === 'win32' ? 'C:\\project\\src' : '/project/src';
  const noop = () => ({ dispose() {} });
  class EventEmitter { event = noop; fire() {} dispose() {} }
  const vscode = { EventEmitter, window: { registerFileDecorationProvider: noop },
    workspace: { onDidChangeConfiguration: noop }, env: { language: 'en' },
    FileDecoration: class { constructor(badge) { this.badge = badge; } }, ThemeColor: class {} };
  const url = new URL('../out/decorations.js', import.meta.url), require = createRequire(url), exports = {};
  const dependencies = { vscode, 'node:path': path,
    './protocol.js': { isRecord: value => !!value && typeof value === 'object', isWirePath: value => !!value },
    './source.js': { nativePath: value => value.value, isFormPayload: () => false },
    './reveal.js': { relativeFile: (root, file) => { const relative = path.relative(root, file); return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : relative; } },
    './messages.js': { message: (_, value) => value }, './git-api.js': {}, './tree.js': { nodeKey: value => value } };
  runInNewContext('(function(require,exports){' + readFileSync(url, 'utf8') + '\n})',
    { process: { platform }, setTimeout, clearTimeout, WeakRef })(name => dependencies[name] ?? require(name), exports);
  const state = { indexChanges: [], workingTreeChanges: [], untrackedChanges: [], mergeChanges: [] };
  const repositories = [{ state }];
  const decorations = new exports.GitDecorations({ onDidChange: noop, api: { repositories } });
  const project = { info: { sourcePath: { value: root } } };
  const change = (file, status) => ({ uri: { scheme: 'file', fsPath: path.join(root, file) }, status });
  const tree = { synchronizeInputs: async () => {}, parent: () => undefined,
    request: async (_, __, { node }) => ({ sources: [{ path: { value: node.source }, role: { kind: node.kind === 'object' ? 'descriptor' : 'module' } }] }) };
  const resolve = (source, kind = 'module') => decorations.resolve(tree,
    { project, node: { id: { source, kind }, parent: 'root', label: { kind: 'other' } } }, decorations.epoch);
  return { decorations, project, state, repositories, change, resolve, path };
}

for (const platform of ['linux', 'win32']) test(`decoration lookup preserves priorities, renames, scope and descendant boundaries (${platform})`, async () => {
  const f = fixture(platform);
  try {
    const { state, change, path } = f;
    const module = path.join('Catalogs', 'Item', 'Ext', 'Module.bsl');
    state.indexChanges.push(change(module, 1));
    state.workingTreeChanges.push(change(module, 5));
    state.mergeChanges.push(change(module, 18));
    const renamed = change(path.join('Catalogs', 'New.xml'), 3);
    renamed.originalUri = change(path.join('Catalogs', 'Old.xml'), 3).uri;
    state.indexChanges.push(renamed);
    // A second repository contributes changes only when they are inside this source root.
    f.repositories.push({ state: { ...state, indexChanges: [], workingTreeChanges: [], mergeChanges: [],
      untrackedChanges: [change(path.join('Catalogs', 'Other', 'Ext', 'Module.bsl'), 7), change(path.join('..', 'foreign.xml'), 7)] } });
    assert.equal((await f.resolve(module)).badge, '!');
    const snapshot = f.decorations.snapshots.get(f.project);
    assert.equal(snapshot.sortedPaths, undefined, 'exact-file requests do not build the prefix index');
    assert.equal(snapshot.files.size, 4, 'duplicate statuses collapse and outside paths are excluded');
    assert.equal((await f.resolve(path.join('Catalogs', 'Old.xml'))).badge, 'R');
    assert.equal((await f.resolve(path.join('Catalogs', 'New.xml'))).badge, 'R');
    assert.equal((await f.resolve(path.join('Catalogs', platform === 'win32' ? 'ITEM.xml' : 'Item.xml'), 'object')).badge, '•');
    assert.ok(snapshot.sortedPaths, 'only a descriptor request builds the shared prefix index');
    assert.equal(await f.resolve(path.join('Catalogs', 'It.xml'), 'object'), undefined, 'prefixes respect directory boundaries');
    assert.equal(await f.resolve(path.join('Catalogs', 'OtherSuffix.xml'), 'object'), undefined);
    f.decorations.invalidate();
    assert.equal(f.decorations.snapshots.size, 0, 'invalidations remain lazy when the tree is hidden');
    state.mergeChanges.length = 0;
    assert.equal((await f.resolve(module)).badge, 'M', 'invalidated snapshots use current priority');
  } finally { f.decorations.dispose(); }
});

test('large snapshot serves exact files without building a descendant index', async () => {
  const f = fixture();
  try {
    f.state.untrackedChanges = Array.from({ length: 100000 }, (_, index) => f.change(`Catalogs/Item${index}/Ext/Module.bsl`, 7));
    for (let index = 0; index < 200; index++) assert.equal((await f.resolve(`Catalogs/Item${index}/Ext/Module.bsl`)).badge, 'U');
    assert.equal(f.decorations.snapshots.get(f.project).sortedPaths, undefined);
  } finally { f.decorations.dispose(); }
});
