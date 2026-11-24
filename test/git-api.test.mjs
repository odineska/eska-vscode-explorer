import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
function setup({ folders = ['/repo'], nativeRoots = ['/repo'], mutations = true, fail = false, ignored = [], gitEnabled = true, nativeAvailable = true, apiKeepsClosed = false, oldCli = false, trusted = true, recovery = [] } = {}) {
  class Emitter {
    listeners = new Set(); event = callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; };
    fire(value) { for (const callback of this.listeners) callback(value); } dispose() { this.listeners.clear(); }
  }
  class Uri { constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; } static file(path) { return new Uri(path); } static joinPath(uri, path) { return Uri.file(uri.fsPath + '/' + path); } }
  const commands = new Map(), notices = [], picks = []; let pick;
  const open = new Emitter(), close = new Emitter(), calls = [], storage = new Map([["eska.scm.closedRepositories.v1", recovery]]);
  let monitor, discoveries = 0, providerOptions, resolveReader;
  const closedRoots = new Set(recovery.map(value => typeof value === 'string' ? value : value.root));
  const repo = root => { const changed = new Emitter(); return { rootUri: Uri.file(root), inputBox: { value: '' }, state: { onDidChange: changed.event }, emitState() { changed.fire(); } }; };
  const repositories = nativeRoots.map(repo);
  const native = { getRepository(uri) { return repositories.find(repo => repo.rootUri.fsPath === uri.fsPath) ?? null; }, repositories, onDidOpenRepository: open.event, onDidCloseRepository: close.event,
    async openRepository(uri) { calls.push(['open', uri.fsPath]); if (apiKeepsClosed && closedRoots.has(uri.fsPath)) return null; let value = repositories.find(item => item.rootUri.fsPath === uri.fsPath); if (!value) { value = repo(uri.fsPath); repositories.push(value); open.fire(value); } return value; },
    toGitUri(uri) { return { ...uri, scheme: 'git' }; } };
  const vscode = { Uri, EventEmitter: Emitter, workspace: {
    isTrusted: trusted, textDocuments: [], onDidGrantWorkspaceTrust: new Emitter().event, onDidChangeConfiguration: new Emitter().event, onDidChangeWorkspaceFolders: new Emitter().event, workspaceFolders: folders.map(path => ({ uri: Uri.file(path) })), registerFileSystemProvider(scheme, provider, options) { providerOptions = options; return { dispose() {} }; },
    getConfiguration() { return { get(key, fallback) { return key === 'enabled' ? gitEnabled : key === 'ignoredRepositories' ? ignored : fallback; } }; },
  }, extensions: { getExtension() { return nativeAvailable ? { activate: async () => ({ enabled: true, getAPI: () => native, onDidChangeEnablement: new Emitter().event }) } : undefined; } },
    window: { async showQuickPick(items, options) { picks.push({ items, options }); return typeof pick === 'function' ? pick(items) : items.find(item => item.name === pick); }, showErrorMessage(message) { notices.push(message); }, showWarningMessage(message) { notices.push(message); }, showInformationMessage(message) { notices.push(message); } },
    commands: { registerCommand(name, handler) { commands.set(name, handler); return { dispose() { commands.delete(name); } }; }, async executeCommand(command, uri) {
      const path = typeof uri === 'string' ? uri : uri.fsPath;
      calls.push([command, path]);
      if (command === 'git.openRepository') {
        assert.equal(typeof uri, 'string'); closedRoots.delete(path);
        const value = repo(path); repositories.push(value); open.fire(value); return;
      }
      closedRoots.add(path);
      const i = repositories.findIndex(value => value.rootUri.fsPath === path); if (i >= 0) close.fire(repositories.splice(i, 1)[0]);
    } } };
  class EskaRepository { constructor(root, executable, text, mutationsAvailable, branchesAvailable, cacheBlobs = true) { Object.assign(this, repo(root)); this.executable = executable; this.mutationsAvailable = mutationsAvailable; this.branchesAvailable = branchesAvailable; this.cacheBlobs = cacheBlobs;
    const changed = new Emitter(); this.onDidChangeInput = changed.event; let draft = '';
    this.inputBox = { get value() { return draft; }, set value(value) { draft = value; changed.fire(value); } };
  } async branches() { return ['main', 'feature']; } async checkout(branch) { calls.push(['checkout', this.rootUri.fsPath, branch]); } invalidateContent() {} setBranchStatus(value) { this.branchStatusEnabled = value; } accept() {} async status() { calls.push(['status', this.rootUri.fsPath]); if (fail) throw new Error('failed'); } dispose() {} toGitUri(uri) { return { ...uri, scheme: 'eska-scm' }; } }
  const url = new URL('../out/git-api.js', import.meta.url), module = { exports: {} }, require = createRequire(url);
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, AbortController, setTimeout, clearTimeout, queueMicrotask })(name => {
    if (name === 'vscode') return vscode;
    if (name === './scm-monitor.js') return { ScmMonitors: class { snapshots = new Map(); constructor(changed) { this.changed = changed; monitor = this; } synchronize(targets) { for (const target of targets) { if (!this.snapshots.has(target.root)) { if (!fail) this.snapshots.set(target.root, {}); queueMicrotask(() => this.changed(target.root)); } } } get(root) { return this.snapshots.get(root); } dispose() {} } };
    if (name === './source.js') return { sourceKey: path => path };
    if (name === './scm-repository.js') return { EskaRepository, EskaScmFileSystemProvider: class { constructor(resolve) { resolveReader = resolve; } dispose() {} }, SCM_SCHEME: 'eska-scm', SCM_CHECKOUT: 'eska.explorer.scm.checkout',
      discoverScmRoot: async () => { discoveries++; return oldCli ? undefined : { root: '/repo', executable: '/eska-vcs', mutationsAvailable: mutations, branchesAvailable: true }; } };
    return require(name);
  }, module, module.exports);
  const owner = new module.exports.GitRepositories();
  owner.configureScm({ workspaceState: { get: (key, fallback) => storage.get(key) ?? fallback, update: async (key, value) => { storage.set(key, value); } } }, key => key, () => {});
  const settled = async () => { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { owner, calls, repositories, settled, EskaRepository, Uri, commands, notices, picks, vscode, reader: root => resolveReader(root), setPick(value) { pick = value; }, providerOptions: () => providerOptions, discoveryCount: () => discoveries, openNative: root => native.openRepository(Uri.file(root)), duplicateNative: root => open.fire(repo(root)), setOldCli: value => { oldCli = value; }, setFailure: value => { fail = value; }, failMonitor(root) { monitor.snapshots.delete(root); monitor.changed(root); }, contains: module.exports.containsScmRoot };
}
test('takes ownership only after valid status and restores draft on mode change', async () => {
  const { owner, calls, repositories, settled, EskaRepository } = setup();
  repositories[0].inputBox.value = 'draft'; await settled();
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.deepEqual(calls, [['git.close', '/repo']]);
  assert.ok(owner.repositories[0] instanceof EskaRepository); assert.equal(owner.repositories[0].inputBox.value, 'draft');
  owner.repositories[0].inputBox.value = 'edited';
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'vscode' }]); await settled();
  assert.equal(repositories[0].inputBox.value, 'edited'); assert.equal(owner.repositories[0], repositories[0]);
  await owner.releaseScm(); owner.dispose();
});
test('mixed checkout ownership retains native and nested repository routing', async () => {
  const { owner, calls, settled, Uri } = setup({ folders: ['/repo/one', '/repo/ordinary'], nativeRoots: ['/repo', '/repo/nested'] });
  await settled(); owner.setScmProjects([{ root: '/repo/one', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(owner.modeFor('/repo'), 'both'); assert.ok(!calls.some(call => call[0] === 'git.close'));
  assert.equal(owner.api.getRepository(Uri.file('/repo/nested/file')).rootUri.fsPath, '/repo/nested');
  await owner.releaseScm(); owner.dispose();
});
test('failed snapshot, missing mutations and explicit Git opt outs never close native', async () => {
  for (const options of [{ fail: true }, { mutations: false }, { gitEnabled: false }, { ignored: ['/repo'] }]) {
    const { owner, calls, settled } = setup(options); await settled();
    owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
    assert.ok(!calls.some(call => call[0] === 'git.close')); assert.equal(owner.repositories.length, 1);
    await owner.releaseScm(); owner.dispose();
  }
});
test('provides independent SCM and branch switching in both mode without the native extension', async () => {
  const { owner, calls, commands, setPick, settled, EskaRepository, Uri } = setup({ nativeAvailable: false });
  const projects = [{ root: '/repo', projectExecutable: '/project', mode: 'both' }];
  owner.setScmProjects(projects); await settled(); owner.setScmProjects(projects); await settled();
  assert.ok(owner.repositories[0] instanceof EskaRepository); assert.equal(calls.filter(call => call[0] === 'status').length, 0);
  assert.equal(owner.api.toGitUri(Uri.file('/repo/file'), 'HEAD').scheme, 'eska-scm');
  assert.equal(owner.repositories[0].branchStatusEnabled, true);
  setPick('feature');
  await commands.get('eska.explorer.scm.checkout')('/repo');
  assert.deepEqual(calls.at(-1), ['checkout', '/repo', 'feature']);
  await owner.releaseScm(); owner.dispose();
});
test('manually closed native roots still have ESKA SCM and are never reopened', async () => {
  const { owner, calls, settled } = setup({ nativeRoots: [] }); await settled();
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(owner.repositories.length, 1); assert.equal(calls.length, 0); await owner.releaseScm(); owner.dispose();
});

test('resident monitor failure restores only the checkout closed by ESKA', async () => {
  const { owner, calls, settled, failMonitor } = setup({ folders: ['/repo', '/ordinary'], nativeRoots: ['/repo', '/ordinary'] });
  await settled(); owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  failMonitor('/repo'); await settled();
  assert.deepEqual(calls, [['git.close', '/repo'], ['open', '/repo']]);
  assert.equal(owner.repositories.length, 2); await owner.releaseScm(); owner.dispose();
});
test('reload recovery restores stored draft and shutdown does not reopen unrelated roots', async () => {
  const { owner, calls, repositories, settled } = setup({ nativeRoots: ['/ordinary'], recovery: [{ root: '/repo', draft: 'saved draft' }] });
  await settled(); assert.equal(repositories.some(repo => repo.rootUri.fsPath === '/repo'), false);
  owner.setScmProjects([]); await settled(); assert.equal(repositories.find(repo => repo.rootUri.fsPath === '/repo').inputBox.value, 'saved draft');
  await owner.releaseScm(); owner.dispose(); assert.deepEqual(calls, [['open', '/repo']]);
});

test('untrusted workspace never starts autonomous SCM or closes native Git', async () => {
  const { owner, calls, settled } = setup({ trusted: false }); await settled();
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(owner.repositories.length, 1); assert.equal(calls.length, 0); await owner.releaseScm(); owner.dispose();
});
test('native-only selection needs no backend and mode transitions reuse discovery', async () => {
  const { owner, settled, discoveryCount, openNative } = setup(); await settled();
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/missing-cli', mode: 'vscode' }]); await settled();
  assert.equal(discoveryCount(), 0); assert.equal(owner.modeFor('/repo'), 'vscode');
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(discoveryCount(), 1);
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'vscode' }]); await settled();
  assert.equal(discoveryCount(), 1);
  await openNative('/other'); await settled(); assert.equal(discoveryCount(), 1);
  assert.equal(owner.modeFor('/other'), undefined); await owner.releaseScm(); owner.dispose();
});
test('old CLI associates only the native owner and retains native mixed checkout', async () => {
  const { owner, settled, calls, discoveryCount, openNative } = setup({ oldCli: true, folders: ['/repo/marked', '/repo/plain'], nativeRoots: ['/repo', '/repo/nested'] });
  await settled(); owner.setScmProjects([{ root: '/repo/marked', projectExecutable: '/old-project', mode: 'eska' }]); await settled();
  assert.equal(owner.modeFor('/repo'), 'both'); assert.equal(owner.modeFor('/repo/nested'), undefined);
  assert.equal(owner.repositories.length, 2); assert.equal(discoveryCount(), 1);
  await openNative('/other'); await settled(); assert.equal(discoveryCount(), 1);
  assert.ok(!calls.some(call => call[0] === 'git.close')); await owner.releaseScm(); owner.dispose();
});
test('native opt-outs do not disable independent ESKA SCM', async () => {
  for (const options of [{ gitEnabled: false }, { ignored: ['/repo'] }]) {
    for (const mode of ['eska', 'both']) {
      const { owner, settled, EskaRepository, calls } = setup({ ...options, nativeRoots: [] }); await settled();
      owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode }]); await settled();
      assert.ok(owner.repositories[0] instanceof EskaRepository); assert.equal(calls.length, 0);
      await owner.releaseScm(); owner.dispose(); assert.equal(calls.length, 0);
    }
  }
});
test('reload retains its closed checkout until known manifests choose ownership', async () => {
  const { owner, settled, calls, EskaRepository } = setup({ nativeRoots: [], recovery: [{ root: '/repo', draft: 'saved draft' }] });
  await settled(); assert.equal(calls.length, 0);
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.ok(owner.repositories[0] instanceof EskaRepository); assert.equal(owner.repositories[0].inputBox.value, 'saved draft');
  assert.equal(calls.length, 0); await owner.releaseScm(); owner.dispose(); assert.deepEqual(calls, [['open', '/repo']]);
});

