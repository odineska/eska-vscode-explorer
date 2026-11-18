import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Connection } from "../out/connection.js";
import { MetadataTree } from "../out/tree.js";
import { QueryClient, querySnapshot } from "../out/query/client.js";
import { QueryRecovery } from "../out/query/recovery.js";
import { QuerySessions } from "../out/query/sessions.js";
import { querySessionCapabilities, querySessionHeader } from "../out/query/session-protocol.js";
import { createTreeProject } from "./fixture.mjs";
import { createQuerySource } from "./query-fixture.mjs";

const executable = process.env.ESKA_TEST_BINARY;

/** Independent native-model facts never include VS Code services or a guessed disk revision. */
function facts(version, text, isDirty = true, userReadOnly = false) {
  return { version: String(version), snapshot: querySnapshot(text), isDirty, userReadOnly, application: null };
}

/** Apply byte edits through an independent native-model simulation, then check the complete output hash. */
function apply(input, plan) {
  let bytes = Buffer.from(input);
  for (const edit of [...plan.replacements].reverse()) bytes = Buffer.concat([
    bytes.subarray(0, edit.range.start), Buffer.from(edit.text), bytes.subarray(edit.range.end),
  ]);
  const text = bytes.toString("utf8");
  assert.equal(querySnapshot(text), plan.outputSnapshot);
  return text;
}

/** Opaque identities come from actual tree replies instead of a copied metadata-ID encoder. */
async function form(tree, project) {
  const common = (await tree.children(await tree.root(project))).find(entry => entry.node.id.collection?.kind === "common");
  const group = (await tree.children(common)).find(entry => entry.node.id.collection?.metadataKind === "common-form");
  return (await tree.children(group))[0];
}

/** Each SDK scenario owns its source and private store in a unique sibling-playground directory. */
async function fixture(t, locale = "en-US", wrap = endpoint => endpoint) {
  const outer = await mkdtemp(join(process.env.ESKA_TEST_ROOT ?? resolve("../eska-playground"), "explorer-source-session-"));
  const value = { outer, connection: new Connection("source-session-test", () => {}, () => {}) };
  t.after(async () => {
    await value.store?.settled().catch(() => {});
    value.tree?.dispose();
    await value.connection.dispose();
    await rm(outer, { recursive: true, force: true });
  });
  Object.assign(value, await createTreeProject(join(outer, "project")));
  Object.assign(value, await createQuerySource(value));
  value.target = { executable, path: value.root, name: "sessions", locale };
  await value.connection.connect(value.target);
  await bind(value, wrap);
  const disk = await readFile(value.formPath, "utf8");
  value.input = disk.replace("<Attributes>", "<!--dirty 😀--><Attributes>");
  const client = new QueryClient(value.connection, value.state.session.sessionId, value.project, value.state.queryEditing);
  const document = await client.open({ node: value.entry.node.id, source: { value: "CommonForms/Lists/Ext/Form.xml", encoding: "utf-8" },
    version: "7", text: value.input });
  const query = (await document.list())[0];
  value.id = randomUUID();
  value.session = await value.client.open(document, value.id, query.identity, false);
  await document.close();
  return value;
}

/** Rebinding a client after a real process restart still requires a new process-bound transport and explicit resume. */
async function bind(value, wrap = endpoint => endpoint) {
  value.state = value.connection.state;
  assert.equal(value.state.kind, "ready", JSON.stringify(value.state));
  assert.ok(value.state.queryEditing);
  value.tree = new MetadataTree(value.connection, value.state.session, () => {}, () => {});
  value.project = value.tree.projects[0];
  value.entry = await form(value.tree, value.project);
  value.endpoint = wrap(value.connection.recovery);
  assert.ok(value.endpoint.sessions, "durable source-session capability was negotiated");
  value.store = new QueryRecovery(value.endpoint, join(value.outer, "private"), () => assert.fail("valid record"));
  await value.store.records();
  value.client = new QuerySessions(value.endpoint, value.store, () => ({ sessionId: value.state.session.sessionId,
    projectId: value.project.info.projectId, generation: value.project.info.generation }), value.state.queryEditing);
}

