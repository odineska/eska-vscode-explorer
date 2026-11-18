import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const compiled = new URL("../out/scm-file-actions.js", import.meta.url);
const require = createRequire(compiled);
const root = resolve("fake SCM root");
const uri = fsPath => ({ scheme: "file", fsPath });
function entry(group, status, path, original = path) {
  return { group, label: path, change: { uri: uri(join(root, path)), originalUri: uri(join(root, original)), status } };
}

function fixture(entries) {
  const calls = [];
  const documents = [];
  let version = 1n;
  const missingPaths = new Set();
  const pathVersions = new Map();
  let warning = async (key, options, ...choices) => choices[0];
  const repository = {
    rootUri: uri(root),
    state: { HEAD: { commit: "abc" }, indexChanges: [] },
    status: async () => {},
    add: async paths => calls.push(["add", ...paths]),
    revert: async paths => calls.push(["revert", ...paths]),
    clean: async paths => calls.push(["clean", ...paths]),
  };
  const vscode = {
    window: { showWarningMessage: (...args) => warning(...args) },
    workspace: {
      textDocuments: documents,
      fs: { delete: async ({ fsPath }, options) => calls.push(["delete", fsPath, options.useTrash]) },
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    },
    commands: { executeCommand: async (...args) => calls.push(args) },
  };
  const overrides = {
    vscode,
    "node:fs/promises": {
      realpath: async path => path,
      lstat: async path => {
        if (missingPaths.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return { dev: 1n, ino: 2n, size: 10n, mtimeNs: pathVersions.get(path) ?? version, ctimeNs: 0n, isFile: () => true };
      },
      readFile: async () => "resolved text",
    },
    "./reveal.js": { relativeFile: (_base, path) => path.slice(root.length + 1) },
    "./source.js": {
      sourceKey: path => path,
      hasDirtySource: async (paths, docs) => docs.some(doc => paths.includes(doc.uri.fsPath) && doc.isDirty),
    },
  };
  const module = { exports: {} };
  runInNewContext("(function(require,module,exports){" + readFileSync(compiled, "utf8") + "\n})")(
    name => overrides[name] ?? require(name), module, module.exports);
  const context = { api: { toGitUri: (value, ref) => ({ ...value, scheme: "git", ref }) },
    repository, entries, text: key => key, validate() {} };
  return { calls, documents, context, missingPaths, pathVersions, execute: action => module.exports.executeFileAction(action, context),
    setWarning: callback => { warning = callback; }, changeFile: () => { version++; } };
}

test("the staged and working rows independently select HEAD, index, and working contents", async () => {
  const staged = entry("index", 3, "new.bsl", "old.bsl");
  const working = entry("working", 5, "new.bsl");
  const setup = fixture([staged, working]);
  await setup.execute("diff");
  assert.deepEqual(setup.calls, [
    ["vscode.diff", { ...staged.change.originalUri, scheme: "git", ref: "HEAD" },
      { ...staged.change.uri, scheme: "git", ref: "" }, staged.label],
    ["vscode.diff", { ...working.change.uri, scheme: "git", ref: "~" }, working.change.uri, working.label],
  ]);
  setup.calls.length = 0;
  await setup.execute("unstage");
  assert.deepEqual(setup.calls, [["revert", staged.change.originalUri.fsPath, staged.change.uri.fsPath]]);
});

test("HEAD ignores staged content and resolves deleted and renamed paths", async () => {
  const modified = entry("working", 5, "modified.bsl");
  const removed = entry("working", 6, "removed.bsl");
  const renamed = entry("working", 5, "new.bsl");
  const stagedRemoved = entry("index", 2, "gone.bsl");
  const setup = fixture([modified, removed, renamed, stagedRemoved]);
  const stagedRename = entry("index", 3, "new.bsl", "old.bsl");
  setup.context.repository.state.indexChanges = [entry("index", 0, "modified.bsl").change, stagedRename.change];
  await setup.execute("head");
  assert.deepEqual(setup.calls.map(([command, target]) => [command, target.ref, target.fsPath]), [
    ["vscode.open", "HEAD", join(root, "modified.bsl")],
    ["vscode.open", "HEAD", join(root, "removed.bsl")],
    ["vscode.open", "HEAD", join(root, "old.bsl")],
    ["vscode.open", "HEAD", join(root, "gone.bsl")],
  ]);
});

test("HEAD warns for both rows of a newly staged file", async () => {
  const staged = entry("index", 1, "new.bsl"), working = entry("working", 5, "new.bsl");
  const setup = fixture([staged, working]);
  setup.context.repository.state.indexChanges = [staged.change];
  const warnings = [];
  setup.setWarning(async key => { warnings.push(key); });
  await setup.execute("head");
  assert.deepEqual(setup.calls, []);
  assert.deepEqual(warnings, ["scmHeadUnavailable", "scmHeadUnavailable"]);
});

test("discard revalidates after confirmation and rejects an externally changed file", async () => {
  const setup = fixture([entry("working", 5, "a.xml")]);
  let validations = 0;
  setup.context.validate = () => { validations++; };
  setup.setWarning(async (_key, _options, confirm) => { setup.changeFile(); return confirm; });
  await assert.rejects(setup.execute("discard"), { message: "scmChanged" });
  assert.equal(validations, 3);
  assert.deepEqual(setup.calls, []);
});

test("discard rejects a dirty original rename path before prompting", async () => {
  const renamed = entry("working", 10, "new.xml", "old.xml");
  const setup = fixture([renamed]);
  setup.documents.push({ uri: renamed.change.originalUri, isDirty: true });
  setup.setWarning(async () => assert.fail("unexpected prompt"));
  await assert.rejects(setup.execute("discard"), { message: "scmDirty" });
  assert.deepEqual(setup.calls, []);
});

test("staging a deletion conflict requires explicit consent and rechecks the snapshot", async () => {
  const row = entry("merge", 15, "conflict.xml");
  const setup = fixture([row]);
  setup.setWarning(async () => undefined);
  await setup.execute("stage");
  assert.deepEqual(setup.calls, []);

  setup.setWarning(async (_key, _options, _keep, remove) => { setup.changeFile(); return remove; });
  await assert.rejects(setup.execute("stage"), { message: "scmChanged" });
  assert.deepEqual(setup.calls, []);

  setup.setWarning(async (key, _options, keep, remove) => {
    assert.equal(key, "scmDeletionConflict");
    assert.equal(keep, "scmKeepOurs");
    return remove;
  });
  await setup.execute("stage");
  assert.deepEqual(setup.calls, [["delete", row.change.uri.fsPath, true], ["add", row.change.uri.fsPath]]);
});

test("a failed stage after moving a conflict file to the trash reports partial completion", async () => {
  const row = entry("merge", 15, "conflict.xml");
  const later = entry("merge", 14, "later.xml");
  const setup = fixture([row, later]);
  setup.setWarning(async (_key, _options, _keep, remove) => remove);
  const failure = new Error("index locked");
  setup.context.repository.add = async paths => {
    setup.calls.push(["add", ...paths]);
    throw failure;
  };
  await assert.rejects(setup.execute("stage"), error => error.message === "scmPartialStage" && error.cause === failure);
  assert.deepEqual(setup.calls, [["delete", row.change.uri.fsPath, true], ["add", row.change.uri.fsPath]]);
});

test("when a linked worktree has no matching file in the main checkout, compare opens only its working file", async () => {
  const row = entry("working", 5, "worktree.xml");
  const setup = fixture([row]);
  const main = join(root, "..", "main checkout");
  setup.context.repository.kind = "worktree";
  setup.context.repository.state.worktrees = [{ main: true, path: main }];
  setup.missingPaths.add(join(main, "worktree.xml"));
  await setup.execute("compareWorkspace");
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0][0], "vscode.open");
  assert.equal(setup.calls[0][1], row.change.uri);
});

test("a second conflict file changed while staging the first is kept", async () => {
  const first = entry("merge", 15, "first.xml");
  const second = entry("merge", 14, "second.xml");
  const setup = fixture([first, second]);
  setup.setWarning(async (_key, _options, _keep, remove) => remove);
  setup.context.repository.add = async paths => {
    setup.calls.push(["add", ...paths]);
    setup.pathVersions.set(second.change.uri.fsPath, 2n);
  };
  await assert.rejects(setup.execute("stage"), error => error.message === "scmPartialStage" && error.cause?.message === "scmChanged");
  assert.deepEqual(setup.calls, [["delete", first.change.uri.fsPath, true], ["add", first.change.uri.fsPath]]);
});

test("a missing file selected to Keep blocks conflict staging before any writes", async () => {
  const first = entry("merge", 15, "first.xml");
  const missing = entry("merge", 14, "missing.xml");
  const setup = fixture([first, missing]);
  setup.missingPaths.add(missing.change.uri.fsPath);
  setup.setWarning(async (_key, options, keep, remove) => options.detail === missing.change.uri.fsPath ? keep : remove);
  await assert.rejects(setup.execute("stage"), { message: "scmChanged" });
  assert.deepEqual(setup.calls, []);
});
