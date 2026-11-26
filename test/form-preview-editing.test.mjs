import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = build({ entryPoints: [fileURLToPath(new URL('../src/form-preview/service.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] });

async function fixture(storage = new Map()) {
  const api = { workspace: { isTrusted: true }, TreeItem: class {} };
  const module = { exports: {} };
  runInNewContext((await bundle).outputFiles[0].text, { module, exports: module.exports, process, setTimeout, clearTimeout,
    require: name => name === 'vscode' ? api : require(name) });
  const frames = new Map(['main', 'preview'].map(role => {
    const messages = [];
    return [role, { role, ready: true, messages, panel: { title: role,
      webview: { postMessage: async value => { messages.push(value); return true; } } } }];
  }));
  const requests = [], tree = {}, schema = { writable: true, nodes: [] };
  const view = { key: 'test-form', frames, tree, entry: { project: { info: {} } }, phase: 'ready', sequence: 0,
    editor: { schema, status: { undo: true }, receive: async value => { requests.push(value); } } };
  const service = Object.assign(Object.create(module.exports.FormPreviewService.prototype), {
    connection: { state: { kind: 'ready', formEditor: true, formLayout: { Form: ['UsualGroup'], UsualGroup: ['InputField'] } } },
    tree: () => tree, locale: () => 'en-US',
    context: { workspaceState: { get: key => storage.get(key), update: async (key, value) => { storage.set(key, value); } } },
  });
  return { api, service, view, frames, requests, tree };
}

test('detached preview receives editing availability and layout without the inspector schema', async () => {
  const { service, view, frames } = await fixture();
  const preview = frames.get('preview'), main = frames.get('main');
  service.publish(view, false, preview);
  assert.equal(preview.messages.at(-1).authoring, true);
  assert.deepEqual(preview.messages.at(-1).formLayout, service.connection.state.formLayout);
  assert.equal(preview.messages.at(-1).editSchema, undefined);
  assert.equal(preview.messages.at(-1).palette, undefined);
  assert.equal(main.messages.at(-1).editSchema, view.editor.schema);
  for (const phase of ['stale', 'disconnected', 'ready']) {
    view.phase = phase;
    service.publish(view, false);
    assert.equal(preview.messages.at(-1).authoring, phase === 'ready');
  }
  view.editor.schema = { writable: false };
  service.publish(view, false);
  assert.equal(preview.messages.at(-1).authoring, false);
});

test('both preview frames receive the accepted theme after an older state publication', async () => {
  const { service, view, frames } = await fixture();
  service.rememberInspector = (target, state) => { target.inspectorState = state; };
  for (const [role, theme] of [['main', 'dark'], ['preview', 'light']]) {
    service.publish(view, false);
    await service.receive(view, frames.get(role), { type: 'previewTheme', previewTheme: theme });
    for (const frame of frames.values()) {
      assert.equal(frame.messages.at(-1)?.type, 'previewTheme');
      assert.equal(frame.messages.at(-1)?.previewTheme, theme);
      assert.equal(frame.messages.at(-2)?.type, 'state');
    }
  }
});

test('stale inspector snapshots cannot overwrite the shared theme or its workspace persistence', async () => {
  const storage = new Map();
  const { service, view, frames } = await fixture(storage);
  for (const [role, theme] of [['main', 'dark'], ['preview', 'light'], ['preview', 'vscode']]) {
    const previous = view.inspectorState?.ui ?? { previewTheme: 'light' };
    await service.receive(view, frames.get(role), { type: 'previewTheme', previewTheme: theme });
    await service.receive(view, frames.get('main'), { type: 'inspectorState', ui: { ...previous, left: 41 } });
    assert.equal(view.inspectorState.ui.left, 41);
    assert.equal(view.inspectorState.ui.previewTheme, theme);
    service.publish(view, false);
    for (const frame of frames.values()) assert.equal(frame.messages.at(-1).previewTheme, theme);
    await service.flushInspectors();
    const reloaded = await fixture(storage);
    const saved = reloaded.service.savedInspectors().get(service.inspectorKey(view.key));
    assert.equal(saved.ui.left, 41);
    assert.equal(saved.ui.previewTheme, theme);
  }
});

test('restoring a stale main panel retains the workspace theme and falls back to serialized state when absent', async () => {
  for (const savedTheme of ['light', 'vscode', undefined]) {
    const storage = new Map();
    const original = await fixture(storage);
    if (savedTheme) {
      await original.service.receive(original.view, original.frames.get('preview'), { type: 'previewTheme', previewTheme: savedTheme });
      await original.service.flushInspectors();
    }
    const { service, view, tree } = await fixture(storage);
    view.inspectorState = service.savedInspectors().get(service.inspectorKey(view.key));
    view.frames.clear();
    const root = resolve('restore-theme-workspace'), path = join(root, 'Form.xml');
    const project = { info: { sourcePath: { value: root, encoding: 'utf-8' } } };
    const entry = { project, node: { id: { kind: 'object' }, metadataKind: 'form' } };
    Object.assign(tree, { projects: [project], connection: { state: { kind: 'ready', sourceNavigation: true } },
      request: async () => ({ source: { path: { value: 'Form.xml', encoding: 'utf-8' }, role: { kind: 'payload' } }, nodes: [] }),
      acceptAncestry: () => entry });
    let restored = false;
    Object.assign(service, { ensureTree: async () => tree, view: async () => view, schedule: () => {},
      frame: () => { restored = true; }, log: message => assert.fail(message) });
    await service.restore({ dispose: () => assert.fail('valid panel must restore') }, {
      schemaVersion: 1, role: 'main', path, ui: { previewTheme: 'dark', left: 43 },
    });
    assert.equal(restored, true);
    assert.equal(view.inspectorState.ui.left, 43);
    assert.equal(view.inspectorState.ui.previewTheme, savedTheme ?? 'dark');
  }
});

test('detached preview moves use the shared editor and retain its access restrictions', async () => {
  const { api, service, view, frames, requests } = await fixture();
  const preview = frames.get('preview');
  const move = { kind: 'moveElement', target: { kind: 'element', id: 2 }, parent: { kind: 'element', id: 1 }, before: null };
  const request = { type: 'formDraft', action: 'change', id: 1, operations: [move] };
  await service.receive(view, preview, request);
  assert.deepEqual(requests, [request]);
  const rejects = async value => {
    const count = requests.length;
    await service.receive(view, preview, value);
    assert.equal(requests.length, count);
    assert.equal(preview.messages.at(-1).message, 'editUnavailable');
  };
  for (const patch of [{ operations: [] }, { operations: [null] }, { operations: [move, move] },
    { operations: [{ kind: 'removeElement', target: move.target }] }, { merge: 'property-key' },
    { action: 'placeAttribute' }, { action: 'discard' }]) await rejects({ ...request, ...patch });
  view.handlerEditing = true;
  await rejects(request);
  view.handlerEditing = false;
  view.phase = 'stale';
  await rejects(request);
  view.phase = 'ready';
  api.workspace.isTrusted = false;
  await rejects(request);
  api.workspace.isTrusted = true;
  for (const action of ['undo', 'redo', 'save']) {
    await service.receive(view, preview, { type: 'formDraft', action, id: 2 });
    assert.equal(requests.at(-1).action, action);
  }
});
