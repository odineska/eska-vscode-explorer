import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

function loadAdapters(vscode) {
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }, require = createRequire(filename);
    modules.set(filename, module);
    runInNewContext(`(function(require,module,exports){${readFileSync(filename, "utf8")}\n})`, {
      process, Buffer, URL, setTimeout, clearTimeout,
    })(name => name === "vscode" ? vscode : name.startsWith(".") ? load(require.resolve(name)) : require(name),
      module, module.exports);
    return module.exports;
  }
  return name => load(fileURLToPath(new URL(`../out/${name}.js`, import.meta.url)));
}

const uri = { scheme: "file", fsPath: "/project/src/Owner.bsl", toString: () => "file:///project/src/Owner.bsl" };
const exact = uri.fsPath;
const glob = "**/*.bsl";

function fixture(values = {}) {
  const noop = () => ({ dispose() {} });
  let listener;
  const config = {
    inspect: key => key === "readonlyInclude" ? values : undefined,
    get(key, fallback) {
      if (key === "readonlyInclude") return { ...values.defaultValue, ...values.globalValue, ...values.workspaceValue, ...values.workspaceFolderValue };
      return key === "readonlyExclude" ? values.excludes ?? fallback : fallback;
    },
    async update(key, value, target) {
      assert.equal(key, "readonlyInclude");
      assert.equal(target, "workspace");
      values.workspaceValue = value;
      changed();
    },
  };
  const changed = () => listener?.({ affectsConfiguration: key => key === "files.readonlyInclude" });
  const vscode = {
    ConfigurationTarget: { Workspace: "workspace" },
    EventEmitter: class { event = noop; dispose() {} },
    window: { registerFileDecorationProvider: noop, onDidChangeVisibleTextEditors: noop },
    workspace: {
      onDidOpenTextDocument: noop, workspaceFolders: [{ uri: { fsPath: "/project" } }],
      workspaceFile: { fsPath: "/project/demo.code-workspace" },
      getWorkspaceFolder() { return this.workspaceFolders[0]; },
      getConfiguration: () => config,
      onDidChangeConfiguration(fn) { listener = fn; return noop(); },
    },
    languages: {
      match({ pattern }, document) {
        return +(typeof pattern === "string" && (pattern === document.uri.fsPath || (pattern === glob && document.uri.fsPath.endsWith(".bsl"))));
      },
    },
    RelativePattern: class {},
  };
  const load = loadAdapters(vscode);
  return { load, values, changed, vscode };
}

test("single-folder inspection aliases its workspace rule while a saved workspace keeps separate folder overrides", () => {
  const { load, values, vscode } = fixture({ workspaceValue: { [exact]: true }, workspaceFolderValue: { [exact]: true } });
  const { configuredReadOnlyResource } = load("editor-policy");
  vscode.workspace.workspaceFile = undefined;
  assert.equal(configuredReadOnlyResource(uri, "bsl", exact), false);
  values.globalValue = { [exact]: true };
  assert.equal(configuredReadOnlyResource(uri, "bsl", exact), true);
  values.globalValue = undefined;
  vscode.workspace.workspaceFile = { fsPath: "/project/demo.code-workspace" };
  assert.equal(configuredReadOnlyResource(uri, "bsl", exact), true);
});

test("excluding an owned exact workspace key still evaluates independent user rules", () => {
  const { load, values } = fixture({ workspaceValue: { [exact]: true } });
  const { configuredReadOnlyResource } = load("editor-policy");
  const restricted = rule => configuredReadOnlyResource(uri, "bsl", rule);
  assert.equal(restricted(), true);
  assert.equal(restricted(exact), false);
  assert.equal(restricted(glob), true);
  values.globalValue = { [exact]: true };
  assert.equal(restricted(exact), true);
  values.workspaceFolderValue = { [exact]: false };
  assert.equal(restricted(exact), false);
  values.globalValue = undefined;
  values.workspaceFolderValue = { [exact]: true };
  assert.equal(restricted(exact), true);
  values.workspaceFolderValue = undefined;
  values.workspaceValue[glob] = true;
  assert.equal(restricted(exact), true);
  values.excludes = { [glob]: true };
  assert.equal(restricted(exact), false);
});

test("Support offers only a rule it inserted and still owns for the exact current source", async () => {
  const { load, values, changed } = fixture({ workspaceValue: { [exact]: true } });
  const { SupportController } = load("support");
  const state = new Map();
  const support = new SupportController({ workspaceState: {
    get: (key, fallback) => state.get(key) ?? fallback,
    async update(key, value) { state.set(key, value); },
  } }, () => {}, () => {});
  const info = { sourcePath: { value: "/project/src", encoding: "utf-8" } };
  const connection = { sources: {} };
  support.tree = { projects: [{ info }], connection };
  support.available = support.targeted = true;

  await support.writeRules([exact]);
  assert.equal(support.ownedWorkspaceReadonlyRule(uri), undefined, "a preexisting matching workspace setting belongs to the user");
  values.workspaceValue = {};
  await support.writeRules([exact]);
  assert.equal(support.ownedWorkspaceReadonlyRule(uri), exact);
  assert.equal(support.ownedWorkspaceReadonlyRule({ ...uri, fsPath: "/project/src/Other.bsl" }), undefined);
  support.fileIndex.set(uri.toString(), { file: { readOnly: true } });
  assert.equal(support.ownedWorkspaceReadonlyRule(uri), undefined, "independent support protection still applies");
  support.fileIndex.clear();
  info.requiresReopen = true;
  assert.equal(support.ownedWorkspaceReadonlyRule(uri), undefined, "a disconnected source cannot supply a temporary exception");
  info.requiresReopen = false;

  let finishCheck;
  support.resolveUri = () => new Promise(resolve => { finishCheck = resolve; });
  const denied = support.settleWorkspaceReadonlyRule(uri);
  connection.sources = {};
  finishCheck(uri);
  assert.equal(await denied, undefined, "a support response from the previous process cannot authorize capture");
  const settled = support.settleWorkspaceReadonlyRule(uri);
  finishCheck(uri);
  assert.equal(await settled, exact);

  values.workspaceValue = { [exact]: false };
  changed();
  values.workspaceValue = { [exact]: true };
  changed();
  assert.equal(support.ownedWorkspaceReadonlyRule(uri), undefined, "a user replacement revokes ownership");
  await support.writeRules([]);
  assert.equal(values.workspaceValue[exact], true, "cleanup preserves the exact rule reinstated by the user");
});
