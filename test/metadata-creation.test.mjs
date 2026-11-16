import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { creationCapability, creationSchema, creationPlan, creationPreview } from '../out/metadata-creation-protocol.js';
import { MetadataCreation } from '../out/metadata-creation.js';
import { MetadataTree, parseNode } from '../out/tree.js';
import { Connection } from '../out/connection.js';
import { ExplorerError } from '../out/protocol.js';
import { revealHit } from '../out/search.js';
import { createTreeProject } from './fixture.mjs';
import { deferCleanup } from './cleanup.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const caption = name => ({ 'ru-RU': name, 'en-US': name });
const option = value => ({ value, caption: caption(String(value)) });
const original = Buffer.from('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n<Properties><Name>😀 Тест</Name></Properties>\r\n');
const owner = 'opaque-owner';
function schema(bytes = original) {
  return { schemaVersion: 1, owner, snapshot: hash(bytes), writable: true, kinds: ['attribute', 'table-part'],
    kindOptions: ['attribute', 'table-part'].map(option),
    capabilities: { limits: { nameUtf16Max: 80, stringLengthMin: 0, stringLengthMax: 1024, stringFixedLengthMin: 1, stringFixedLengthMax: 100, numberDigitsMin: 0, numberDigitsMax: 38 },
      primitiveTypes: [{ key: { namespace: 'xs', name: 'boolean' }, default: { kind: 'boolean' }, caption: caption('Булево') }],
      fieldCaptions: Object.fromEntries(['name', 'synonym', 'comment', 'type', 'length', 'fixed', 'digits', 'fractionDigits', 'nonNegative', 'fractions'].map(key => [key, caption(key)])),
      dateFractions: ['date', 'time', 'dateTime'].map(option), allowedLength: [false, true].map(option), allowedSign: [false, true].map(option) },
    references: [{ object: 'opaque-reference', kind: 'Catalog', name: 'Товары', caption: caption('СправочникСсылка.Товары') }],
    languages: [{ object: 'language-id', name: 'Русский', code: 'ru' }] };
}
function planFor(request, bytes = original) {
  const insertion = '<!-- ' + request.name + ' -->';
  const offset = bytes.length;
  return { schemaVersion: 1, valid: true, changed: true, objectId: 'opaque-new-object', source: { value: 'owner.xml', encoding: 'utf-8' }, snapshot: hash(bytes),
    prepared: { request, identity: { uuid: '55555555-5555-4555-8555-555555555555' }, expectedOutputSnapshot: hash(Buffer.concat([bytes, Buffer.from(insertion)])) },
    changes: [{ range: { start: offset, end: offset }, replacement: insertion }] };
}
const request = { owner, snapshot: hash(original), name: 'НовыйРеквизит', kind: 'attribute', types: [{ kind: 'boolean' }], synonyms: [], comment: '' };

for (const locale of ['ru-RU', 'en-US']) test(`creation schema negotiates optional capability and platform captions: ${locale}`, () => {
  assert.equal(creationCapability({ capabilities: {} }), false);
  assert.equal(creationCapability({ apiVersion: { major: 1, minor: 48 }, capabilities: { metadataCreation: { schemaVersion: 1, enabled: true, preparedPlans: true } } }), true);
  assert.equal(creationCapability({ apiVersion: { major: 1, minor: 48 }, capabilities: { metadataCreation: { schemaVersion: 1, enabled: false, preparedPlans: true } } }), false);
  assert.throws(() => creationCapability({ apiVersion: { major: 1, minor: 47 }, capabilities: { metadataCreation: { schemaVersion: 1, enabled: true, preparedPlans: true } } }), { code: 'protocolInvalid' });
  const parsed = creationSchema(schema(), owner);
  assert.equal(parsed.capabilities.primitiveTypes[0].caption[locale], 'Булево');
  assert.equal(parsed.references[0].object, 'opaque-reference');
  assert.equal(parsed.capabilities.limits.numberDigitsMin, 0);
  for (const mutate of [value => { value.owner = 'other'; }, value => { value.capabilities.allowedLength = []; }, value => { value.capabilities.primitiveTypes[0].default.kind = 'xml'; }, value => { value.capabilities.fieldCaptions.name[locale] = null; }]) {
    const value = schema(); mutate(value); assert.throws(() => creationSchema(value, owner), { code: 'protocolInvalid' });
  }
});

