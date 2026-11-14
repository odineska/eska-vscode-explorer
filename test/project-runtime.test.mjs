import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

/** Only VS Code registration and executable discovery are stubbed; configurations use the real provider. */
function fixture(t, choose, runtimeJson) {
  let provider, factory, started, terminated;
  const disposable = { dispose() {} };
  const vscode = {
    ProgressLocation: { Notification: 15 },
    env: { language: 'ru' }, Uri: { file: fsPath => ({ fsPath }) },
    workspace: { isTrusted: true, textDocuments: [], getWorkspaceFolder: () => undefined, getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    debug: {
      onDidStartDebugSession: callback => { started = callback; return disposable; },
      onDidTerminateDebugSession: callback => { terminated = callback; return disposable; },
      registerDebugConfigurationProvider(_type, value) { provider = value; return disposable; },
      registerDebugAdapterDescriptorFactory(_type, value) { factory = value; return disposable; },
    },
    commands: { registerCommand: () => disposable },
    window: { showErrorMessage() { assert.fail('unexpected error'); },
      withProgress: async (_options, run) => run({ report() {} }, {
        isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }),
      }),
    },
    DebugAdapterExecutable: class { constructor(command, args, options) { Object.assign(this, { command, args, options }); } },
  };
  const module = { exports: {} }, require = createRequire(new URL('../out/project-runtime.js', import.meta.url));
  runInNewContext('(function(require,module,exports){' + readFileSync(new URL('../out/project-runtime.js', import.meta.url), 'utf8') + '\n})',
    { AbortController, setTimeout: () => ({ unref() {} }) })(name =>
      name === 'vscode' ? vscode : name === './apply-review.js' ? { ApplyReview: class { async show(title, detail, accept) { return await vscode.window.showWarningMessage(title, { detail }, accept) === accept; } dispose() {} } } : name === './tooling/inspect.js' ? { findTool: async () => '/tools/eska-debug' }
        : name === './runtime-tools.js' && runtimeJson ? { runtimeJson } : require(name), module, module.exports);
  const runtime = new module.exports.ProjectRuntime(choose);
  t.after(() => runtime.dispose());
  return { provider, factory, vscode, runtime, started, terminated };
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
  f.vscode.window.withProgress = async (options, run) => run({ report() {} }, {
    isCancellationRequested: cancelled && options.title === 'Обновление тестовой базы', onCancellationRequested: () => ({ dispose() {} }),
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

test('an application failure shows each outcome and a reviewed recovery launches its own source context', async t => {
  const workspace = { root: '/workspace', executable: '/tools/eska-project' };
  const base = { ...workspace, root: '/workspace/main' };
  const launch = { project_dir: base.root, fingerprint: 'b'.repeat(64) };
  const component = (member, mode) => ({
    member, project_dir: `/workspace/${member}`,
    plan: { mode, changes: { 'Module.bsl': 'modified' } },
  });
  const review = { member: 'second', project_dir: '/workspace/second', review: { reason: 'incomplete' } };
  const requests = [], dialogs = [], starts = [];
  let recover = false;
  const f = fixture(t, async root => root === base.root ? base : undefined, async (_binary, args) => {
    requests.push(Array.from(args));
    if (args.includes('context')) return { status: 'error', error: { code: 'ambiguous_application', data: { available: ['demo', 'other'] } } };
    if (args.includes('--confirm')) {
      return {
        kind: 'application_apply', status: recover ? 'applied' : 'error', launch, error: { code: 'apply_failed' },
        outcomes: [
          { member: 'main', status: recover ? 'unchanged' : 'applied' },
          { member: 'second', status: recover ? 'applied' : 'failed' },
          { member: 'third', status: recover ? 'applied' : 'not_started' },
        ],
      };
    }
    const full = args.includes('--initialize');
    const components = [
      component('main', recover ? 'unchanged' : 'incremental'),
      recover && !full ? review : component('second', full ? 'initialize' : 'incremental'),
      component('third', 'incremental'),
    ];
    return { kind: 'application_apply', status: 'preview', plan: {
      application: 'demo', launch, components, confirmation: recover && !full ? null : 'reviewed',
    } };
  });
  f.vscode.window.showQuickPick = async choices => choices[0];
  f.vscode.window.showWarningMessage = async (title, options, action) => {
    dialogs.push([title, options.detail]);
    return action;
  };
  f.vscode.window.withProgress = async (_options, run) => run({ report() {} }, {
    isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }),
  });
  f.vscode.debug.startDebugging = async (_folder, config) => { starts.push(config); return true; };

  await f.runtime.applyApplication(workspace, 'debug');
  assert.equal(starts.length, 0);
  assert.match(dialogs.at(-1)[1], /main — Применено\nsecond — Ошибка обновления\nthird — Не начато/u);
  recover = true;
  await f.runtime.applyApplication(workspace, 'debug');
  assert.match(dialogs.at(-1)[1], /main — Без изменений[\s\S]*second — Полный импорт[\s\S]*third — Частичный импорт/u);
  assert.ok(requests.at(-1).includes('--initialize'));
  assert.equal(starts.length, 1);
  const config = await f.provider.resolveDebugConfiguration(undefined, starts[0]);
  const descriptor = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.deepEqual(Array.from(descriptor.args.slice(-4)), ['--expected-infobase', launch.fingerprint, '--application', 'demo']);
  const restarted = await f.factory.createDebugAdapterDescriptor({ configuration: config });
  assert.deepEqual(Array.from(restarted.args), Array.from(descriptor.args));
});

