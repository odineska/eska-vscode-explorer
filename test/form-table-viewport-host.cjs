const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, allocateFormViewport, editFormSource } = require('./webview-host.cjs');

const readGeometry = `(() => {
  const root = document.querySelector('.taxi-form-frame');
  if (root?.closest('.taxi-preview')?.dataset.formLayout !== 'allocated') return null;
  const table = root.querySelector('[data-kind=Table]'), grid = table?.querySelector('.taxi-table-scroll');
  if (!grid) return null;
  const origin = root.getBoundingClientRect(), rect = grid.getBoundingClientRect();
  const content = grid.querySelector('.taxi-table-content');
  const columns = [...grid.querySelectorAll('[data-column]')];
  const shown = selector => !!table.querySelector(selector)?.getClientRects().length;
  const owners = globalThis.__tableViewportOwners;
  return {
    frame: [origin.width, origin.height], grid: [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height],
    preferredWidth: parseFloat(root.style.getPropertyValue('--taxi-form-preferred-width')),
    content: [content.clientWidth, content.scrollWidth], columnWidths: columns.map(e => e.getBoundingClientRect().width),
    scrollLeft: content.scrollLeft, selected: table.classList.contains('taxi-selected'),
    search: shown('.taxi-table-search'), more: shown('[data-table-more]'), movement: shown('.taxi-table-move'),
    stableOwners: !owners || owners.table === table && owners.grid === grid && owners.content === content
      && owners.columns.length === columns.length && columns.every((column, index) => column === owners.columns[index]),
  };
})()`;

async function geometry(ui) {
  let actual, previous, stable = 0;
  await until(async () => {
    actual = await ui.evaluate(readGeometry);
    const serialized = JSON.stringify(actual);
    stable = serialized === previous ? stable + 1 : 0;
    previous = serialized;
    return actual && stable >= 2;
  }, 'stable table viewport');
  return actual;
}

async function allocate(ui, native) {
  await until(() => ui.evaluate("!!document.querySelector('.taxi-table-scroll')"), 'table viewport mounted');
  await allocateFormViewport(ui, native.frame);
  const actual = await geometry(ui);
  if (process.platform === 'linux') {
    assert.deepEqual(actual.frame, native.frame, 'form frame');
    assert.deepEqual(actual.grid, native.grid, 'table grid');
  }
  return actual;
}

async function resizeAndEdit(service, view, main, ui, document, forms, results) {
  const workbench = await ui.nativeWindow();
  const identity = [...view.nodes.values()].find(node => node.name === 'Rows').identity;
  await service.receive(view, main, { type: 'select', identity });
  await ui.focusWorkbench();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'table viewport detached');
  const preview = view.frames.get('preview');
  const floating = await frame({ detached: true, state: { title: preview.panel.title } });
  const native = name => forms.find(form => form.kind === name).expected.native;
  const source = document.getText();
  try {
    assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
    const initial = await allocate(floating, native('Table30'));
    assert.ok(initial.selected, 'selection propagated to the floating preview');
    assert.ok(initial.content[1] > initial.content[0], 'columns overflow the viewport');
    await floating.evaluate(`(() => {
      const table = document.querySelector('[data-kind=Table]'), grid = table.querySelector('.taxi-table-scroll');
      const content = grid.querySelector('.taxi-table-content');
      globalThis.__tableViewportOwners = {table, grid, content, columns: [...grid.querySelectorAll('[data-column]')]};
      content.scrollLeft = 24;
    })()`);
    assert.equal((await geometry(floating)).scrollLeft, 24, 'column content scrolls independently');
    const wideFrame = native('Table65').frame;
    const wide = await allocate(floating, { frame: wideFrame, grid: initial.grid });
    assert.equal(wide.preferredWidth, initial.preferredWidth, 'resize keeps the authored size');
    assert.deepEqual(wide.content, initial.content, 'the fixed grid viewport stays the same in a wider window');
    const narrow = await allocate(floating, native('Table30'));
    assert.deepEqual(narrow.columnWidths, initial.columnWidths, 'resize restores column widths');
    const change = async (xml, name, label) => {
      await editFormSource(document, view, xml);
      await until(() => floating.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'floating table XML revision');
      const actual = await allocate(floating, native(name));
      assert.equal(actual.preferredWidth, native(name).frame[0], 'source width changes the preferred frame');
      assert.ok(actual.selected && actual.stableOwners, 'dirty layout preserves selection and DOM owners');
      results.push({ name: label, ...actual });
    };
    const edited = source.replace('<Width>30</Width>', '<Width>45</Width>');
    assert.notEqual(edited, source);
    await change(edited, 'Table45', 'floating-dirty-width');
    assert.equal(document.isDirty, true);
    await change(source, 'Table30', 'floating-restored-width');
    assert.ok(wide.stableOwners && narrow.stableOwners, 'resize preserves DOM owners');
    assert.deepEqual(floating.scriptErrors(), []);
  } finally {
    try {
      await editFormSource(document, view, source);
      await service.receive(view, preview, { type: 'dock' });
      await until(() => !view.frames.has('preview'), 'table viewport docked');
    } finally { floating.close(); }
  }
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const english = vscode.env.language.startsWith('en');
  const extension = vscode.extensions.all.find(entry => entry.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate(), service = explorer.formPreview;
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  for (const form of fixture.formGallery) {
    const disk = await fs.readFile(form.path);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const current = () => [...service.views.values()].find(view => sameSourcePath(view.path, form.path));
    await until(() => current()?.phase === 'ready', 'table viewport model');
    const view = current(), main = view.frames.get('main');
    const ui = await frame({ state: { title: main.panel.title } });
    try {
      const native = (english ? form.expected.nativeEn : undefined) ?? form.expected.native;
      const actual = await allocate(ui, native);
      results.push({ name: form.kind, ...actual });
      if (process.platform === 'linux') {
        assert.equal(actual.preferredWidth, native.frame[0], 'preferred frame width');
        if (['Table6', 'Fixed4NoStatus'].includes(form.kind)) {
          assert.ok(actual.search && !actual.more && !actual.movement, 'search occupies the narrow toolbar');
        } else if (form.kind === 'Table30') {
          assert.ok(actual.search && actual.more && !actual.movement, 'commands fold into the menu');
          await resizeAndEdit(service, view, main, ui, document, fixture.formGallery, results);
        } else if (form.kind === 'Table45') {
          assert.ok(actual.search && actual.more && actual.movement, 'movement buttons return together');
        } else if (['Bare6', 'Fixed4BareStatus'].includes(form.kind)) {
          assert.ok(!actual.search && !actual.more && !actual.movement, 'hidden toolbar stays hidden');
        }
      }
      assert.deepEqual(await fs.readFile(form.path), disk, 'source file remains unchanged');
      assert.deepEqual(ui.scriptErrors(), []);
    } finally {
      ui.close();
      main.panel.dispose();
      await until(() => service.views.size === 0, 'table viewport view released');
      await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, locale: vscode.env.language, nativeGeometryCompared: process.platform === 'linux', sourceWrites: false, results,
  }));
};
