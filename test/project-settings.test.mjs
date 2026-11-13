import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { draft, formatErrors, serialize } from "../webview/settings/profile.mjs";
import { settingsRequest } from "../out/project-settings-protocol.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
const bundle = build({
  stdin: { resolveDir: repository, contents: `
    import { createRoot } from "solid-js";
    import { settingsController } from "./webview/settings/controller.js";
    export function setup(initial) {
      let saved = initial;
      const requests = [];
      return createRoot(dispose => {
        const model = settingsController({
          postMessage: value => requests.push(value),
          getState: () => saved, setState: value => { saved = value; },
        });
        return { model, requests, persisted: () => saved, dispose };
      });
    }
  ` },
  bundle: true, write: false, platform: "browser", format: "cjs",
  conditions: ["browser", "production"], define: { "process.env.NODE_ENV": '"production"' },
});
const fixture = (path = "test-base") => ({
  infobase: { kind: "file", path }, runner: { kind: "local", ibcmd: null, version: null },
  debug: null, authentication: null,
});
const original = { test: fixture(), prod: fixture("prod-base") };

async function open(t, persisted) {
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, crypto, URL });
  const value = data => runInContext(`(${JSON.stringify(data)})`, context);
  runInContext((await bundle).outputFiles[0].text, context);
  const h = module.exports.setup(value(persisted));
  t.after(h.dispose);
  const last = () => JSON.parse(JSON.stringify(h.requests.at(-1)));
  const receive = data => h.model.receive(value(data));
  const reply = (request, settings, warning) => receive({
    type: "settings", id: request.id, profile: request.profile, operation: request.type, settings, warning,
  });
  h.model.load();
  const load = last();
  assert.equal(load.type, "load");
  assert.equal(h.model.loaded(), false);
  return { ...h, last, load, receive, reply };
}

test("runtime fields round-trip both runners, all infobases, and existing debug declarations", () => {
  for (const profile of [
    fixture(),
    { infobase: { kind: "cluster", host: "[::1]:1541", name: "Заказы" },
      runner: { kind: "distrobox", container: "onec-alt10", ibcmd: "/opt/1c/ibcmd", version: "8.3.27.2342" },
      debug: { url: "http://localhost:1550", auto_attach_types: [],
        external_processing: { artifact: "build/Обработка.epf", debug_url: "file:///Проект/Обработка.epf" } },
      authentication: { user: "Разработчик", password_env: "ESKA_TEST_PASSWORD" },
    },
    { ...fixture(), infobase: { kind: "standalone", url: "https://example.invalid/ib", name: "Test", admin_pid: 42 } },
    { ...fixture(), debug: { managed: true, port: 49160, auto_attach_types: ["ManagedClient"] } },
  ]) {
    assert.deepEqual(serialize(draft(profile)), profile);
  }
  const disabled = { ...draft(fixture()), enabled: false };
  assert.equal(serialize(disabled), null);
  assert.equal(disabled.path, "test-base");
});

test("format feedback follows the distinction between client URLs and dbgs origins", () => {
  for (const endpoint of ["http://localhost", "http://[::1]:1550/", "http://отладка.тест:1550"]) {
    assert.deepEqual(formatErrors({ ...draft(fixture()), endpoint }), {});
  }
  for (const endpoint of ["https://localhost", "localhost:1550", "http://", "http://host:0",
    "http://host:65536", "http://host/path", "http://u@host", "http://host/?x", "http://host/#",
    "http://host\t"]) {
    assert.equal(formatErrors({ ...draft(fixture()), endpoint }).endpoint, "invalidEndpoint", endpoint);
  }
  const standalone = { ...draft(fixture()), kind: "standalone", url: "https://host:8443/ib", admin: "4294967295" };
  assert.deepEqual(formatErrors(standalone), {});
  assert.equal(formatErrors({ ...standalone, url: "ftp://host" }).url, "invalidInfobaseUrl");
  assert.equal(formatErrors({ ...standalone, admin: "4294967296" }).admin, "invalidAdmin");
  const cluster = { ...draft(fixture()), kind: "cluster", host: "server:1541" };
  assert.deepEqual(formatErrors(cluster), {});
  assert.equal(formatErrors({ ...cluster, host: "https://host" }).host, "invalidHost");
  assert.equal(formatErrors({ ...draft(fixture()), managedDebug: true, debugPort: "0" }).debugPort, "invalidDebugPort");
});

