import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = build({ entryPoints: [fileURLToPath(new URL('../src/form-preview/service.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] });

async function fixture() {
  const api = { workspace: { isTrusted: true }, TreeItem: class {} };
  const module = { exports: {} };
  runInNewContext((await bundle).outputFiles[0].text, { module, exports: module.exports, process,
    require: name => name === 'vscode' ? api : require(name) });
  const frames = new Map(['main', 'preview'].map(role => {
    const messages = [];
    return [role, { role, ready: true, messages, panel: { title: role,
      webview: { postMessage: async value => { messages.push(value); return true; } } } }];
  }));
  const requests = [], tree = {}, schema = { writable: true, nodes: [] };
  const view = { frames, tree, entry: { project: { info: {} } }, phase: 'ready', sequence: 0,
    editor: { schema, status: { undo: true }, receive: async value => { requests.push(value); } } };
  const service = Object.assign(Object.create(module.exports.FormPreviewService.prototype), {
    connection: { state: { kind: 'ready', formEditor: true, formLayout: { Form: ['UsualGroup'], UsualGroup: ['InputField'] } } },
    tree: () => tree, locale: () => 'en-US',
  });
  return { api, service, view, frames, requests };
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
