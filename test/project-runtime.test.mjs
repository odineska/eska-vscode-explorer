import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

/** Only VS Code registration and executable discovery are stubbed; configurations use the real provider. */
function fixture(t, choose, runtimeJson) {
  let provider, factory;
  const disposable = { dispose() {} };
  const vscode = {
    env: { language: 'ru' }, Uri: { file: fsPath => ({ fsPath }) },
    workspace: { isTrusted: true, textDocuments: [], getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    debug: {
      onDidStartDebugSession: () => disposable,
      registerDebugConfigurationProvider(_type, value) { provider = value; return disposable; },
      registerDebugAdapterDescriptorFactory(_type, value) { factory = value; return disposable; },
    },
    commands: { registerCommand: () => disposable },
    window: { showErrorMessage() { assert.fail('unexpected error'); } },
    DebugAdapterExecutable: class { constructor(command, args, options) { Object.assign(this, { command, args, options }); } },
  };
  const module = { exports: {} }, require = createRequire(new URL('../out/project-runtime.js', import.meta.url));
  runInNewContext('(function(require,module,exports){' + readFileSync(new URL('../out/project-runtime.js', import.meta.url), 'utf8') + '\n})',
    { setTimeout: () => ({ unref() {} }) })(name =>
      name === 'vscode' ? vscode : name === './tooling/inspect.js' ? { findTool: async () => '/tools/eska-debug' }
        : name === './runtime-tools.js' && runtimeJson ? { runtimeJson } : require(name), module, module.exports);
  const runtime = new module.exports.ProjectRuntime(choose);
  t.after(() => runtime.dispose());
  return { provider, factory, vscode };
}

test('F5 resolves in its workspace folder and restart keeps the chosen project', async t => {
  const choices = [];
  const f = fixture(t, async (root, folder) => {
    choices.push({ root, folder });
    return { root: root ?? '/workspace/second/project', executable: '/tools/eska-project' };
  });
  const config = await f.provider.resolveDebugConfiguration({ uri: { fsPath: '/workspace/second' } },
    { request: 'launch', profile: 'test' });
  assert.deepEqual(choices[0], { root: undefined, folder: '/workspace/second' });
  assert.equal(config.projectDir, '/workspace/second/project');
  const descriptor = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.equal(descriptor.options.cwd, config.projectDir);
  assert.equal(descriptor.args[descriptor.args.indexOf('--project-dir') + 1], config.projectDir);
  assert.equal(choices.length, 1);
  const restarted = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.deepEqual(choices[1], { root: config.projectDir, folder: undefined });
  assert.equal(restarted.options.cwd, descriptor.options.cwd);
  assert.deepEqual(restarted.args, descriptor.args);
  f.vscode.workspace.isTrusted = false;
  assert.equal(await f.factory.createDebugAdapterDescriptor({ configuration: config }), undefined);
  assert.equal(choices.length, 2);
});

test('a folder without a project does not launch another visible project', async t => {
  const calls = [];
  const f = fixture(t, async (_root, folder) => { calls.push(folder); return undefined; });
  assert.equal(await f.provider.resolveDebugConfiguration({ uri: { fsPath: '/workspace/no-project' } }, { request: 'launch' }), undefined);
  assert.deepEqual(calls, ['/workspace/no-project']);
  f.vscode.workspace.isTrusted = false;
  assert.equal(await f.provider.resolveDebugConfiguration(undefined, { request: 'launch' }), undefined);
  assert.equal(calls.length, 1);
});

test('a prod restart repeats the source check and requires a new decision', async t => {
  const checks = [];
  const f = fixture(t, async root => ({ root, executable: '/tools/eska-project' }),
    async (_binary, args) => {
      checks.push(Array.from(args));
      return { check: { status: 'unverified' } };
    });
  let warnings = 0;
  f.vscode.window.showWarningMessage = async (_warning, _options, action) => ++warnings === 1 ? action : undefined;
  const config = await f.provider.resolveDebugConfiguration(undefined,
    { projectDir: '/workspace/project', request: 'launch', profile: 'prod' });
  const descriptor = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.equal(descriptor.args[descriptor.args.indexOf('--sources') + 1], 'current');
  assert.equal(warnings, 1);
  assert.equal(await f.factory.createDebugAdapterDescriptor({ configuration: config }), undefined);
  assert.equal(warnings, 2);
  assert.deepEqual(checks.map(args => args.slice(-1)), [['check'], ['check']]);
});