/** Durability is mandatory for source application, even when a previous prototype advertises basic sessions. */
test("source-session capability requires durable preparation and bounds untrusted resource limits", () => {
  const hello = { apiVersion: { major: 1, minor: 16 }, capabilities: { querySessions: {
    schemaVersion: 1, writesOwner: false, checkpointStorageVersion: 1, preparedStorageVersion: 2, preparedStateDurable: true,
    nativeApplicationReceipt: true, explicitResume: true, bslEditing: false, sourceKinds: ["form", "dataCompositionSchema"],
    maxSessions: 16, maxRetainedBytes: 33_554_432,
  } } };
  assert.deepEqual(querySessionCapabilities(hello), { bslEditing: false, saveCleanOwner: false,
    maxSessions: 16, maxRetainedBytes: 33_554_432 });
  assert.equal(querySessionCapabilities({ ...hello, apiVersion: { major: 1, minor: 15 } }), undefined);
  for (const replacement of [{ preparedStateDurable: false }, { writesOwner: true }, { maxSessions: 0 }, { preparedStorageVersion: 1 }]) {
    assert.throws(() => querySessionCapabilities({ ...hello, capabilities: { querySessions: { ...hello.capabilities.querySessions, ...replacement } } }),
      { code: "protocolInvalid" });
  }
  const bsl = { ...hello, apiVersion: { major: 1, minor: 19 }, capabilities: { querySessions: {
    ...hello.capabilities.querySessions, bslEditing: true, sourceKinds: ["form", "dataCompositionSchema", "bsl"],
    ownerProtection: "protectedViewWithConflicts", bslSave: "checkpointOnly",
  } } };
  assert.equal(querySessionCapabilities(bsl).bslEditing, true);
  assert.equal(querySessionCapabilities(bsl).saveCleanOwner, false);
  for (const replacement of [{ ownerProtection: "nativeLock" }, { bslSave: "apply" }, { sourceKinds: ["form", "dataCompositionSchema"] }]) {
    assert.throws(() => querySessionCapabilities({ ...bsl, capabilities: { querySessions: { ...bsl.capabilities.querySessions, ...replacement } } }),
      { code: "protocolInvalid" });
  }
  assert.throws(() => querySessionCapabilities({ ...bsl, apiVersion: { major: 1, minor: 18 } }), { code: "protocolInvalid" });
  const nativeSave = { ...bsl, apiVersion: { major: 1, minor: 55 }, capabilities: { querySessions: {
    ...bsl.capabilities.querySessions, saveCleanOwner: true,
  } } };
  assert.equal(querySessionCapabilities(nativeSave).saveCleanOwner, true);
  assert.throws(() => querySessionCapabilities({ ...nativeSave, apiVersion: { major: 1, minor: 54 } }), { code: "protocolInvalid" });
  for (const saveCleanOwner of [null, false, "true"]) {
    assert.throws(() => querySessionCapabilities({ ...nativeSave, capabilities: { querySessions: {
      ...nativeSave.capabilities.querySessions, saveCleanOwner,
    } } }), { code: "protocolInvalid" });
  }
});

test("clean BSL save requires negotiated opt-in and confirms the same session twice", { skip: !executable }, async t => {
  const flags = [];
  const value = await fixture(t, "en-US", endpoint => ({ ...endpoint, sessions: { ...endpoint.sessions,
    request(method, params) {
      if (method === "query/sessionPrepare") flags.push(params.saveCleanOwner);
      return endpoint.sessions.request(method, params);
    } } }));
  const roots = await value.tree.children(await value.tree.root(value.project));
  const catalogs = roots.find(entry => entry.node.id.collection?.metadataKind === "catalog");
  const object = (await value.tree.children(catalogs)).find(entry => entry.node.label.text === "Товары");
  const modules = (await value.tree.children(object)).find(entry => entry.node.id.collection?.kind === "modules");
  const [module] = await value.tree.children(modules);
  let owner = '// native owner 😀\r\nQuery.Text = "SELECT 1";\r\n';
  await writeFile(value.module, "\ufeff" + owner);
  const client = new QueryClient(value.connection, value.state.session.sessionId, value.project, value.state.queryEditing);
  const document = await client.open({ node: module.node.id,
    source: { value: "Catalogs/Товары/Ext/ObjectModule.bsl", encoding: "utf-8" }, version: "7", text: owner });
  const query = await document.read({ at: { line: 1, character: 19 } });
  const id = randomUUID();
  const session = await value.client.open(document, id, query.identity, false);
  await document.close();
  assert.match(session.header.protection.sourceRestriction, /^[1-9][0-9]*$/);
  for (const sourceRestriction of ["0", 1, "not-a-token"]) {
    assert.throws(() => querySessionHeader({ ...session.header,
      protection: { ...session.header.protection, sourceRestriction } }, value.endpoint.capabilities),
    { code: "protocolInvalid" });
  }
  if (!value.endpoint.sessions.capabilities.saveCleanOwner) {
    t.skip("backend does not negotiate API 1.55");
    return;
  }
  const key = session.header.querySessionId;
  // A default plan keeps the historical checkpoint-only BSL behavior.
  const unchanged = await session.prepare(facts(7, owner, false), "SELECT 1");
  assert.equal(unchanged.saveOwner, false);
  await session.applied(unchanged.applyToken, facts(7, owner, false));
  for (const version of [7, 8]) {
    const draft = `SELECT ${version}`;
    await value.store.saveDraft(id, draft);
    const plan = await session.prepare(facts(version, owner, false), draft, [], "crlf", true);
    assert.equal(plan.saveOwner, true);
    owner = apply(owner, plan);
    await writeFile(value.module, "\ufeff" + owner);
    await session.applied(plan.applyToken, facts(version + 1, owner, false));
    assert.equal(session.header.querySessionId, key);
    assert.equal(session.header.resumed, true);
    assert.equal(session.record.base, draft);
  }
  assert.deepEqual(flags, [undefined, true, true]);
});