test('ordinary nested checkout does not make the parent checkout shared', async () => {
  const { owner, settled, calls, EskaRepository, Uri } = setup({ folders: ['/repo', '/repo/nested'], nativeRoots: ['/repo', '/repo/nested'] });
  await settled(); owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(owner.modeFor('/repo'), 'eska'); assert.equal(owner.modeFor('/repo/nested'), undefined);
  assert.ok(owner.api.getRepository(Uri.file('/repo/file')) instanceof EskaRepository);
  assert.equal(owner.api.getRepository(Uri.file('/repo/nested/file')).rootUri.fsPath, '/repo/nested');
  assert.deepEqual(calls, [['git.close', '/repo']]); await owner.releaseScm(); owner.dispose();
});
test('explicit retry refreshes an unchanged CLI path and retries terminal monitors', async () => {
  const { owner, settled, setOldCli, setFailure, failMonitor, discoveryCount, EskaRepository } = setup({ oldCli: true });
  owner.retryScm(); await settled(); assert.equal(discoveryCount(), 0);
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/same-path', mode: 'eska' }]); await settled();
  assert.equal(discoveryCount(), 1); setOldCli(false); owner.retryScm(); await settled();
  assert.ok(owner.repositories[0] instanceof EskaRepository); assert.equal(discoveryCount(), 2);
  setFailure(true); failMonitor('/repo'); await settled(); assert.ok(!(owner.repositories[0] instanceof EskaRepository));
  setFailure(false); owner.retryScm(); await settled(); assert.ok(owner.repositories[0] instanceof EskaRepository);
  await owner.releaseScm(); owner.dispose();
});
test('removed projects prune discovery and duplicate native events keep their original handle', async () => {
  const { owner, settled, duplicateNative, discoveryCount } = setup({ oldCli: true }); await settled();
  const projects = [{ root: '/repo', projectExecutable: '/project', mode: 'both' }];
  owner.setScmProjects(projects); await settled(); const original = owner.repositories[0];
  duplicateNative('/repo'); await settled(); assert.equal(owner.repositories[0], original); assert.equal(discoveryCount(), 1);
  owner.setScmProjects([]); await settled(); owner.setScmProjects(projects); await settled(); assert.equal(discoveryCount(), 2);
  await owner.releaseScm(); owner.dispose();
});
test('new native repository retries a negative probe after git init', async () => {
  const { owner, settled, discoveryCount, openNative, setOldCli, EskaRepository } = setup({ oldCli: true, nativeRoots: [] });
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(discoveryCount(), 1); assert.equal(owner.repositories.length, 0);
  setOldCli(false); await openNative('/repo'); await settled();
  assert.equal(discoveryCount(), 2); assert.ok(owner.repositories[0] instanceof EskaRepository);
  await owner.releaseScm(); owner.dispose();
});

