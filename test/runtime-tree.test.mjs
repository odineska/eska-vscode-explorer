import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtimeGroup, runtimeCommands, runtimeLabel } from '../out/runtime-tree.js';

test('runtime actions retain their project, stable IDs and bilingual labels', () => {
  const first = { key: 'first' }, second = { key: 'second' };
  const group = runtimeGroup(first), commands = runtimeCommands(group);
  assert.equal(runtimeLabel(group, 'ru-RU'), 'Запуск и отладка');
  assert.equal(runtimeLabel(group, 'en-US'), 'Run and Debug');
  assert.deepEqual(commands.map(item => item.command.split('.').at(-1)),
    ['runTest', 'debugLaunch', 'debugAttach', 'applyTest', 'applyAndRunTest', 'applyAndDebugTest']);
  assert.equal(new Set(commands.map(item => item.key)).size, 6);
  for (const command of commands) {
    assert.equal(command.project, first);
    assert.equal(command.parent, group);
    assert.notEqual(runtimeLabel(command, 'ru-RU'), runtimeLabel(command, 'en-US'));
  }
  assert.notEqual(runtimeCommands(runtimeGroup(second))[0].key, commands[0].key);
  assert.equal(runtimeCommands(runtimeGroup(first))[0].key, commands[0].key);
});

test('settings context contributes only opening settings, while runtime commands remain registered', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const settings = manifest.contributes.menus['view/item/context'].filter(item => item.when.includes('eskaProjectSettings'));
  assert.deepEqual(settings.map(item => item.command), ['eska.explorer.configureProject']);
  const registered = new Set(manifest.contributes.commands.map(item => item.command));
  for (const command of runtimeCommands(runtimeGroup({ key: 'project' }))) assert.ok(registered.has(command.command));
});
