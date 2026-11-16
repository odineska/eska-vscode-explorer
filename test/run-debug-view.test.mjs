import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { runtimeActions, runtimeCommands, runtimeGroup } from '../out/runtime-tree.js';

test('Run and Debug contributes a project-presence view and preserves independent activation', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const view = manifest.contributes.views.debug.find(item => item.id === 'eska.explorer.runDebug');
  assert.equal(view.when, 'eska.hasProject');
  assert.equal(view.visibility, 'visible');
  assert.ok(manifest.activationEvents.includes('workspaceContains:eska.toml'));
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
  assert.ok(!manifest.activationEvents.includes('workspaceContains:**/eska.toml'));
  assert.ok(!manifest.activationEvents.includes('*'));
  for (const event of ['onLanguage:bsl', 'onLanguage:sdbl', 'onFileSystem:eska-query', 'onFileSystem:eska-protected',
    'onView:eska.explorer.projects', 'onWebviewPanel:eska.formViewer']) assert.ok(manifest.activationEvents.includes(event));
  const english = JSON.parse(readFileSync(new URL('../package.nls.json', import.meta.url), 'utf8'));
  const russian = JSON.parse(readFileSync(new URL('../package.nls.ru.json', import.meta.url), 'utf8'));
  assert.equal(russian.runDebugView, 'ESKA: запуск 1С'); assert.equal(english.runDebugView, 'ESKA: Run 1C');
});

test('all six commands share their existing IDs, order, icons and localized labels without a backend', async () => {
  const callbacks = new Set();
  let disposed = false, reads = 0;
  const projects = { folders: [{}], settled: async () => { reads++; },
    onDidChange: callback => { callbacks.add(callback); return { dispose: () => { disposed = true; callbacks.delete(callback); } }; } };
  const vscode = {
    env: { language: 'ru' }, TreeItemCollapsibleState: { None: 0 },
    TreeItem: class { constructor(label, collapsibleState) { Object.assign(this, { label, collapsibleState }); } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    EventEmitter: class { event() {} fire() {} dispose() {} },
  };
  const module = { exports: {} }, require = createRequire(new URL('../out/run-debug-view.js', import.meta.url));
  runInNewContext('(function(require,module,exports){' + readFileSync(new URL('../out/run-debug-view.js', import.meta.url), 'utf8') + '\n})')(
    name => name === 'vscode' ? vscode : require(name), module, module.exports);
  const view = new module.exports.RunDebugView(projects);
  const commands = await view.getChildren();
  assert.deepEqual(commands, runtimeActions());
  const existing = runtimeCommands(runtimeGroup({ key: 'project' }));
  assert.deepEqual(commands, existing.map(({ command, title, icon }) => ({ command, title, icon })));
  assert.deepEqual(commands.map(item => item.command.split('.').at(-1)),
    ['runTest', 'debugLaunch', 'debugAttach', 'applyTest', 'applyAndRunTest', 'applyAndDebugTest']);
  const labels = commands.map(command => view.getTreeItem(command).label);
  assert.deepEqual(labels, ['Запустить тестовую базу', 'Запустить 1С с отладкой', 'Подключиться к серверу отладки 1С',
    'Обновить тестовую базу', 'Применить и запустить', 'Применить и запустить с отладкой']);
  for (const command of commands) {
    const item = view.getTreeItem(command);
    assert.equal(item.id, command.command); assert.equal(item.command.command, command.command);
    assert.equal(item.iconPath.id, command.icon); assert.equal(item.collapsibleState, 0);
  }
  vscode.env.language = 'en';
  assert.ok(commands.every((command, index) => view.getTreeItem(command).label !== labels[index]));
  projects.folders = []; assert.equal((await view.getChildren()).length, 0); assert.equal(reads, 2);
  view.dispose(); assert.equal(disposed, true);
});