test('VS Code 1.109 reopens only ESKA-closed root using the targeted path command', async () => {
  const { owner, settled, calls, repositories } = setup({ apiKeepsClosed: true, nativeRoots: ['/repo', '/ordinary'] });
  await settled(); owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  owner.repositories.find(repo => repo.rootUri.fsPath === '/repo').inputBox.value = 'preserved draft';
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'vscode' }]); await settled();
  assert.deepEqual(calls, [['git.close', '/repo'], ['open', '/repo'], ['git.openRepository', '/repo']]);
  assert.equal(repositories.find(repo => repo.rootUri.fsPath === '/repo').inputBox.value, 'preserved draft');
  await owner.releaseScm(); owner.dispose();
});
test('state updates name their repository while membership changes emit undefined', async () => {
  const { owner, settled, openNative, providerOptions } = setup(); await settled();
  const events = []; owner.onDidChange(repository => events.push(repository));
  owner.repositories[0].emitState(); assert.equal(events.pop(), owner.repositories[0]);
  await openNative('/other'); await settled(); assert.ok(events.includes(undefined));
  assert.equal(providerOptions().isCaseSensitive, process.platform !== 'win32');
  await owner.releaseScm(); owner.dispose();
});


test('branch picker is bound to its live ESKA root and rejects stale ownership and dirty editors', async () => {
  const { owner, commands, calls, picks, setPick, settled, vscode, Uri, EskaRepository } = setup();
  await settled(); owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  const repository = owner.repositories[0]; assert.ok(repository instanceof EskaRepository); assert.equal(repository.branchStatusEnabled, true);
  const checkout = commands.get('eska.explorer.scm.checkout'); setPick('feature');
  await checkout('/other'); assert.equal(picks.length, 0);
  await checkout('/repo'); assert.deepEqual(calls.at(-1), ['checkout', '/repo', 'feature']);
  assert.match(picks[0].options.title, /\/repo/);
  const writes = () => calls.filter(call => call[0] === 'checkout').length;
  vscode.workspace.textDocuments = [{ isDirty: true, uri: Uri.file('/repo/file') }];
  await checkout('/repo'); assert.equal(writes(), 1);
  vscode.workspace.textDocuments = [];
  setPick(async items => { owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'both' }]); await settled(); return items[1]; });
  await checkout('/repo'); assert.equal(writes(), 1); assert.equal(repository.branchStatusEnabled, false);
  await checkout('/repo'); assert.equal(writes(), 1);
  await owner.releaseScm(); owner.dispose();
});


