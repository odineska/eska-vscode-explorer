import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const url = new URL('../out/scm-compare.js', import.meta.url);
function load(vscode = {}, invoke = async () => undefined) {
  const module = { exports: {} }, require = createRequire(url);
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, Buffer })(name => {
    if (name === 'vscode') return vscode;
    if (name === './tooling/inspect.js') return { findTool: async () => '/tools/eska-vcs' };
    if (name === './runtime-tools.js') return { runtimeJson: invoke };
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const from = '1'.repeat(40), to = '2'.repeat(40);
const commit = id => ({ id, subject: '<script>unsafe</script>', subject_encoding: 'utf-8', authored_at: '2026-01-01' });
const document = () => ({ schema_version: 4, kind: 'semantic', comparison: { kind: 'revisions', from: { commit: from }, to: { commit: to } },
  events: [{ kind: 'method_changed', object: { id: 'Catalog.Test' }, member: 'Test', path: 'Catalogs/Test/Module.bsl', path_encoding: 'utf-8' }],
  analysis: { complete: true, fallbacks: [] } });
test('strictly accepts immutable history and semantic revision contracts', () => {
  const api = load();
  assert.equal(api.comparisonHistory({ schema_version: 1, commits: [commit(from), commit(to)] }).length, 2);
  assert.throws(() => api.comparisonHistory({ schema_version: 1, commits: [commit(from), commit(from)] }));
  assert.throws(() => api.comparisonHistory({ schema_version: 1, commits: [commit('--worktree')] }));
  assert.equal(api.semanticComparison(document(), from, to).rows[0].member, 'Test');
  assert.throws(() => api.semanticComparison(document(), to, from));
  const partial = document(); partial.analysis.complete = false;
  assert.throws(() => api.semanticComparison(partial, from, to));
  partial.analysis.fallbacks.push({ reason: 'routine-parse', path: 'Module.bsl', path_encoding: 'utf-8' });
  assert.equal(api.semanticComparison(partial, from, to).fallbacks.length, 1);
});
test('selects project, excludes identical commit and calls read-only JSON commands in both languages', async () => {
  for (const language of ['ru', 'en']) {
    const calls = [], picks = [], panels = []; let validations = 0;
    const project = { root: '/repo/project', name: 'Project', executable: '/tools/eska-project', validate() { validations++; } };
    const vscode = { env: { language }, workspace: { isTrusted: true }, ViewColumn: { Active: 1 }, window: {
      showQuickPick: async (items, options) => { picks.push({ items, options }); return items[0]; },
      createWebviewPanel: (...args) => { const panel = { args, webview: {} }; panels.push(panel); return panel; }
    } };
    const api = load(vscode, async (binary, args) => {
      calls.push([binary, args]); return args.includes('history') ? { schema_version: 1, commits: [commit(from), commit(to)] } : document();
    });
    await api.compareRevisions([project, { ...project, root: '/other' }]);
    assert.equal(picks.length, 3); assert.equal(picks[2].items.length, 1); assert.equal(picks[2].items[0].commit.id, to);
    assert.equal(calls.length, 2); assert.ok(calls.every(([,args]) => args[1] === project.root));
    assert.deepEqual(Array.from(calls[1][1].slice(4)), ['diff', from, to, '--semantic', '--format', 'json']);
    assert.equal(validations, 3); assert.equal(panels.length, 1);
    assert.equal(panels[0].args[3].enableScripts, false);
    assert.match(panels[0].webview.html, /&lt;script&gt;unsafe/);
    assert.match(panels[0].webview.html, language === 'ru' ? /Процедура изменена/ : /Procedure changed/);
  }
});
test('cancellation and stale projects never invoke diff', async () => {
  const calls = [];
  const api = load({ env: { language: 'en' }, workspace: { isTrusted: true }, window: { showQuickPick: async () => undefined } }, async (_, args) => { calls.push(args); return { schema_version: 1, commits: [commit(from), commit(to)] }; });
  await api.compareRevisions([{ root: '/repo', name: 'Project', executable: '/tools/eska-project', validate() {} }]);
  assert.equal(calls.length, 1);
  await assert.rejects(api.compareRevisions([{ root: '/repo', name: 'Project', executable: '/tools/eska-project', validate() { throw new Error('stale'); } }]), /stale/);
  assert.equal(calls.length, 1);
});