/** Updates must account for every ESKA session, including one that is not currently focused. */
test('debugger ownership tracks concurrent sessions without claiming foreign adapters', t => {
  const f = fixture(t, async () => undefined);
  f.started({ id: 'foreign', type: 'other', configuration: {} });
  assert.equal(f.runtime.debugging, false);
  for (const id of ['first', 'second']) f.started({ id, type: 'eska-debug', configuration: { request: 'launch' } });
  f.terminated({ id: 'first' }); assert.equal(f.runtime.debugging, true);
  f.terminated({ id: 'foreign' }); assert.equal(f.runtime.debugging, true);
  f.terminated({ id: 'second' }); assert.equal(f.runtime.debugging, false);
});

test('initial database comparison has cancellable progress and no short timeout', async t => {
  const project = { root: '/workspace/project', executable: '/tools/eska-project' };
  let cancel, cancelled = false, notices = 0, calls = 0, disposed = 0;
  const f = fixture(t, async () => project, async (_binary, args, options) => {
    calls++;
    assert.equal(options.timeout, 0);
    assert.ok(!args.includes('--confirm'));
    assert.equal(options.signal.aborted, false);
    if (cancelled) cancel();
    assert.equal(options.signal.aborted, cancelled);
    return { status: 'preview', plan: { mode: 'unchanged' } };
  });
  f.vscode.window.withProgress = async (options, run) => {
    assert.equal(options.title, 'Сравнение исходников с тестовой базой');
    assert.equal(options.cancellable, true);
    return run({ report() {} }, { isCancellationRequested: false,
      onCancellationRequested(callback) { cancel = callback; return { dispose() { disposed++; } }; },
    });
  };
  f.vscode.window.showInformationMessage = () => { notices++; };
  f.vscode.window.showWarningMessage = () => assert.fail('unchanged sources must not prompt for import');
  await f.runtime.apply(project);
  assert.equal(notices, 1);
  cancelled = true;
  await f.runtime.apply(project);
  assert.equal(notices, 1);
  assert.equal(calls, 2);
  assert.equal(disposed, 2);
});

test('large apply reviews keep all translated objects and refuse edits made while reviewing', async t => {
  const project = { root: '/workspace/project', executable: '/tools/eska-project' };
  const changes = {}, display = {};
  for (let index = 0; index < 500; index++) {
    const path = `Catalogs/Товар${index}/Ext/ManagerModule.bsl`;
    changes[path] = 'modified';
    display[path] = { 'ru-RU': { label: `Справочник.Товар${index}.МодульМенеджера`, group: 'Справочник' },
      'en-US': { label: `Catalog.Товар${index}.ManagerModule`, group: 'Catalog' } };
  }
  const requests = [], errors = [];
  const f = fixture(t, async () => project, async (_binary, args) => {
    requests.push(Array.from(args));
    return { status: 'preview', plan: { mode: 'incremental', confirmation: 'token', changes }, display };
  });
  f.vscode.window.showErrorMessage = value => errors.push(value);
  for (const locale of ['ru', 'en']) {
    f.vscode.env.language = locale;
    f.vscode.workspace.textDocuments = [];
    f.vscode.window.showWarningMessage = async (_title, { detail }, accept) => {
      assert.ok(detail.includes(locale === 'ru' ? 'Справочник.Товар499.МодульМенеджера' : 'Catalog.Товар499.ManagerModule'));
      assert.ok(!detail.includes('Catalogs/'));
      f.vscode.workspace.textDocuments = [{ isDirty: true, uri: { scheme: 'file', fsPath: '/workspace/project/src/Module.bsl' } }];
      return accept;
    };
    await f.runtime.apply(project);
  }
  assert.equal(requests.length, 2);
  assert.equal(requests.some(args => args.includes('--confirm')), false);
  assert.equal(errors.length, 2);
  const detail = f.runtime.applicationDetail([{ member: 'base', plan: { changes, mode: 'incremental' } },
    { member: 'extension', plan: { changes, mode: 'incremental' } }], { base: display, extension: display });
  assert.equal(detail.split('Catalog.Товар499.ManagerModule').length - 1, 2);
  assert.ok(f.runtime.pictureReferenceLines(['Catalogs/Товар499/Ext/ManagerModule.bsl'], display)[0].includes('Catalog.Товар499.ManagerModule'));
});

test('a very large application review does not exhaust the JavaScript argument stack', t => {
  const f = fixture(t, async () => undefined);
  const changes = Object.fromEntries(Array.from({ length: 140000 }, (_, index) => [`file-${index}`, 'modified']));
  const detail = f.runtime.applicationDetail([{ member: 'base', plan: { changes, mode: 'incremental' } }]);
  assert.ok(detail.includes('file-139999'));
  assert.equal(detail.split('\n').length, 140001);
});
