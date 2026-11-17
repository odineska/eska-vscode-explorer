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
  let floating;
  const groups = { get all() { return floating ? [group, floating] : [group]; }, activeTabGroup: group, onDidChangeTabGroups: event('groups'), onDidChangeTabs: event('tabs') };
  let focus = () => {}, moved = () => {}, afterReveal = () => {}, available = true, compact = true, focused = true;
  main.group = group; preview.group = group;
  const panel = { webview: { onDidReceiveMessage: event('webview'), postMessage: async message => { calls.push(['focusRequest', message]); if (focused) queueMicrotask(() => emit('webview', { type: 'previewWindowFocused', token: message.token })); return true; } }, title: preview.label, viewType: 'eska.formViewer', viewColumn: 2, active: true,
    onDidChangeViewState: event('panel'), onDidDispose: event('dispose'), reveal: (...args) => { calls.push(['reveal', ...args]); if (floating) { groups.activeTabGroup = floating; panel.active = true; emit('groups'); emit('panel'); afterReveal(); } } };
  const vscode = { TabInputWebview, window: { tabGroups: groups }, commands: {
    getCommands: async () => available ? ['workbench.action.moveEditorToNewWindow', ...(compact ? ['workbench.action.enableCompactAuxiliaryWindow'] : [])] : [],
    executeCommand: async name => {
      calls.push([name]);
      if (name === 'workbench.action.focusActiveEditorGroup') focus();
      if (name === 'workbench.action.moveEditorToNewWindow') {
        floating = { viewColumn: 3, activeTab: preview };
        preview.group = floating; groups.activeTabGroup = floating; panel.viewColumn = 3;
        moved(); emit('groups'); emit('tabs'); emit('panel');
      }
    },
  } };
  const module = { exports: {} };
  runInNewContext(`(function(require,module,exports){${readFileSync(new URL('../out/form-preview/window.js', import.meta.url), 'utf8')}\n})`, {
    setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: id => timers.delete(id),
  })(name => { if (name === 'node:crypto') return { randomUUID: () => 'focus-nonce' }; assert.equal(name, 'vscode'); return vscode; }, module, module.exports);
  const emit = (name, value) => { for (const callback of [...(callbacks.get(name) ?? [])]) callback(value); };
  return { panel, group, preview, calls, timers, emit, move: () => module.exports.movePreviewToNewWindow(panel),
    listeners: () => [...callbacks.values()].reduce((n, values) => n + values.size, 0),
    activate() { group.viewColumn = 2; group.activeTab = preview; emit('groups'); emit('tabs'); emit('panel'); },
    set focus(value) { focus = value; }, set moved(value) { moved = value; }, set afterReveal(value) { afterReveal = value; }, set compact(value) { compact = value; },
    set available(value) { available = value; }, set focused(value) { focused = value; },
    staleActiveGroup() { groups.activeTabGroup = group; group.activeTab = main; },
    leavePreview() { groups.activeTabGroup = group; group.activeTab = main; panel.active = false; },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const moves = f => f.calls.filter(([name]) => name === 'workbench.action.moveEditorToNewWindow').length;

test('detaching waits for the actual preview tab even if the new panel already reports active', async () => {
  const f = fixture(), pending = f.move(); await tick();
  assert.equal(moves(f), 0); assert.equal(f.listeners(), 4);
  f.activate(); assert.equal(await pending, true);
  assert.deepEqual(f.calls.map(([name]) => name), ['reveal', 'workbench.action.focusActiveEditorGroup', 'workbench.action.moveEditorToNewWindow', 'reveal', 'focusRequest', 'workbench.action.enableCompactAuxiliaryWindow']);
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


test('an older host still detaches when compact window mode is unavailable', async () => {
  const f = fixture(); f.compact = false; f.activate();
  assert.equal(await f.move(), true);
  assert.equal(moves(f), 1);
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
});

test('changing focus after revealing the moved preview never changes the compact mode of another window', async () => {
  const f = fixture(); f.activate(); f.afterReveal = () => f.leavePreview();
  const pending = f.move(); await tick();
  for (const timer of [...f.timers]) timer();
  assert.equal(await pending, true, 'the preview itself was moved successfully');
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});


test('compact action registered during the first auxiliary-window creation is discovered after moving', async () => {
  const f = fixture(); f.compact = false; f.activate(); f.moved = () => { f.compact = true; };
  assert.equal(await f.move(), true);
  assert.equal(f.calls.filter(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow').length, 1);
});


test('native move returning focus to the main group reveals only the verified moved preview once', async () => {
  const f = fixture(); f.activate(); f.moved = () => f.leavePreview();
  assert.equal(await f.move(), true);
  assert.equal(f.calls.filter(([name]) => name === 'reveal').length, 2, 'one reveal before and one after the move');
  assert.equal(f.calls.filter(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow').length, 1);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});


test('focused moved panel can compact while the public active-group flag still names the original window', async () => {
  const f = fixture(); f.activate(); f.afterReveal = () => f.staleActiveGroup();
  assert.equal(await f.move(), true);
  assert.equal(f.calls.filter(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow').length, 1);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});


test('public panel focus alone cannot compact until its actual document acknowledges focus', async () => {
  const f = fixture(); f.activate(); f.focused = false;
  const pending = f.move(); await tick();
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
  f.emit('webview', { type: 'previewWindowFocused', token: 'old-request' }); await tick();
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
  f.emit('webview', { type: 'previewWindowFocused', token: 'focus-nonce' });
  assert.equal(await pending, true);
  assert.equal(f.calls.filter(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow').length, 1);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});

test('closing the panel during native focus acknowledgement disposes all listeners', async () => {
  const f = fixture(); f.activate(); f.focused = false;
  const pending = f.move(); await tick(); f.emit('dispose');
  assert.equal(await pending, true, 'the move already succeeded');
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});

test('recreated preview document gets the pending request again on ready', async () => {
  const f = fixture(); f.activate(); f.focused = false;
  const pending = f.move(); await tick();
  f.focused = true; f.emit('webview', { type: 'ready' });
  assert.equal(await pending, true);
  assert.equal(f.calls.filter(([name]) => name === 'focusRequest').length, 2);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});


test('missing native focus acknowledgement times out without altering any window mode', async () => {
  const f = fixture(); f.activate(); f.focused = false;
  const pending = f.move(); await tick();
  for (const timer of [...f.timers]) timer();
  assert.equal(await pending, true, 'the move succeeded even without compact mode');
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});


test('a focus change after the webview acknowledgement still cannot compact the other window', async () => {
  const f = fixture(); f.activate(); f.focused = false;
  const pending = f.move(); await tick();
  f.emit('webview', { type: 'previewWindowFocused', token: 'focus-nonce' }); f.leavePreview();
  assert.equal(await pending, true);
  assert.equal(f.calls.some(([name]) => name === 'workbench.action.enableCompactAuxiliaryWindow'), false);
  assert.equal(f.listeners(), 0); assert.equal(f.timers.size, 0);
});
