import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runtimeActions } from '../out/runtime-tree.js';

test('settings context contributes only opening settings, while runtime commands remain registered', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const settings = manifest.contributes.menus['view/item/context'].filter(item => item.when.includes('eskaProjectSettings'));
  assert.deepEqual(settings.map(item => item.command), ['eska.explorer.configureProject']);
  const registered = new Set(manifest.contributes.commands.map(item => item.command));
  for (const command of runtimeActions()) assert.ok(registered.has(command.command));
});