test("save sends only the active profile and acknowledges only the submitted snapshot", async t => {
  const h = await open(t);
  h.reply(h.load, original);
  assert.equal(h.model.canSave(), false);
  h.model.edit("path", "test draft");
  h.model.select("prod");
  h.model.edit("path", "production draft");
  h.model.save();
  const saving = h.last();
  assert.deepEqual(saving.value, fixture("production draft"));
  assert.equal(saving.profile, "prod");
  assert.equal(h.model.saving(), true);
  h.model.edit("path", "newer production draft");
  h.model.select("test");
  h.reply(saving, { ...original, prod: saving.value });
  assert.equal(h.model.current().draft.path, "test draft");
  assert.equal(h.model.dirty("test"), true);
  assert.equal(h.model.dirty("prod"), true);
  h.model.select("prod");
  assert.equal(h.model.current().saved.path, "production draft");
  assert.equal(h.model.current().draft.path, "newer production draft");
  h.model.discard();
  assert.equal(h.model.current().draft.path, "production draft");
  assert.equal(h.model.dirty("prod"), false);
  assert.equal(h.model.dirty("test"), true);
});

test("reload and webview reinitialization keep drafts and identify a newer disk revision", async t => {
  const h = await open(t);
  h.reply(h.load, original);
  h.model.edit("path", "unsaved");
  h.model.select("prod");
  const restored = await open(t, h.persisted());
  restored.reply(restored.load, { ...original, test: fixture("external change") });
  assert.equal(restored.model.active(), "prod");
  restored.model.select("test");
  assert.equal(restored.model.current().draft.path, "unsaved");
  assert.equal(restored.model.current().saved.path, "external change");
  assert.equal(restored.model.current().diskChanged, true);
  restored.model.save();
  const save = restored.last();
  restored.receive({ type: "error", operation: "save", id: save.id, profile: "test",
    detail: "Concurrent write", requiresReload: true });
  assert.equal(restored.model.canSave(), false);
  assert.equal(restored.model.current().draft.path, "unsaved");
  restored.model.load();
  restored.reply(restored.last(), { ...original, test: fixture("second external change") });
  assert.equal(restored.model.canSave(), true);
  restored.model.discard();
  assert.equal(restored.model.current().draft.path, "second external change");
});

test("input errors, diagnostic results and picker replies are tied to their request and profile", async t => {
  const h = await open(t);
  h.reply(h.load, original);
  h.model.edit("endpoint", "tcp://localhost:1550");
  assert.equal(h.model.probe(), "endpoint");
  assert.equal(h.last().type, "load");
  h.model.edit("endpoint", "http://localhost:1550");
  h.model.probe();
  const old = h.last();
  assert.equal(old.value.debug.url, "http://localhost:1550");
  h.model.edit("endpoint", "http://localhost:1551");
  assert.equal(h.model.result().status, "stale");
  h.model.probe();
  const current = h.last();
  h.receive({ type: "probe", profile: "test", id: old.id, ready: true });
  assert.equal(h.model.result().status, "pending");
  h.model.select("prod");
  h.model.probe();
  const prod = h.last();
  h.receive({ type: "probe", profile: "prod", id: current.id, ready: true });
  assert.equal(h.model.result().status, "pending");
  h.receive({ type: "probe", profile: "test", id: current.id, ready: false, detail: "Unavailable" });
  h.receive({ type: "probe", profile: "prod", id: prod.id, ready: true, detail: "Available" });
  assert.equal(h.model.result().status, "success");
  h.model.select("test");
  assert.equal(h.model.result().detail, "Unavailable");
  assert.equal(h.model.canSave(), true, "availability does not block saving");
  h.model.edit("path", "later edit");
  assert.equal(h.model.result().status, "stale");
  h.model.pickInfobase();
  const picking = h.last();
  h.model.edit("enabled", false);
  assert.equal(h.last().type, "cancelPick");
  h.model.pickInfobase();
  assert.equal(h.last().type, "cancelPick");
  h.receive({ type: "infobase", profile: "test", id: picking.id, infobase: { kind: "file", path: "late choice" } });
  h.model.edit("enabled", true);
  assert.equal(h.model.current().draft.path, "later edit");
});

test("settings messages accept only known operations and profiles", () => {
  const id = crypto.randomUUID();
  assert.deepEqual(settingsRequest({ type: "save", id, profile: "prod", value: null }), {
    type: "save", id, profile: "prod", value: null,
  });
  assert.equal(settingsRequest({ type: "save", id, profile: "extra", value: {} }), undefined);
  assert.equal(settingsRequest({ type: "probe", id, profile: "test", value: null }), undefined);
  assert.equal(settingsRequest({ type: "load", id: 1, profile: "test" }), undefined);
});
