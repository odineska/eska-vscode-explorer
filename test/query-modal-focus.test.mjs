import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

/** Load unchanged compiled adapters with a scoped native boundary; no global module mocks can escape. */
function nativeAdapters(vscode) {
  const modules = new Map();
  const load = filename => {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }, require = createRequire(filename);
    modules.set(filename, module);
    runInNewContext(`(function(require,module,exports,__filename,__dirname){${readFileSync(filename, "utf8")}\n})`, {
      process, Buffer, URL, setTimeout, clearTimeout,
    })(name => name === "vscode" ? vscode : name.startsWith(".") ? load(require.resolve(name)) : require(name),
      module, module.exports, filename, dirname(filename));
    return module.exports;
  };
  return name => load(fileURLToPath(new URL(`../out/query/${name}.js`, import.meta.url)));
}

/** VS Code may emit a second tab event before the first close has finished. */
test("constructor closes only its clean query splits and leaves the dirty parent alone", async () => {
  class TabInputText { constructor(uri) { this.uri = uri; } }
  const query = { toString: () => "eska-query:/session/query.sdbl" };
  const owner = { toString: () => "file:///owner.bsl" };
  const tabs = [
    { input: new TabInputText(owner), isDirty: true },
    { input: new TabInputText(query), isDirty: false },
    { input: new TabInputText(query), isDirty: true },
  ];
  const closed = [];
  let reveals = 0;
  const { QueryTabs } = nativeAdapters({ TabInputText, window: { tabGroups: {
    all: [{ tabs }], async close(items) { closed.push(...items); return false; },
  } } })("tabs");
  const session = { record: {}, design: { parentLocked: true, reveal() { reveals++; } } };
  const adapter = Object.assign(Object.create(QueryTabs.prototype), { uri: () => query, sessions: new Map([["id", session]]) });
  adapter.guardConstructorTabs();
  adapter.guardConstructorTabs();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reveals, 1);
  assert.deepEqual(closed, [tabs[1]]);
  assert.equal(session.guarding, undefined);
});

test("native dirty owner remains open when editing its query", async () => {
  const uri = { scheme: "file", toString: () => "file:///owner.bsl" };
  const calls = [];
  const { QueryModalParent } = nativeAdapters({ workspace: { textDocuments: [{ uri, isDirty: true }] },
    window: { tabGroups: { async close(tabs) { calls.push(tabs); return true; } } } })("modal-parent");
  const parent = new QueryModalParent(uri);
  parent.tabs = () => [{ isDirty: false }];
  assert.equal(await parent.hide(), true);
  assert.equal(calls.length, 0);
});