test('preview renders backend byte replacements without disturbing BOM, CRLF or non-BMP characters', () => {
  const plan = creationPlan(planFor(request));
  const preview = creationPreview(original, plan);
  assert.equal(preview.before, original.toString().slice(1));
  assert.equal(preview.after, original.toString().slice(1) + '<!-- НовыйРеквизит -->');
  assert.throws(() => creationPreview(Buffer.from('edited'), plan), { code: 'sourceChanged' });
  const badOutput = structuredClone(plan); badOutput.prepared.expectedOutputSnapshot = '0'.repeat(64);
  assert.throws(() => creationPreview(original, badOutput), { code: 'protocolInvalid' });
  for (const mutate of [value => { value.changes[0].range.end = -1; }, value => { value.changes.push({ range: { start: 0, end: 1 }, replacement: '' }); }, value => { value.prepared.request.snapshot = 'a'.repeat(64); }, value => { value.prepared.request.types = [{ kind: 'number', digits: Infinity }]; }]) {
    const value = planFor(request); value.prepared.request = structuredClone(request); mutate(value);
    assert.throws(() => creationPlan(value), { code: 'protocolInvalid' });
  }
  const beyond = planFor(request); beyond.changes[0].range.end++;
  assert.throws(() => creationPreview(original, creationPlan(beyond)), { code: 'protocolInvalid' });
});

test('node creation hints accept only backend-declared creation kinds on objects', () => {
  const node = { id: { kind: 'object', objectId: owner }, parent: null, label: { kind: 'name', text: 'Тест' }, state: 'unloaded', expandedByDefault: false, rootSection: false, creationKinds: ['attribute', 'table-part'] };
  assert.deepEqual(parseNode(node).creationKinds, ['attribute', 'table-part']);
  assert.throws(() => parseNode({ ...node, creationKinds: ['form'] }), { code: 'protocolInvalid' });
  assert.throws(() => parseNode({ ...node, id: { kind: 'module', owner, role: 'object' } }), { code: 'protocolInvalid' });
});

