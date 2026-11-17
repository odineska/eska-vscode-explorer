import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { deferCleanup } from './cleanup.mjs';

const require = createRequire(import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const wire = value => ({ encoding: 'utf-8', value });
const initial = '\ufeff<Form>\r\n<Title>Initial</Title>\n<Width>12</Width>\r\n</Form>';
const bundle = build({ entryPoints: [fileURLToPath(new URL('../src/form-preview/editor.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vscode'] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function harness(t, options = {}) {
  const root = await mkdtemp(join(process.env.ESKA_TEST_ROOT ?? resolve('../eska-playground'), 'form-autosave-'));
  deferCleanup(t, () => rm(root, { recursive: true, force: true }));
  const path = join(root, 'Form.xml');
  await writeFile(path, initial);
  const documents = [];
  const api = { workspace: { textDocuments: documents, getConfiguration: () => ({ get: (_, fallback) => fallback }), getWorkspaceFolder: () => undefined } };
  const module = { exports: {} };
  runInContext((await bundle).outputFiles[0].text, createContext({ module, exports: module.exports, Buffer, TextDecoder, process,
    require: name => name === 'vscode' ? api : require(name) }));
  const calls = [], responses = [], saved = [], history = [];
  let cursor = 0, applied = 0;
  const draft = { nodes: [], dynamicListAppearance: [], conditionalAppearance: null };
  const project = { info: { sourcePath: wire(root) } };
  const tree = { async request(_project, method, args) {
    calls.push(method);
    const input = await readFile(path, 'utf8');
    if (method === 'metadata/formEditSchema') {
      if (applied) await options.beforeRefresh?.();
      if (applied && options.failRefresh) throw Error('backend unavailable after commit');
      return { ...draft, schemaVersion: 1, form: 'form-id', snapshot: sha(input), path: wire('Form.xml'),
        elementKinds: [], definitionKinds: [], propertyCaptions: {}, choiceCaptions: {}, writable: true };
    }
    if (method === 'metadata/formEditHistory') return { undo: cursor > 0, redo: cursor < history.length };
    if (method === 'metadata/previewFormEdit') {
      assert.equal(args.request.snapshot, sha(input), 'the planner receives the current disk snapshot');
      let output = input;
      for (const operation of args.request.operations) {
        const { name } = operation.property.key;
        output = output.replace(new RegExp('(<'+name+'>)[^<]*(</'+name+'>)'), (_, before, after) => before+operation.property.value.Text+after);
      }
      return { schemaVersion: 1, form: 'form-id', valid: true, changed: output !== input, operation: 'form-edit', source: wire('Form.xml'),
        prepared: { request: args.request, sourceSnapshot: sha(input), expectedOutputSnapshot: sha(output) },
        inputs: [wire('Form.xml')], assignedIds: [], draft,
        changes: [{ range: { start: 0, end: Buffer.byteLength(input) }, replacement: output }] };
    }
    if (method === 'metadata/applyFormEdit') {
      options.applying?.resolve();
      if (options.release) await options.release.promise;
      assert.equal(args.prepared.request.snapshot, sha(await readFile(path)), 'queued commits may not overwrite another revision');
      let output = input;
      for (const operation of args.prepared.request.operations) {
        const { name } = operation.property.key;
        output = output.replace(new RegExp('(<'+name+'>)[^<]*(</'+name+'>)'), (_, before, after) => before+operation.property.value.Text+after);
      }
      assert.equal(sha(output), args.prepared.expectedOutputSnapshot);
      await writeFile(path, output);
      history.splice(cursor);
      history.push({ before: input, after: output });
      cursor++;
      applied++;
      return { schemaVersion: 1, form: 'form-id', changed: true, snapshot: sha(output) };
    }
    if (method === 'metadata/replayFormEdit') {
      assert.equal(args.snapshot, sha(input));
      const output = args.undo ? history[--cursor].before : history[cursor++].after;
      await writeFile(path, output);
      return { schemaVersion: 1, form: 'form-id', changed: true, snapshot: sha(output) };
    }
    throw Error('Unexpected request ' + method);
  } };
  const context = { tree, entry: { project, node: { id: { kind: 'object', objectId: 'form-id' } } }, path, origin: 'own',
    // Deliberately retain the old preview while edits and their history are committed.
    snapshot: { dependencies: [{ id: 'own', role: 'form', version: null, snapshot: sha(initial) }] } };
  let recovery;
  const editor = new module.exports.FormEditor(() => context, async () => ({ scheme: 'file', fsPath: path }), () => {}, options.recovery,
    async value => { recovery = value; saved.push(value); if (value) await options.persistDraft?.(path); });
  await editor.synchronize();
  assert.equal(editor.schema?.writable, true, JSON.stringify(editor.status));
  let id = 0;
  const send = (action, extra = {}) => editor.receive({ action, id: ++id, ...extra }, value => responses.push(value));
  const change = (name, value) => send('change', { operations: [{ kind: 'setProperty', target: { kind: 'form' },
    property: { key: { name, namespace: 'http://v8.1c.ru/8.3/xcf/logform' }, qualifiers: [], value: { Text: value } } }] });
  return { editor, context, change, send, documents, responses, path, calls, saved, get recovery() { return recovery; }, get applied() { return applied; } };
}

test('form changes are persisted immediately and history survives a delayed preview refresh', async t => {
  const h = await harness(t);
  await h.change('Title', 'Изменено');
  const first = initial.replace('Initial', 'Изменено');
  assert.equal(await readFile(h.path, 'utf8'), first);
  assert.equal(h.editor.dirty, false);
  assert.equal(h.recovery, undefined);
  assert.equal(h.editor.status.undo, true);
  await h.change('Width', '24');
  const second = first.replace('<Width>12', '<Width>24');
  assert.equal(await readFile(h.path, 'utf8'), second);
  assert.equal(h.applied, 2);
  await h.send('undo');
  assert.equal(await readFile(h.path, 'utf8'), first);
  await h.send('redo');
  assert.equal(await readFile(h.path, 'utf8'), second);
  await h.editor.synchronize();
  assert.equal(h.editor.status.undo, true);
  assert.ok(h.responses.every(response => !response.message));
  h.editor.dispose();
});

test('a second edit waits for an in-flight save and uses its resulting snapshot', async t => {
  const options = { applying: deferred(), release: deferred() };
  const h = await harness(t, options);
  const first = h.change('Title', 'First');
  await options.applying.promise;
  const second = h.change('Width', '42');
  assert.equal(await readFile(h.path, 'utf8'), initial);
  options.release.resolve();
  await Promise.all([first, second]);
  assert.equal(await readFile(h.path, 'utf8'), initial.replace('Initial', 'First').replace('<Width>12', '<Width>42'));
  assert.equal(h.applied, 2);
  assert.ok(h.responses.every(response => !response.message));
  h.editor.dispose();
});

test('external edits between preview and automatic publication preserve the draft and external bytes', async t => {
  const external = initial + '\n<!-- external change -->';
  const h = await harness(t, { persistDraft: path => writeFile(path, external) });
  await h.change('Title', 'Protected');
  assert.equal(await readFile(h.path, 'utf8'), external);
  assert.equal(h.applied, 0);
  assert.equal(h.editor.status.conflict, true);
  assert.equal(h.editor.dirty, true);
  assert.ok(h.editor.overlay.text.includes('Protected'));
  assert.ok(h.recovery.steps.length);
  assert.equal(h.responses.at(-1).message, 'editConflict');
  h.editor.dispose();
});

test('unsaved XML buffers are never overwritten by automatic form edits', async t => {
  const h = await harness(t);
  h.documents.push({ uri: { scheme: 'file', fsPath: h.path }, isDirty: true });
  await h.change('Title', 'Blocked');
  assert.equal(await readFile(h.path, 'utf8'), initial);
  assert.equal(h.applied, 0);
  assert.equal(h.responses.at(-1).message, 'editDirty');
  h.editor.dispose();
});

test('a refresh failure after commit reports the completed write and never repeats it', async t => {
  const options = { failRefresh: true };
  const h = await harness(t, options);
  await h.change('Title', 'Committed');
  assert.equal(await readFile(h.path, 'utf8'), initial.replace('Initial', 'Committed'));
  assert.equal(h.responses.at(-1).message, 'editSavedRefresh');
  assert.equal(h.editor.status.conflict, true);
  await h.send('save');
  assert.equal(h.applied, 1);
  options.failRefresh = false;
  await h.editor.synchronize();
  await h.change('Width', '30');
  assert.equal(h.applied, 2);
  h.editor.dispose();
});


test('automatic writes retain the schema during refresh and while the preview still contains the editor overlay', async t => {
  let h;
  h = await harness(t, { beforeRefresh: () => assert.equal(h.editor.schema?.writable, true, 'fields must not disappear during post-commit reload') });
  await h.change('Title', 'Persisted');
  h.context.snapshot.dependencies[0].version = 'eska-form-1';
  h.context.snapshot.dependencies[0].snapshot = sha(await readFile(h.path));
  await h.editor.synchronize();
  assert.equal(h.editor.schema?.writable, true, 'our delayed preview is not a dirty native editor');
  await h.change('Width', '25');
  assert.equal(h.responses.at(-1).message, undefined);
});
