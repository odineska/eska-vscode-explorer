import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture() {
  const callbacks = new Map(), timers = new Set(), calls = [];
  const event = name => callback => {
    if (!callbacks.has(name)) callbacks.set(name, new Set());
    callbacks.get(name).add(callback);
    return { dispose() { callbacks.get(name).delete(callback); } };
  };
  class TabInputWebview { constructor(viewType) { this.viewType = viewType; } }
  const main = { label: 'Form', input: new TabInputWebview('mainThreadWebview-eska.formViewer') };
  const preview = { label: 'Form — Preview', input: new TabInputWebview('mainThreadWebview-eska.formViewer') };
  const group = { viewColumn: 1, activeTab: main };
  const groups = { activeTabGroup: group, onDidChangeTabGroups: event('groups'), onDidChangeTabs: event('tabs') };
  let focus = () => {}, available = true;
  const panel = { title: preview.label, viewType: 'eska.formViewer', viewColumn: 2, active: true,
    onDidChangeViewState: event('panel'), onDidDispose: event('dispose'), reveal: (...args) => calls.push(['reveal', ...args]) };
  const vscode = { TabInputWebview, window: { tabGroups: groups }, commands: {
    getCommands: async () => available ? ['workbench.action.moveEditorToNewWindow'] : [],
    executeCommand: async name => { calls.push([name]); if (name === 'workbench.action.focusActiveEditorGroup') focus(); },
  } };
  const module = { exports: {} };
  runInNewContext(`(function(require,module,exports){${readFileSync(new URL('../out/form-preview/window.js', import.meta.url), 'utf8')}\n})`, {
    setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: id => timers.delete(id),
  })(name => { assert.equal(name, 'vscode'); return vscode; }, module, module.exports);
  const emit = name => { for (const callback of [...(callbacks.get(name) ?? [])]) callback(); };
  return { panel, group, preview, calls, timers, emit, move: () => module.exports.movePreviewToNewWindow(panel),
    listeners: () => [...callbacks.values()].reduce((n, values) => n + values.size, 0),
    activate() { group.viewColumn = 2; group.activeTab = preview; emit('groups'); emit('tabs'); emit('panel'); },
    set focus(value) { focus = value; }, set available(value) { available = value; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const moves = f => f.calls.filter(([name]) => name === 'workbench.action.moveEditorToNewWindow').length;

test('detaching waits for the actual preview tab even if the new panel already reports active', async () => {
  const f = fixture(), pending = f.move(); await tick();
  assert.equal(moves(f), 0); assert.equal(f.listeners(), 4);
  f.activate(); assert.equal(await pending, true);
  assert.deepEqual(f.calls.map(([name]) => name), ['reveal', 'workbench.action.focusActiveEditorGroup', 'workbench.action.moveEditorToNewWindow']);
  assert.equal(f.calls[0][1], undefined, 'reveal preserves the already chosen group');
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});

test('another group with an active webview cannot substitute for the preview', async () => {
  const f = fixture(), pending = f.move(); await tick();
  f.group.viewColumn = 2; f.emit('groups'); await tick(); assert.equal(moves(f), 0);
  f.group.activeTab = { label: f.preview.label, input: { viewType: 'eska.formViewer' } }; f.emit('tabs');
  await tick(); assert.equal(moves(f), 0);
  f.activate(); assert.equal(await pending, true);
});

test('a focus change during the native focus command never moves the main panel', async () => {
  const f = fixture(); f.activate(); f.focus = () => { f.group.viewColumn = 1; };
  assert.equal(await f.move(), false); assert.equal(moves(f), 0);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});

test('closing a panel while activation is pending cancels subscriptions and the move', async () => {
  const f = fixture(), pending = f.move(); await tick(); f.emit('dispose');
  assert.equal(await pending, false); assert.equal(moves(f), 0);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});

test('missing activation falls back after the bounded timeout without moving another tab', async () => {
  const f = fixture(), pending = f.move(); await tick();
  for (const timer of [...f.timers]) timer();
  assert.equal(await pending, false); assert.equal(moves(f), 0);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});

test('an unavailable native move command leaves the preview in its regular tab', async () => {
  const f = fixture(); f.available = false;
  assert.equal(await f.move(), false); assert.equal(f.calls.length, 0);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});