for (const locale of ["ru-RU", "en-US"]) test(`source-session SDK rebases input arriving during a native receipt (${locale})`,
  { skip: !executable }, async t => {
    let entered, release, hold = true;
    const gate = new Promise(resolve => { release = resolve; });
    const receiving = new Promise(resolve => { entered = resolve; });
    const value = await fixture(t, locale, endpoint => ({ ...endpoint, sessions: { ...endpoint.sessions,
      request: async (method, params) => {
        const result = await endpoint.sessions.request(method, params);
        if (method === "query/sessionApplied" && hold) { hold = false; entered(); await gate; }
        return result;
      } } }));
    assert.equal(value.session.record.ownerText, value.input);
    await value.store.saveDraft(value.id, "SELECT applied 😀");
    const plan = await value.session.prepare(facts(7, value.input), "SELECT applied 😀", [], "lf");
    assert.equal(plan.saveOwner, false);
    const output = apply(value.input, plan);
    const receipt = value.session.applied(plan.applyToken, facts(8, output));
    await receiving;
    const newest = value.store.saveDraft(value.id, "SELECT newer 😀");
    await Promise.resolve();
    release();
    await receipt; await newest; await value.store.settled();
    assert.equal(value.session.record.ownerText, output);
    assert.equal(value.session.record.base, "SELECT applied 😀");
    assert.equal(value.session.record.draft, "SELECT newer 😀");
    assert.equal((await readFile(value.formPath, "utf8")).includes("SELECT applied"), false);
    await assert.rejects(value.session.prepare(facts(8, output), "SELECT applied 😀"),
      error => error.domain === "query_failed" && error.details.reason === "stale_draft");
    const next = await value.session.prepare(facts(8, output), "SELECT newer 😀");
    await value.session.abort(next.applyToken);
    assert.equal(value.session.header.resumed, false);
    const persisted = JSON.parse(await readFile(join(value.outer, "private", value.id + ".json"), "utf8"));
    assert.equal(persisted.storageVersion, 1);
    await value.session.close();
  });

test("source-session SDK resumes a durable pending result under a replacement process without losing the latest draft",
  { skip: !executable }, async t => {
    const value = await fixture(t);
    await value.store.saveDraft(value.id, "SELECT applied");
    const plan = await value.session.prepare(facts(7, value.input), "SELECT applied");
    const output = apply(value.input, plan);
    await value.store.saveDraft(value.id, "SELECT latest");
    const old = value.session;
    value.tree.dispose();
    await value.connection.connect(value.target);
    await assert.rejects(old.prepare(facts(7, value.input), "SELECT latest"), { code: "obsolete" });
    await bind(value);
    value.session = await value.client.restore(value.id);
    assert.equal(value.session.header.resumed, false);
    assert.equal(value.session.header.applyPending, true);
    await value.session.resume(facts(1, output));
    assert.equal(value.session.record.ownerText, output);
    assert.equal(value.session.record.base, "SELECT applied");
    assert.equal(value.session.record.draft, "SELECT latest");
    assert.equal((await readFile(value.formPath, "utf8")).includes("SELECT applied"), false);
    await value.session.close();
  });

test("invalid plan data cannot erase the acknowledged durable intent or make the checkpoint cache stale",
  { skip: !executable }, async t => {
    let malformed = true;
    const value = await fixture(t, "en-US", endpoint => ({ ...endpoint, sessions: { ...endpoint.sessions,
      request: async (method, params) => {
        const result = await endpoint.sessions.request(method, params);
        if (method === "query/sessionPrepare" && malformed) { malformed = false; result.plan.outputSnapshot = "0".repeat(64); }
        return result;
      } } }));
    await value.store.saveDraft(value.id, "SELECT 2");
    await assert.rejects(value.session.prepare(facts(7, value.input), "SELECT 2"), { code: "protocolInvalid" });
    assert.equal(value.session.header.applyPending, true);
    await value.session.abort(value.session.header.record.prepared.applyToken);
    await value.store.saveDraft(value.id, "SELECT 3");
    await value.session.resume(facts(7, value.input));
    const plan = await value.session.prepare(facts(7, value.input), "SELECT 3");
    await value.session.abort(plan.applyToken);
    await value.session.close();
  });
