const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

const dom = (ui, operation, ...args) => ui.evaluate('(' + operation.toString() + ')(...' + JSON.stringify(args) + ')');
const dock = '[data-edit-action=dockPreview]';
function geometry() {
  const surface = document.querySelector('.form-preview-surface'), viewport = surface.querySelector('.preview-scroll');
  const control = surface.querySelector('.form-preview-window');
  const rect = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
  return { surface: rect(surface), viewport: rect(viewport), button: rect(control),
    clientWidth: viewport.clientWidth, opacity: Number(getComputedStyle(control).opacity),
    label: control.getAttribute('aria-label'), title: control.title, action: control.dataset.editAction,
    focused: document.activeElement === control, outline: getComputedStyle(control).outlineStyle, color: getComputedStyle(control).color, background: getComputedStyle(control).backgroundColor,
    zoom: document.querySelector('.form-zoom select').value, scrollWidth: viewport.scrollWidth, scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight,
    coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches };
}
function assertGeometry(value) {
  assert.ok(Math.abs(value.button.y + value.button.height / 2 - value.surface.y - value.surface.height / 2) < 1, 'centered in preview viewport');
  assert.ok(value.button.x > value.surface.x + value.surface.width / 2, 'on the right side');
  assert.ok(value.button.right <= value.viewport.x + value.clientWidth - 10, 'leaves the actual scrollbar and pointer gap accessible');
  assert.ok(value.button.width >= 40 && value.button.height >= 40, 'larger click target');
}
function returnControl() {
  const toolbar = document.querySelector('.form-preview-toolbar'), control = toolbar.querySelector('[data-edit-action=dockPreview]');
  const box = control?.getBoundingClientRect(), area = toolbar.getBoundingClientRect();
  return { focused: document.hasFocus(), visibility: document.visibilityState, active: document.activeElement?.tagName, overlay: !!document.querySelector('.form-preview-window'), label: control?.getAttribute('aria-label'),
    title: control?.title, visible: !!box?.width && box.right <= area.right && box.left >= area.left,
    afterZoom: !!control && !!(toolbar.querySelector('.form-zoom').compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING) };
}
async function zoom(ui, value) {
  await dom(ui, value => { const select = document.querySelector('.form-zoom select'); select.value = String(value); select.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function resize(ui, target, bounds) {
  await ui.resizeWindow(target, bounds);
  await until(async () => { const current = (await ui.windowBounds(target)).bounds; return current.width === bounds.width && current.height === bounds.height; }, 'native window resized');
}
const nativeChrome = `(() => {
  const visible = selector => [...document.querySelectorAll(selector)].filter(node => node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden');
  return { title: document.title, focused: document.hasFocus(), tabs: visible('.tabs-container .tab').map(node => node.textContent),
    statusBars: visible('.part.statusbar').length, titlebars: visible('.part.titlebar').length,
    editorGroups: visible('.part.editor').length };
})()`;

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), original = await fs.readFile(fixture.form.path), results = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => [...service.views.values()][0]?.phase === 'ready', 'form preview ready');
  const view = [...service.views.values()][0], main = view.frames.get('main'), session = view.client.current.formSessionId;
  const ui = await frame({ state: { title: main.panel.title } });
  let floating;
  try {
    const mainTarget = await ui.nativeWindow();
    await ui.focusWorkbench();
    await until(() => ui.workbench('document.hasFocus()'), 'native main window focused before user interaction');
    await until(() => dom(ui, () => !!document.querySelector('.form-preview-window')), 'window action rendered');
    const label = vscode.env.language.startsWith('ru') ? 'Открепить предпросмотр' : 'Detach preview';
    await ui.parkPointer();
    await dom(ui, () => document.activeElement.blur());
    await until(() => dom(ui, geometry).then(value => value.opacity === 0), 'action hidden without hover or focus');
    const hidden = await dom(ui, geometry); assertGeometry(hidden);
    assert.equal(hidden.label, label); assert.equal(hidden.title, label); assert.equal(hidden.action, 'detachPreview');
    assert.equal(await dom(ui, () => document.querySelector('.form-preview-toolbar').contains(document.querySelector('.form-preview-window'))), false);
    await ui.pointer('.form-preview-surface');
    await until(() => dom(ui, geometry).then(value => value.opacity === 1), 'real pointer reveals action');
    await ui.screenshot('preview-window-hover-' + vscode.env.language + '.png');
    const hover = await dom(ui, geometry);
    assert.notEqual(hover.background, 'rgba(0, 0, 0, 0)', 'theme overlay stays opaque over the form');
    results.push({ stage: 'hover', ...hover });
    await ui.pointer('.form-preview-toolbar');
    await until(() => dom(ui, geometry).then(value => value.opacity === 0), 'pointer leaving hides action');

    // Start immediately before the action in DOM tab order, then use a real Tab.
    await dom(ui, () => {
      const control = document.querySelector('.form-preview-window');
      const focusable = [...document.querySelectorAll('button, input, select, [tabindex="0"]')]
        .filter(node => !node.disabled && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      focusable[focusable.indexOf(control) - 1].focus();
    });
    await ui.key('Tab', 'Tab', 9);
    await until(() => dom(ui, geometry).then(value => value.focused && value.opacity === 1), 'Tab reveals and focuses action');
    assert.notEqual((await dom(ui, geometry)).outline, 'none');
    results.push({ stage: 'keyboard', ...await dom(ui, geometry) });

    await dom(ui, () => document.activeElement.blur());
    await ui.touch(true);
    await until(() => dom(ui, geometry).then(value => value.coarse && value.opacity === 1), 'touch pointer keeps action visible');
    assert.equal((await dom(ui, geometry)).button.width, 44);
    results.push({ stage: 'touch', ...await dom(ui, geometry) });
    await ui.touch(false);
    const originalMainBounds = await ui.windowBounds(mainTarget.targetId);
    await zoom(ui, 200);
    await resize(ui, mainTarget.targetId, { width: 800, height: 480 });
    await until(() => dom(ui, geometry).then(value => value.scrollHeight > value.clientHeight), 'zoomed form exposes a real vertical scrollbar');
    await until(() => dom(ui, geometry).then(value => value.button.right <= value.viewport.x + value.clientWidth - 10), 'scrollbar gutter measured after native resize');
    assertGeometry(await dom(ui, geometry));
    await ui.pointer('.form-preview-surface');
    await until(() => dom(ui, geometry).then(value => value.opacity === 1), 'zoomed action visible on hover');
    results.push({ stage: 'attached-scrollbars', ...await dom(ui, geometry) });
    await resize(ui, mainTarget.targetId, originalMainBounds.bounds);
    await zoom(ui, 100);
    await ui.focusWorkbench();
    await until(() => ui.workbench('document.hasFocus()'), 'native main window focused for keyboard detach');
    await dom(ui, () => document.querySelector('.form-preview-window').focus());
    await ui.key('Enter', 'Enter', 13);
    await until(() => view.frames.get('preview')?.ready, 'Enter detaches preview');
    const preview = view.frames.get('preview');
    floating = await frame({ detached: true, state: { title: preview.panel.title } });
    const target = await floating.nativeWindow({ detached: true });
    assert.notEqual(target.targetId, mainTarget.targetId);
    let chrome;
    try {
      await until(async () => { chrome = await floating.workbench(nativeChrome, target.targetId); return chrome.editorGroups > 0 && chrome.statusBars === 0 && chrome.tabs.length === 0; }, 'native compact mode hides tabs and IDE status bar');
    } catch (error) { throw new Error(error.message + ' ' + JSON.stringify(chrome), { cause: error }); }
    assert.ok((await ui.workbench(nativeChrome)).statusBars > 0, 'main IDE window remains in its original mode');
    assert.equal(await dom(ui, () => !!document.querySelector('.preview-scroll')), false, 'main inspector reclaims preview space');
    results.push({ stage: 'native-compact', chrome });
    const dockLabel = vscode.env.language.startsWith('ru') ? 'Вернуть предпросмотр' : 'Return preview';
    await until(() => dom(floating, returnControl).then(value => value.visible && value.afterZoom), 'return control remains in the detached toolbar');
    const returned = await dom(floating, returnControl);
    assert.equal(returned.overlay, false, 'detached form has no hover overlay');
    assert.equal(returned.label, dockLabel); assert.equal(returned.title, dockLabel);
    const old = await floating.windowBounds(target.targetId);
    await resize(floating, target.targetId, { width: 640, height: 420 });
    await until(() => dom(floating, returnControl).then(value => value.visible), 'toolbar action remains accessible after native resize');
    await floating.captureTarget(target.targetId, 'preview-window-native-compact-' + vscode.env.language + '.png');
    results.push({ stage: 'native-resize', returnControl: await dom(floating, returnControl) });
    await resize(floating, target.targetId, old.bounds);

    // A developer can opt out of compact mode; revealing that same window must preserve it.
    await vscode.commands.executeCommand('workbench.action.disableCompactAuxiliaryWindow');
    await until(async () => (await floating.workbench(nativeChrome, target.targetId)).statusBars > 0, 'developer can disable compact mode');
    const bounds = await floating.windowBounds(target.targetId);
    main.panel.reveal(undefined, false);
    await service.receive(view, main, { type: 'revealPreview' });
    assert.equal((await floating.nativeWindow({ detached: true })).targetId, target.targetId);
    assert.ok((await floating.workbench(nativeChrome, target.targetId)).statusBars > 0, 'existing window keeps user-selected mode');
    assert.deepEqual(await floating.windowBounds(target.targetId), bounds, 'existing window keeps native size');
    await floating.pointer(dock, true);
    await until(() => !view.frames.has('preview'), 'pointer docks preview');
    assert.deepEqual(floating.scriptErrors(), []);
    floating.close(); floating = undefined;
    await until(() => dom(ui, () => !!document.querySelector('.preview-scroll')), 'attached preview restored');
    assert.equal(view.client.current.formSessionId, session, 'detaching and docking retain one form session');
    assert.equal(document.isDirty, false);
    assert.deepEqual(await fs.readFile(fixture.form.path), original, 'window controls never change XML');
    assert.deepEqual(ui.scriptErrors(), []);
  } catch (error) {
    console.error('Preview native tabs', JSON.stringify({ panel: view.frames.get('preview') && {active: view.frames.get('preview').panel.active, column: view.frames.get('preview').panel.viewColumn}, groups: vscode.window.tabGroups.all.map(group => ({active: group.isActive, column: group.viewColumn, tabs: group.tabs.map(tab => ({label: tab.label, active: tab.isActive, input: tab.input}))})), compactAvailable: (await vscode.commands.getCommands(true)).includes('workbench.action.enableCompactAuxiliaryWindow') }));
    try { console.error('Preview window observation', JSON.stringify(await (floating ? dom(floating, returnControl) : dom(ui, geometry)))); } catch {}
    throw error;
  } finally {
    if (floating) { view.frames.get('preview')?.panel.dispose(); floating.close(); }
    ui.close();
    main.panel.dispose();
    await Promise.all([...service.closing]);
    await explorer.shutdown();
  }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, locale: vscode.env.language,
    hoverAndKeyboard: true, touchVisible: true, nativeCompact: true, preservesUserWindowMode: true, sourceWrites: false, results }));
};
