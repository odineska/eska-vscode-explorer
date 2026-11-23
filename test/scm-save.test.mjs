import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve, join } from 'node:path';

function setup({ language = 'ru', input, tools = ['facade'], exit = 0, diagnostic = '' } = {}) {
  const root = resolve('save scope'), calls = [], probes = [], prompts = [];
  const state = { dirty: [], trusted: true, validates: 0, git: new Set(), onProbe() {}, onPrompt() {} };
  const vscode = { env: { language }, workspace: { get isTrusted() { return state.trusted; } },
    window: { async showInputBox(options) { prompts.push(options); state.onPrompt(); return input; } } };
  const url = new URL('../out/scm-save.js', import.meta.url), require = createRequire(url), module = { exports: {} };
  const mocks = {
    vscode,
    './project-command.js': { dirtyProjectFiles: () => state.dirty,
      projectArgs: (root, ...args) => ['--lang', language.startsWith('ru') ? 'ru-RU' : 'en-US', '--project-dir', root, ...args] },
    './tooling/inspect.js': { async findTool(...args) { probes.push(args); state.onProbe(); return tools[probes.length - 1]; } },
    'node:fs/promises': { realpath: async path => path, async lstat(path) {
      if (!state.git.has(path)) throw Object.assign(new Error('missing .git'), { code: 'ENOENT' });
    } },
    'node:child_process': { spawn(...args) { calls.push(args); const child = new EventEmitter(); child.stderr = new EventEmitter(); child.stderr.setEncoding = () => child.stderr; queueMicrotask(() => { child.stderr.emit('data', diagnostic); child.emit('close', exit); }); return child; } },
  };
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', {})(
    name => mocks[name] ?? require(name), module, module.exports);
  const scope = { root, repositoryRoot: root, executable: join(root, 'bin', 'eska-project'), validate() { state.validates++; } };
  return { state, calls, probes, prompts, scope, save: value => module.exports.saveScmScope(scope, value) };
}

test('save uses the facade, explicit scope, locale and one safe message argument without a shell', async () => {
  for (const language of ['ru', 'en']) {
    const h = setup({ language }); h.scope.workspace = true;
    const input = '--amend $(touch secret)\nСообщение';
    assert.equal(await h.save(input), true);
    assert.equal(h.state.validates, 2);
    assert.equal(h.probes.length, 1);
    assert.deepEqual(h.probes[0], ['eska', 'eska', join(h.scope.root, 'bin')]);
    assert.deepEqual(Array.from(h.calls[0][1]), ['--lang', language === 'ru' ? 'ru-RU' : 'en-US', '--project-dir', h.scope.root,
      'save', '--workspace', `--message=${input}`]);
    assert.equal(h.calls[0][2].cwd, h.scope.root);
    assert.equal(h.calls[0][2].shell, false);
    assert.equal(h.calls[0][2].timeout, undefined);
  }
});

test('missing facade falls back to vcs, while failed facade is never retried', async () => {
  const fallback = setup({ tools: [undefined, 'vcs'] });
  await fallback.save('message');
  assert.equal(fallback.probes[1][0], 'eska-vcs'); assert.equal(fallback.calls[0][0], 'vcs');
  const failed = setup({ exit: 1 });
  await assert.rejects(failed.save('message'), /1/);
  assert.equal(failed.calls.length, 1); assert.equal(failed.probes.length, 1);
  const missing = setup({ tools: [] });
  await assert.rejects(missing.save('message'), /eska-vcs/); assert.equal(missing.calls.length, 0);
});

test('prompt validates whitespace and cancellation does not discover or run tools', async () => {
  const cancelled = setup(); assert.equal(await cancelled.save('  '), false);
  assert.equal(cancelled.probes.length, 0);
  assert.ok(cancelled.prompts[0].validateInput('  '));
  assert.equal(cancelled.prompts[0].validateInput('ok'), undefined);
  const entered = setup({ input: 'entered' }); await entered.save('');
  assert.equal(entered.calls[0][1].at(-1), '--message=entered');
});

test('preflight refuses dirty, untrusted and stale scopes, including after asynchronous input/discovery', async () => {
  for (const late of [false, true]) {
    for (const kind of ['dirty', 'trusted', 'stale']) {
      const h = setup();
      const change = () => {
        if (kind === 'dirty') h.state.dirty = [{}];
        if (kind === 'trusted') h.state.trusted = false;
        if (kind === 'stale') h.scope.validate = () => { throw new Error('stale'); };
      };
      if (late) h.state.onProbe = change; else change();
      await assert.rejects(h.save('message'));
      assert.equal(h.calls.length, 0);
    }
  }
});


test('CLI stderr is bounded and exposed separately from the log-safe error message', async () => {
  const diagnostic = 'x'.repeat(20_000) + ' hook refusal';
  const h = setup({ exit: 1, diagnostic });
  await assert.rejects(h.save('message'), error => {
    assert.equal(error.name, 'ScmSaveError');
    assert.equal(error.diagnostic, diagnostic.slice(-16_384));
    assert.ok(!error.message.includes('hook refusal'));
    return true;
  });
});

test('a worktree nested inside the selected repository cannot receive its commit', async () => {
  const h = setup();
  h.scope.root = join(h.scope.repositoryRoot, 'nested', 'project');
  h.state.git.add(join(h.scope.repositoryRoot, 'nested', '.git'));
  await assert.rejects(h.save('message'));
  assert.equal(h.calls.length, 0);
});