test("immediate reopen waits for the previous query to finish returning to its owner", async () => {
  const { QueryTabs } = nativeAdapters({ FileChangeType: { Deleted: 3 }, window: { tabGroups: { all: [] } } })("tabs");
  const session = { record: { id: "query" } }, sessions = new Map([["query", session]]);
  let returning, restored;
  const started = new Promise(resolve => { returning = resolve; });
  const finish = new Promise(resolve => { restored = resolve; });
  const adapter = Object.assign(Object.create(QueryTabs.prototype), { sessions, removals: new Set(),
    session: () => session, uri: () => "query", isOwnerSnapshot: () => false, closeSource: async () => {},
    languageEvents: { fire() {} }, events: { fire() {} }, returnParent: async () => { returning(); await finish; } });
  const closing = adapter.closeView("query");
  await started;
  let complete = false;
  const reopen = adapter.existingSession(() => true).then(record => { complete = true; return record; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(complete, false);
  restored();
  await closing;
  assert.equal(await reopen, undefined);
});

test("native Save can stat the query and its parents without treating the pending draft as saved", async () => {
  class Uri {
    constructor({ scheme, path }) { this.scheme = scheme; this.path = path; }
    static from(parts) { return new Uri(parts); }
    with(change) { return new Uri({ ...this, ...change }); }
    toString() { return `${this.scheme}:${this.path}`; }
  }
  const FileType = { File: 1, Directory: 2 };
  const { QueryTabs } = nativeAdapters({ Uri, FileType, FilePermission: { Readonly: 1 },
    FileSystemError: { FileNotFound: uri => Error(`Missing ${uri.path}`) } })("tabs");
  const record = { id: "document", identity: { kind: "bslLiteral" }, base: "SELECT 1", draft: "SELECT 123", writable: true };
  const session = { record, mtime: 10 };
  const adapter = Object.assign(Object.create(QueryTabs.prototype), { sessions: new Map([[record.id, session]]) });
  const file = adapter.uri(record), root = file.with({ path: "/" }), directory = file.with({ path: "/document" });
  assert.equal((await adapter.stat(root)).type, FileType.Directory);
  assert.equal((await adapter.stat(directory)).type, FileType.Directory);
  assert.equal((await adapter.readDirectory(root))[0][0], "document");
  assert.equal((await adapter.readDirectory(directory))[0][0], "query.sdbl");
  assert.equal((await adapter.stat(file)).size, Buffer.byteLength(record.base));
  assert.equal((await adapter.readFile(file)).toString(), record.base);
  await assert.rejects(adapter.stat(file.with({ path: "/missing/query.sdbl" })), /Missing/);
  await assert.rejects(adapter.readDirectory(file), /Missing/);
  session.design = { before: record.draft };
  assert.equal((await adapter.readFile(file)).toString(), record.draft);
  assert.equal((await adapter.stat(file)).permissions, undefined);
});

test("constructor reveal is idempotent when the panel is already active", async () => {
  let reveal, focused = 0;
  const panel = { active: true, webview: { onDidReceiveMessage() {} }, onDidDispose() {},
    reveal() { focused++; this.active = true; } };
  const binding = { onReveal(action) { reveal = action; } };
  const uri = { toString: () => "eska-query:///draft.sdbl" };
  const vscode = { ViewColumn: { Active: -1 }, Uri: { joinPath: () => ({}) },
    workspace: { async openTextDocument() { return {}; } }, window: { createWebviewPanel: () => panel } };
  const { QueryDesigner } = nativeAdapters(vscode)("designer");
  const designer = Object.assign(Object.create(QueryDesigner.prototype), { views: new Map(),
    context: { extensionUri: {} }, tabs: { async beginConstructor() { return binding; } }, text: () => "Constructor", html: () => "" });
  await designer.open(uri);
  reveal(); assert.equal(focused, 0);
  panel.active = false;
  reveal(); assert.equal(focused, 1);
  reveal(); assert.equal(focused, 1);
});

test("saving BSL and XML updates the virtual file version after the owner receipt", () => {
  for (const kind of ["bslLiteral", "dataSet"]) {
    const { QueryTabs } = nativeAdapters({ FileChangeType: { Changed: 1 } })("tabs");
    const endpoint = {}, changed = [], language = [];
    const source = { record: { identity: { kind }, ownerText: "updated owner" }, header: { resumed: true, applyPending: false } };
    const session = { source, endpoint, mtime: 100, record: { ...source.record, ownerText: "original owner" } };
    const adapter = Object.assign(Object.create(QueryTabs.prototype), { recoveryEndpoint: endpoint,
      uri: () => "draft", ownerUri: () => "owner", events: { fire: value => changed.push(value) },
      languageEvents: { fire: value => language.push(value) } });
    adapter.accept(session, source, true);
    assert.ok(session.mtime > 100);
    assert.ok(session.ownerMtime > 100, "the changed owner snapshot still gets its own version");
    assert.equal(changed[0][0].uri, "owner");
    assert.equal(language.length, 1);
  }
});

/** File saves can invalidate an owner between metadata/source and query/open. */
function openingFixture(drain = () => {}) {
  const load = nativeAdapters({}), { QueryTabs } = load("tabs"), { ExplorerError } = load("../protocol");
  const project = { info: { generation: "0", eventSequence: "0" } }, opened = [], closed = [];
  const tree = { connection: { state: { kind: "ready", queryEditing: {} } }, session: { sessionId: "test" },
    async synchronizeInputs() { await drain(project); } };
  load("client").QueryClient = class {
    async open(owner) { opened.push(owner); return { async close() { closed.push(owner); } }; }
  };
  const adapter = Object.assign(Object.create(QueryTabs.prototype), {
    currentTree: () => tree, recoveryAvailable: true, requiredRecovery() {}, application() {},
  });
  const locate = () => ({ entry: { project, node: { id: project.info.generation } }, source: {},
    document: { version: 1, getText: () => "query" } });
  return { adapter, tree, project, opened, closed, locate, ExplorerError };
}

test("a queued save resolves a fresh owner before allocating exactly one query document", async () => {
  let barriers = 0, located = 0, actions = 0;
  const value = openingFixture(project => { if (++barriers === 2) project.info.generation = "1"; });
  const result = await value.adapter.withDocument(value.tree, value.project,
    async () => { located++; return value.locate(); }, async (_document, owner) => { actions++; return owner.entry.node.id; });
  assert.equal(result, "1"); assert.equal(located, 2); assert.equal(actions, 1);
  assert.equal(value.opened.length, 1); assert.equal(value.opened[0].node, "1"); assert.equal(value.closed.length, 1);
});

test("only stale read-only owner discovery retries after an ordered invalidation", async () => {
  const value = openingFixture(); let located = 0;
  await value.adapter.withDocument(value.tree, value.project, async () => {
    if (++located === 1) { value.project.info.eventSequence = "1"; throw new value.ExplorerError("sourceChanged"); }
    return value.locate();
  }, async () => {});
  assert.equal(located, 2); assert.equal(value.opened.length, 1); assert.equal(value.closed.length, 1);
});

test("unstable owner discovery stops without allocating a query document", async () => {
  const value = openingFixture(); let located = 0;
  await assert.rejects(value.adapter.withDocument(value.tree, value.project, async () => {
    value.project.info.eventSequence = String(++located); throw new value.ExplorerError("sourceChanged");
  }, async () => assert.fail("action must not run")), { code: "sourceChanged" });
  assert.equal(located, 3); assert.equal(value.opened.length, 0);
});

test("a query action failure closes its document and never replays the action", async () => {
  const value = openingFixture(); let actions = 0;
  await assert.rejects(value.adapter.withDocument(value.tree, value.project, async () => value.locate(), async () => {
    actions++; throw new value.ExplorerError("sourceChanged");
  }), { code: "sourceChanged" });
  assert.equal(actions, 1); assert.equal(value.opened.length, 1); assert.equal(value.closed.length, 1);
});

function ownedTabFixture({ refuseClose = false, redirectFocus = false } = {}) {
  const uri = { toString: () => "eska-query:/draft.sdbl" };
  const other = { toString: () => "file:///other.bsl" };
  class TabInputText {
    constructor(uri) { this.uri = uri; }
  }
  const groups = [uri, uri, other].map((path, index) => {
    const group = { viewColumn: index + 1, tabs: [] };
    group.activeTab = { group, input: new TabInputText(path), isPreview: index === 0 };
    group.tabs.push(group.activeTab);
    return group;
  });
  const foreign = groups[2].activeTab;
  const tabGroups = { all: groups, activeTabGroup: groups[1] };
  const shown = [], closed = [];
  const vscode = { TabInputText, window: { tabGroups, async showTextDocument(path, options) {
    shown.push(options);
    const next = groups.find(group => group.viewColumn === options.viewColumn);
    assert.equal(next.activeTab.input.uri, path);
    tabGroups.activeTabGroup = redirectFocus ? foreign.group : next;
  } }, commands: { async executeCommand(command) {
    assert.equal(command, "workbench.action.revertAndCloseActiveEditor");
    closed.push(tabGroups.activeTabGroup.activeTab);
    if (refuseClose) return;
    groups.splice(groups.indexOf(tabGroups.activeTabGroup), 1);
    for (const [index, group] of groups.entries()) group.viewColumn = index + 1;
  } } };
  return { uri, foreign, groups, shown, closed, hideOwnedQuery: nativeAdapters(vscode)("modal-parent").hideOwnedQuery };
}

test("closing owned query splits follows live columns and preserves unrelated tabs", async () => {
  const value = ownedTabFixture();
  await value.hideOwnedQuery(value.uri);
  assert.deepEqual(value.shown.map(options => [options.viewColumn, options.preview]), [[1, true], [1, false]]);
  assert.equal(value.closed.length, 2);
  assert.equal(value.groups.length, 1);
  assert.equal(value.groups[0].activeTab, value.foreign);
});

test("closing an owned query stops if the editor refuses to close or focus is redirected", async () => {
  for (const options of [{ refuseClose: true }, { redirectFocus: true }]) {
    const value = ownedTabFixture(options);
    await assert.rejects(value.hideOwnedQuery(value.uri), { code: "sourceChanged" });
    assert.equal(value.shown.length, 1);
    assert.equal(value.closed.length, options.refuseClose ? 1 : 0);
    assert.equal(value.groups.length, 3);
    assert.equal(value.groups[2].activeTab, value.foreign);
  }
});

/** Simulate an external writer and native model reload independently of the source's editor permissions. */
function cleanOwnerFixture({ disk = 'before', beforeWrite, onWrite } = {}) {
  const uri = { toString: () => 'file:///owner.bsl' };
  const owner = { uri, version: 7, encoding: 'utf8', text: 'before', isDirty: false, getText() { return this.text; } };
  const writes = [], subscriptions = new Set();
  const subscribe = listener => { subscriptions.add(listener); return { dispose: () => subscriptions.delete(listener) }; };
  const workspace = {
    encode: async text => Buffer.from(text),
    onDidChangeTextDocument: subscribe, onDidCloseTextDocument: subscribe,
    fs: {
      async readFile() { beforeWrite?.(owner); return Buffer.from(disk); },
      async writeFile(target, bytes) {
        assert.equal(target, uri);
        writes.push(bytes.toString());
        owner.text = bytes.toString();
        owner.version++;
        onWrite?.(owner);
        for (const listener of subscriptions) listener({ document: owner, contentChanges: [{}] });
      },
    },
  };
  const { writeCleanQueryOwner } = nativeAdapters({ workspace, window: { tabGroups: { all: [] } } })('owner');
  let attempted = false;
  return { write: () => writeCleanQueryOwner(owner, '7', 'after', () => { attempted = true; }),
    writes, subscriptions, get attempted() { return attempted; } };
}

test('a clean query owner is acknowledged only after its native buffer contains the saved bytes', async () => {
  const f = cleanOwnerFixture();
  await f.write();
  assert.deepEqual(f.writes, ['after']);
  assert.equal(f.attempted, true);
  assert.equal(f.subscriptions.size, 0);
});

test('an external disk edit or a newly dirty owner prevents the checked file write', async () => {
  for (const options of [{ disk: 'changed' }, { beforeWrite: owner => { owner.isDirty = true; } },
    { beforeWrite: owner => { owner.version++; } }]) {
    const f = cleanOwnerFixture(options);
    await assert.rejects(f.write(), { code: 'sourceChanged' });
    assert.equal(f.attempted, false);
    assert.deepEqual(f.writes, []);
  }
});

test('an owner edit during reload is preserved and the attempted write stays pending', async () => {
  const f = cleanOwnerFixture({ onWrite: owner => { owner.text += ' user edit'; owner.isDirty = true; } });
  await assert.rejects(f.write(), { code: 'sourceChanged' });
  assert.equal(f.attempted, true);
  assert.equal(f.subscriptions.size, 0);
});
