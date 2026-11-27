import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolbarFromManifest, GIT_EXTENSION, GIGACODE_EXTENSION, GIGACODE_GENERATE } from '../out/scm-toolbar.js';

const fallback = () => undefined;
function manifest() {
  return { contributes: {
    commands: [
      { command: 'git.commit', title: 'Commit', enablement: '!operationInProgress' },
      { command: 'git.fetch', title: 'Fetch', enablement: 'ready && enabled || ready && override' },
      { command: 'git.push', title: 'Push' },
    ],
    submenus: [{ id: 'git.remote', label: 'Remote' }, { id: 'git.empty', label: 'Empty' }],
    menus: {
      'scm/title': [
        { command: 'git.commit', group: 'navigation', when: 'scmProvider == git' },
        { command: 'git.commit', group: 'navigation', when: 'scmProvider == git' },
        { submenu: 'git.remote', group: '1' },
        { submenu: 'git.empty', group: '2' },
      ],
      'git.remote': [{ command: 'git.fetch' }, { command: 'git.fetch' }],
      'git.empty': [{ command: 'git.push', when: 'missing' }, { submenu: 'git.empty' }],
    },
  } };
}
const context = overrides => key => ({ scmProvider: 'git', operationInProgress: false,
  ready: true, enabled: true, override: false, ...overrides })[key];

test('nested menus remove unsupported and empty branches and deduplicate commands', () => {
  const source = manifest();
  const toolbar = toolbarFromManifest(source, GIT_EXTENSION, context(), fallback);
  assert.deepEqual(toolbar.inline.map(item => item.id), ['git.commit']);
  assert.deepEqual(toolbar.overflow, [{ title: 'Remote', items: [
    { id: 'git.fetch', title: 'Fetch', extension: GIT_EXTENSION },
  ] }]);
  const filtered = toolbarFromManifest(source, GIT_EXTENSION, context(), fallback, id => id !== 'git.fetch');
  assert.deepEqual(filtered.overflow, []);
  assert.equal(filtered.inline.length, 1);
});

test('cached declarations re-evaluate context and support every time', () => {
  const source = manifest();
  assert.equal(toolbarFromManifest(source, GIT_EXTENSION, context(), fallback).overflow.length, 1);
  assert.equal(toolbarFromManifest(source, GIT_EXTENSION, context({ enabled: false }), fallback).overflow.length, 0);
  assert.equal(toolbarFromManifest(source, GIT_EXTENSION, context({ enabled: false, override: true }), fallback).overflow.length, 1);
  assert.equal(toolbarFromManifest(source, GIT_EXTENSION, context({ operationInProgress: true }), fallback).inline.length, 0);
  assert.equal(toolbarFromManifest(source, GIT_EXTENSION, context(), fallback, () => false).inline.length, 0);
});

test('unknown syntax and negated unknown keys fail closed', () => {
  const source = manifest();
  for (const when of ['!missing', 'unknown == false', 'ready =~ /x/', '(ready', 'ready &&']) {
    source.contributes.menus['scm/title'] = [{ command: 'git.commit', group: 'navigation', when }];
    // VS Code replaces the manifest on extension changes.
    const copy = structuredClone(source);
    assert.equal(toolbarFromManifest(copy, GIT_EXTENSION, context(), fallback).inline.length, 0, when);
  }
});

test('GigaCode input and title contributions create one generation button', () => {
  const command = { command: GIGACODE_GENERATE, group: 'navigation', when: 'scmProvider == git' };
  const source = { contributes: {
    commands: [{ command: GIGACODE_GENERATE, title: '%unresolved%' }],
    menus: { 'scm/title': [command], 'scm/input': [command] },
  } };
  const toolbar = toolbarFromManifest(source, GIGACODE_EXTENSION, context(), () => 'Generate');
  assert.deepEqual(toolbar.inline, [{ id: GIGACODE_GENERATE, title: 'Generate', extension: GIGACODE_EXTENSION }]);
  assert.deepEqual(toolbar.overflow, []);
});


test('an unavailable OR branch leaves a known true alternative available in either order', () => {
  for (const when of ['unknown || enabled', 'enabled || unknown', '!unknown || enabled', 'enabled || !unknown']) {
    const source = manifest();
    source.contributes.menus['scm/title'] = [{ command: 'git.commit', group: 'navigation', when }];
    assert.equal(toolbarFromManifest(source, GIT_EXTENSION, context(), fallback).inline.length, 1, when);
  }
});

test('a command and submenu with the same identifier both survive deduplication', () => {
  const source = manifest();
  source.contributes.submenus.push({ id: 'git.commit', label: 'Commit actions' });
  source.contributes.menus['scm/title'] = [{ command: 'git.commit' }, { submenu: 'git.commit' }];
  source.contributes.menus['git.commit'] = [{ command: 'git.push' }];
  const toolbar = toolbarFromManifest(source, GIT_EXTENSION, context(), fallback);
  assert.equal(toolbar.overflow.length, 2);
  assert.equal(toolbar.overflow[0].id, 'git.commit');
  assert.equal(toolbar.overflow[1].title, 'Commit actions');
  assert.equal(toolbar.overflow[1].items[0].id, 'git.push');
});
