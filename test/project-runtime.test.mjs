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
    ProgressLocation: { Notification: 15 },
    env: { language: 'ru' }, Uri: { file: fsPath => ({ fsPath }) },
    workspace: { isTrusted: true, textDocuments: [], getWorkspaceFolder: () => undefined, getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
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
    { AbortController, setTimeout: () => ({ unref() {} }) })(name =>
      name === 'vscode' ? vscode : name === './tooling/inspect.js' ? { findTool: async () => '/tools/eska-debug' }
        : name === './runtime-tools.js' && runtimeJson ? { runtimeJson } : require(name), module, module.exports);
  const runtime = new module.exports.ProjectRuntime(choose);
  t.after(() => runtime.dispose());
  return { provider, factory, vscode, runtime };
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

test('apply and launch uses the Rust-selected test project and requires successful apply', async t => {
  const selected = { root: '/workspace/extension', executable: '/tools/eska-project' };
  const main = { ...selected, root: '/workspace/main' };
  const fingerprint = 'a'.repeat(64);
  const launch = { project_dir: main.root, fingerprint };
  const plan = { launch, mode: 'incremental', confirmation: 'reviewed', changes: { 'Module.bsl': 'modified' } };
  const requests = [];
  const starts = [];
  let confirmation = true, failed = false, cancelled = false, unchanged = false;
  const f = fixture(t, async root => root === main.root ? main : undefined, async (_binary, args) => {
    requests.push(Array.from(args));
    if (args.includes('run')) return { status: 'finished' };
    if (args.includes('--confirm')) return failed
      ? { status: 'error', error: { code: 'apply_failed' } }
      : { status: 'applied', plan };
    return { status: 'preview', plan: unchanged ? { ...plan, mode: 'unchanged' } : plan };
  });
  const errors = [];
  f.vscode.window.showErrorMessage = async error => { errors.push(error); };
  f.vscode.window.showWarningMessage = async (_title, _options, action) => confirmation ? action : undefined;
  f.vscode.window.withProgress = async (_options, run) => run({ report() {} }, {
    isCancellationRequested: cancelled, onCancellationRequested: () => ({ dispose() {} }),
  });
  f.vscode.debug.startDebugging = async (_folder, config) => { starts.push(config); return true; };

  confirmation = false;
  await f.runtime.apply(selected, 'debug');
  assert.equal(starts.length, 0);
  assert.equal(requests.length, 1);
  confirmation = true;
  cancelled = true;
  await f.runtime.apply(selected, 'debug');
  assert.equal(starts.length, 0);
  assert.equal(requests.length, 2);
  cancelled = false;
  failed = true;
  await f.runtime.apply(selected, 'debug');
  assert.equal(starts.length, 0);
  assert.equal(errors.length, 1);

  failed = false;
  await f.runtime.apply(selected, 'debug');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].projectDir, main.root);
  assert.equal(starts[0].profile, 'test');
  assert.equal(starts[0].expectedInfobase, fingerprint);
  const config = await f.provider.resolveDebugConfiguration(undefined, starts[0]);
  const descriptor = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.deepEqual(Array.from(descriptor.args.slice(-2)), ['--expected-infobase', fingerprint]);
  const restarted = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.deepEqual(Array.from(restarted.args), Array.from(descriptor.args));

  unchanged = true;
  await f.runtime.apply(selected, 'run');
  assert.deepEqual(requests.at(-1).slice(2), [
    '--project-dir', main.root, 'run', '--format', 'json', '--expected-infobase', fingerprint,
  ]);
  assert.ok(!requests.at(-2).includes('--confirm'));
});