test('restored SCM readers wait for project authority and work in native-only mode without status', async () => {
  const { owner, reader, calls, settled, EskaRepository } = setup({ nativeRoots: [] });
  await settled(); let completed = false;
  const pending = reader('/repo').then(value => { completed = true; return value; });
  await settled(); assert.equal(completed, false);
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'vscode' }]);
  const restored = await pending; assert.ok(restored instanceof EskaRepository);
  assert.equal(restored.rootUri.fsPath, '/repo'); assert.equal(restored.mutationsAvailable, false); assert.equal(restored.cacheBlobs, false);
  assert.equal(await reader('/repo'), restored); assert.equal(await reader('/outside'), undefined);
  assert.equal(calls.filter(call => call[0] === 'status').length, 0);
  owner.setScmProjects([]); await settled(); assert.equal(await reader('/repo'), undefined);
  await owner.releaseScm(); owner.dispose();
});

test('untrusted workspace cannot authorize restored blob readers', async () => {
  const { owner, reader, settled, discoveryCount } = setup({ trusted: false });
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'vscode' }]); await settled();
  assert.equal(await reader('/repo'), undefined); assert.equal(discoveryCount(), 0);
  await owner.releaseScm(); owner.dispose();
});

test('restored readers reuse the ready monitored owner and fall back across mode changes without rediscovery', async () => {
  const { owner, reader, settled, discoveryCount } = setup({ nativeRoots: [] });
  await settled(); owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  const monitored = owner.repositories[0], count = discoveryCount();
  assert.equal(await reader('/repo'), monitored); assert.equal(await reader('/repo'), monitored);
  assert.equal(discoveryCount(), count);
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'vscode' }]); await settled();
  const fallback = await reader('/repo'); assert.notEqual(fallback, monitored); assert.equal(fallback.cacheBlobs, false);
  assert.equal(discoveryCount(), count);
  owner.setScmProjects([{ root: '/repo', projectExecutable: '/project', mode: 'eska' }]); await settled();
  assert.equal(await reader('/repo'), owner.repositories[0]); assert.notEqual(await reader('/repo'), fallback);
  assert.equal(await reader('/outside'), undefined); assert.equal(discoveryCount(), count);
  await owner.releaseScm(); owner.dispose();
});