test('metadata/create never retries a stale generation, lost acknowledgement or superseded result', async () => {
  for (const failure of ['stale_generation', 'connectionLost', 'older-result']) {
    let calls = 0;
    const project = { info: { projectId: 'project', generation: '1', eventSequence: '1' } };
    const tree = Object.assign(Object.create(MetadataTree.prototype), { session: { sessionId: 'session' }, scopes: new Map(), async drainInputs() {},
      connection: { async request() {
        calls++; project.info.generation = '2'; project.info.eventSequence = '2';
        if (failure === 'stale_generation') throw new ExplorerError('requestFailed', failure);
        if (failure === 'connectionLost') throw new ExplorerError(failure);
        return { sessionId: 'session', projectId: 'project', generation: '1', eventSequence: '1', changed: true };
      } } });
    if (failure === 'older-result') assert.equal((await tree.request(project, 'metadata/create')).changed, true);
    else await assert.rejects(tree.request(project, 'metadata/create'));
    assert.equal(calls, 1, failure);
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(process.env.ESKA_TEST_ROOT ?? resolve('../eska-playground'), 'explorer-creation-'));
  deferCleanup(t, () => rm(root, { recursive: true, force: true }));
  return root;
}
function harness(root, options = {}) {
  const calls = [], requests = [], messages = [], tabs = [], inputs = options.inputs ?? ['НовыйРеквизит', '', ''];
  let current, provider, dirty = options.dirty === 'before', text = original.toString().slice(1);
  class Uri {
    constructor(scheme, path) { this.scheme = scheme; this.path = path; this.fsPath = path; }
    static from({ scheme, path }) { return new Uri(scheme, path); }
    static file(path) { return new Uri('file', path); }
    toString() { return this.scheme + ':' + this.path; }
  }
  class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
  class CancellationTokenSource { token = { isCancellationRequested: false }; cancel() { this.token.isCancellationRequested = true; } dispose() {} }
  const api = { Uri, TabInputTextDiff, CancellationTokenSource,
    workspace: { isTrusted: true, registerTextDocumentContentProvider(_scheme, value) { provider = value; return { dispose() {} }; },
      async openTextDocument() { return { get isDirty() { return dirty; }, getText: () => text }; } },
    commands: { async executeCommand(command, before, after) {
      assert.equal(command, 'vscode.diff'); calls.push('diff');
      assert.equal(provider.provideTextDocumentContent(before), text);
      assert.ok(provider.provideTextDocumentContent(after).includes('НовыйРеквизит'));
      tabs.push({ input: new TabInputTextDiff(before, after) });
    } },
    window: { tabGroups: { all: [{ tabs }], async close(values) { for (const tab of values) tabs.splice(tabs.indexOf(tab), 1); return true; } },
      async showQuickPick(items, settings) { calls.push('pick'); return options.cancel === 'input' ? undefined : settings.canPickMany ? (options.composite ? items : [items[0]]) : options.kind === 'table-part' && items.some(item => item.value === 'table-part') ? items.find(item => item.value === 'table-part') : items[0]; },
      async showInputBox() { calls.push('input'); return inputs.shift(); },
      async showInformationMessage(value, ...items) {
        messages.push(value);
        if (!items.length) return;
        if (options.dirty === 'review') dirty = true;
        if (options.changed) await writeFile(join(root, 'owner.xml'), 'changed');
        if (options.stale) { current = undefined; creation.stale(); }
        if (options.closed) tabs.length = 0;
        return options.cancel === 'review' ? undefined : items[0];
      },
      async showErrorMessage(value) { messages.push(value); calls.push('error'); } } };
  const project = { info: { sourcePath: { value: root, encoding: 'utf-8' } } };
  const entry = { project, node: { id: { kind: 'object', objectId: owner } } };
  const tree = { async request(_project, method, params) {
    calls.push(method);
    if (method === 'metadata/creationSchema') { const value = schema(); if (options.primitiveTypes) value.capabilities.primitiveTypes = options.primitiveTypes.map(type => ({ default: type, caption: caption(type.kind), key: {} })); return value; }
    if (method === 'metadata/previewCreate') { requests.push(params.request); return planFor(params.request); }
    assert.equal(method, 'metadata/create');
    if (options.uncertain) throw new ExplorerError('connectionLost');
    return { changed: true, objectId: 'opaque-new-object', uuid: params.prepared.identity.uuid, snapshot: params.prepared.expectedOutputSnapshot };
  } };
  current = tree;
  const creation = new MetadataCreation(api, () => options.readOnly === true);
  return { creation, calls, requests, messages, tabs, run: () => creation.run(tree, entry, () => current, options.locale ?? 'ru-RU') };
}

for (const scenario of [
  { name: 'cancel initial input', cancel: 'input' }, { name: 'cancel review', cancel: 'review' },
  { name: 'unsaved owner before preview', dirty: 'before' }, { name: 'unsaved owner during review', dirty: 'review' },
  { name: 'changed owner on disk', changed: true }, { name: 'read-only owner', readOnly: true },
  { name: 'replaced backend', stale: true }, { name: 'closed review tab', closed: true },
]) test(`creation preserves source and never writes after ${scenario.name}`, async t => {
  const root = await fixture(t); await writeFile(join(root, 'owner.xml'), original);
  const value = harness(root, scenario); deferCleanup(t, () => value.creation.dispose());
  assert.equal(await value.run(), undefined);
  assert.equal(value.calls.filter(call => call === 'metadata/create').length, 0);
  assert.equal(value.tabs.length, 0);
  if (!scenario.changed) assert.deepEqual(await readFile(join(root, 'owner.xml')), original);
  if (scenario.dirty) assert.ok(value.messages.some(text => /несохран|unsaved/i.test(text)));
});

for (const locale of ['ru-RU', 'en-US']) test(`native wizard applies exactly the reviewed prepared input: ${locale}`, async t => {
  const root = await fixture(t); await writeFile(join(root, 'owner.xml'), original);
  const value = harness(root, { locale }); deferCleanup(t, () => value.creation.dispose());
  assert.equal(await value.run(), 'opaque-new-object');
  assert.equal(value.calls.filter(call => call === 'metadata/create').length, 1);
  assert.ok(value.calls.indexOf('diff') < value.calls.indexOf('metadata/create'));
  assert.equal(value.tabs.length, 0);
  assert.ok(value.messages.some(text => locale === 'ru-RU' ? text.includes('Создан объект') : text.includes('Created')));
});

test('a lost creation acknowledgement explains uncertainty and never resends', async t => {
  const root = await fixture(t); await writeFile(join(root, 'owner.xml'), original);
  const value = harness(root, { uncertain: true }); deferCleanup(t, () => value.creation.dispose());
  assert.equal(await value.run(), undefined);
  assert.equal(value.calls.filter(call => call === 'metadata/create').length, 1);
  assert.ok(value.messages.some(text => text.includes('Результат создания не подтверждён')));
});


test('wizard builds semantic composite qualifiers and references from shared backend options', async t => {
  const root = await fixture(t); await writeFile(join(root, 'owner.xml'), original);
  const types = [{ kind: 'string', length: 10, fixed: true }, { kind: 'number', digits: 15, fractionDigits: 2, nonNegative: true }, { kind: 'date', fractions: 'dateTime' }];
  const value = harness(root, { primitiveTypes: types, composite: true, inputs: ['НовыйРеквизит', '25', '20', '4', 'Представление', 'Комментарий'] });
  deferCleanup(t, () => value.creation.dispose());
  assert.equal(await value.run(), 'opaque-new-object');
  assert.deepEqual(value.requests[0].types, [{ kind: 'string', length: 25, fixed: true }, { kind: 'number', digits: 20, fractionDigits: 4, nonNegative: true }, { kind: 'date', fractions: 'dateTime' }, { kind: 'reference', object: 'opaque-reference' }]);
  assert.deepEqual(value.requests[0].synonyms, [{ language: 'ru', content: 'Представление' }]);
  assert.equal(value.requests[0].comment, 'Комментарий');
});

test('tabular section wizard does not collect an attribute type', async t => {
  const root = await fixture(t); await writeFile(join(root, 'owner.xml'), original);
  const value = harness(root, { kind: 'table-part' }); deferCleanup(t, () => value.creation.dispose());
  assert.equal(await value.run(), 'opaque-new-object');
  assert.equal(value.calls.filter(call => call === 'pick').length, 1);
  assert.deepEqual(value.requests[0].types, []);
  assert.equal(value.requests[0].kind, 'table-part');
});

const executable = process.env.ESKA_TEST_BINARY;
for (const locale of ['ru-RU', 'en-US']) test(`real Rust backend: preview, create, reveal and stale replay rejection: ${locale}`, { skip: !executable }, async t => {
  const root = await fixture(t), source = await createTreeProject(root);
  await mkdir(join(source.source, 'Ext'), { recursive: true });
  await writeFile(join(source.source, 'Ext', 'ParentConfigurations.bin'), '{6,0,0,0,0,0}');
  const connection = new Connection('test', () => {}, () => {});
  deferCleanup(t, () => connection.dispose());
  await connection.connect({ executable, path: root, locale, name: 'creation' });
  const state = connection.state;
  assert.equal(state.kind, 'ready', JSON.stringify(state)); assert.equal(state.metadataCreation, true);
  const tree = new MetadataTree(connection, state.session, () => {}, () => {});
  deferCleanup(t, () => tree.dispose());
  const project = tree.projects[0], rootNode = await tree.root(project);
  const catalogGroup = (await tree.children(rootNode)).find(value => value.node.id.collection?.metadataKind === 'catalog');
  assert.ok(catalogGroup);
  const catalog = (await tree.children(catalogGroup)).find(value => value.node.label.text === 'Товары');
  assert.deepEqual(catalog.node.creationKinds, ['attribute', 'table-part']);
  const catalogId = catalog.node.id.objectId;
  const wire = creationSchema(await tree.request(project, 'metadata/creationSchema', { owner: catalogId }), catalogId);
  assert.equal(wire.writable, true);
  assert.ok(wire.capabilities.fieldCaptions.name[locale]);
  const input = { owner: catalogId, snapshot: wire.snapshot, kind: 'attribute', name: 'СозданЧерезExplorer', synonyms: [], comment: '', types: [{ kind: 'string', length: 64, fixed: false }] };
  const plan = creationPlan(await tree.request(project, 'metadata/previewCreate', { request: input }));
  const before = await readFile(source.descriptor);
  const preview = creationPreview(before, plan);
  assert.deepEqual(await readFile(source.descriptor), before);
  assert.ok(preview.after.includes('СозданЧерезExplorer'));
  const result = await tree.request(project, 'metadata/create', { prepared: plan.prepared });
  assert.equal(result.snapshot, plan.prepared.expectedOutputSnapshot);
  assert.equal((await readFile(source.descriptor, 'utf8')).replace(/^\uFEFF/, ''), preview.after);
  const created = await revealHit(tree, project, { objectId: result.objectId, node: { kind: 'object', objectId: result.objectId } });
  assert.equal(created.node.label.text, 'СозданЧерезExplorer');
  await assert.rejects(tree.request(project, 'metadata/create', { prepared: plan.prepared }), error => ['property_conflict', 'creation_collision'].includes(error.domain));
  assert.equal((await readFile(source.descriptor, 'utf8')).match(/<Name>СозданЧерезExplorer<\/Name>/g).length, 1);
});
