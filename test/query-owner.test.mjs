import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

/** Load compiled owner code with scoped native boundaries, without global module mocks. */
function fixture({ invalidate = true, churn = false, changeDocument = false, writable = true, permissions, scheme = "file" } = {}) {
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
    if (name === '../tree.js') return {};
    if (name === 'node:fs/promises') return { access: async (file, mode) => {
      accesses.push({ file, mode });
      if (!writable) throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    } };
    if (name === 'vscode') return { Uri: { file: () => uri }, FilePermission: { Readonly: 1 }, workspace: { fs: { stat: async () => ({ permissions }) } } };
    if (name === '../reveal.js') return { revealFile: async () => {
      reveals++;
      return { project, node: { id: { kind: 'module', owner: 'catalog:Товары', role: 'object' } } };
    } };
    if (name === '../source.js') return { existingSource: async () => uri.fsPath };
    return require(name);
  }, module, module.exports);
  return { run: () => module.exports.bslQueryOwner(tree, document), readOnly: () => module.exports.nativeReadOnly(document), accesses, document, counts: () => ({ reveals, requests, barriers }) };
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


test('query source writes need filesystem access independently of the native editor mode', async () => {
  const writable = fixture();
  assert.equal(await writable.readOnly(), false);
  const denied = fixture({ writable: false });
  assert.equal(await denied.readOnly(), true);
  assert.equal(denied.accesses[0].file, denied.document.uri.fsPath);
});

test('a virtual draft or snapshot uses its own provider permissions', async () => {
  for (const permissions of [undefined, 1]) {
    const f = fixture({ scheme: 'eska-query', permissions, writable: false });
    assert.equal(await f.readOnly(), permissions === 1);
    assert.equal(f.accesses.length, 0);
  }
});
