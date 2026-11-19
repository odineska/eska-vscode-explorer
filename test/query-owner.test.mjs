import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

/** Load compiled owner code with scoped native boundaries, without global module mocks. */
function fixture({ invalidate = true, churn = false, changeDocument = false, writable = true, configured = false, scheme = "file" } = {}) {
  const require = createRequire(new URL('../out/query/owner.js', import.meta.url));
  const { ExplorerError } = require('../protocol.js');
  const uri = { scheme, fsPath: '/project/ObjectModule.bsl', toString: () => 'file:///project/ObjectModule.bsl' };
  const document = { uri, version: 1, isClosed: false };
  const project = { info: { generation: '1', eventSequence: '1', sourcePath: {} } };
  let reveals = 0, requests = 0, barriers = 0;
  const tree = {
    async synchronizeInputs() { barriers++; },
    async request(candidate, method, params) {
      assert.equal(candidate, project); assert.equal(method, 'metadata/source');
      assert.equal(params.node.kind, 'module');
      requests++;
      if (requests === 1 || churn) {
        if (invalidate) {
          project.info.generation = String(Number(project.info.generation) + 1);
          project.info.eventSequence = String(Number(project.info.eventSequence) + 1);
        }
        if (changeDocument) document.version++;
        throw new ExplorerError('sourceMissing', 'unknown_node', { node: params.node });
      }
      assert.equal(reveals, requests, 'a retry must materialize the module through reverse navigation again');
      return { sources: [{ role: { kind: 'module' }, path: { value: 'ObjectModule.bsl', encoding: 'utf-8' } }] };
    },
  };
  const module = { exports: {} };
  const compiled = readFileSync(new URL('../out/query/owner.js', import.meta.url), 'utf8');
  const accesses = [];
  runInNewContext(`(function(require,module,exports){${compiled}\n})`)(name => {
    if (name === '../editor-policy.js') return { configuredReadOnly: () => configured };
    if (name === '../tree.js') return {};
    if (name === 'node:fs/promises') return { access: async (file, mode) => {
      accesses.push({ file, mode });
      if (!writable) throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    } };
    if (name === 'vscode') return { Uri: { file: () => uri }, FilePermission: { Readonly: 1 }, workspace: { fs: { stat: async () => ({}) } } };
    if (name === '../reveal.js') return { revealFile: async () => {
      reveals++;
      return { project, node: { id: { kind: 'module', owner: 'catalog:Товары', role: 'object' } } };
    } };
    if (name === '../source.js') return { existingSource: async () => uri.fsPath };
    return require(name);
  }, module, module.exports);
  return { run: () => module.exports.bslQueryOwner(tree, document), readOnly: allow => module.exports.nativeReadOnly(document, undefined, allow), accesses, document, counts: () => ({ reveals, requests, barriers }) };
}

test('BSL reopening resolves its lazy module again after a save invalidation during source lookup', async () => {
  const f = fixture();
  const owner = await f.run();
  assert.equal(owner.document, f.document);
  assert.deepEqual(f.counts(), { reveals: 2, requests: 2, barriers: 2 });
});

test('a real unknown BSL module without invalidation is not retried', async () => {
  const f = fixture({ invalidate: false });
  await assert.rejects(f.run(), { code: 'sourceMissing', domain: 'unknown_node' });
  assert.equal(f.counts().reveals, 1);
});

test('native owner changes stop lookup retries', async () => {
  const f = fixture({ changeDocument: true });
  await assert.rejects(f.run(), { domain: 'unknown_node' });
  assert.equal(f.counts().reveals, 1);
});

test('continuous source invalidation is bounded and reported as an owner conflict', async () => {
  const f = fixture({ churn: true });
  await assert.rejects(f.run(), { code: 'sourceChanged' });
  assert.deepEqual(f.counts(), { reveals: 3, requests: 3, barriers: 3 });
});


test('filesystem access protects file owners even without a configured readonly override', async () => {
  for (const allow of [false, true]) {
    const f = fixture({ writable: false });
    assert.equal(await f.readOnly(allow), true);
    assert.equal(f.accesses.length, 1);
    assert.equal(f.accesses[0].file, f.document.uri.fsPath);
  }
});

test('writable file owners still obey configured editor restrictions', async () => {
  const ordinary = fixture();
  assert.equal(await ordinary.readOnly(false), false);
  const restricted = fixture({ configured: true });
  assert.equal(await restricted.readOnly(false), true);
  assert.equal(await restricted.readOnly(true), false);
  assert.equal(restricted.accesses.length, 2);
});

test('virtual resources use provider and editor restrictions without native fs access', async () => {
  const f = fixture({ scheme: 'eska-query', writable: false });
  assert.equal(await f.readOnly(false), false);
  assert.equal(await f.readOnly(true), false);
  assert.equal(f.accesses.length, 0);
});
