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
  const body = root.querySelector('.taxi-form-scrollport');
  const footer = root.querySelector('.taxi-root-commands button')?.getBoundingClientRect();
  const tail = root.querySelector('[data-element$=":current:200"] .taxi-input')?.getBoundingClientRect();
  const content = grid.querySelector('.taxi-table-content');
  const columns = [...grid.querySelectorAll('[data-column]')];
  const shown = selector => !!table.querySelector(selector)?.getClientRects().length;
  const owners = globalThis.__tableViewportOwners;
  return {
    frame: [origin.width, origin.height], grid: [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height],
    preferred: ['width', 'height'].map(axis => parseFloat(root.style.getPropertyValue('--taxi-form-preferred-' + axis))),
    bodyScroll: [body.scrollTop, body.scrollHeight - body.clientHeight],
    footerButton: footer ? [footer.x - origin.x, footer.y - origin.y, footer.width, footer.height] : null,
    tail: tail ? [tail.x - origin.x, tail.y - origin.y, tail.width, tail.height] : null,
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

function rememberTableOwners(ui) {
  return ui.evaluate(`(() => {
    const table = document.querySelector('[data-kind=Table]'), grid = table.querySelector('.taxi-table-scroll');
    const content = grid.querySelector('.taxi-table-content');
    globalThis.__tableViewportOwners = { table, grid, content, columns: [...grid.querySelectorAll('[data-column]')] };
  })()`);
}

async function allocate(ui, native) {
  await until(() => ui.evaluate("!!document.querySelector('.taxi-table-scroll')"), 'table viewport mounted');
  await allocateFormViewport(ui, native.frame);
  const actual = await geometry(ui);
  if (process.platform === 'linux') {
    assert.deepEqual(actual.frame, native.frame, 'form frame');
    if (native.grid[3] === null) {
      assert.deepEqual(actual.grid.slice(0, 3), native.grid.slice(0, 3), 'clipped grid position and width');
      assert.ok(actual.bodyScroll[1] > 0, 'clipped grid can be scrolled');
    } else {
      assert.deepEqual(actual.grid, native.grid, 'table grid');
    }
    if (native.footerButton) assert.deepEqual(actual.footerButton, native.footerButton, 'bottom command');
    if (native.tail) assert.deepEqual(actual.tail, native.tail, 'field below the grid');
  }
  return actual;
}

async function withDetachedTable(service, view, main, ui, run) {
  const workbench = await ui.nativeWindow();
  const identity = [...view.nodes.values()].find(node => node.name === 'Rows').identity;
  await service.receive(view, main, { type: 'select', identity });
  await ui.focusWorkbench();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'table viewport detached');
  const preview = view.frames.get('preview');
  const floating = await frame({ detached: true, state: { title: preview.panel.title } });
  try {
    assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
    await run(floating);
  } finally {
    try {
      await service.receive(view, preview, { type: 'dock' });
      await until(() => !view.frames.has('preview'), 'table viewport docked');
    } finally { floating.close(); }
  }
}

async function resizeAndEdit(service, view, main, ui, document, forms, results) {
  const native = name => forms.find(form => form.kind === name).expected.native;
  const source = document.getText();
  await withDetachedTable(service, view, main, ui, async floating => {
    try {
      const initial = await allocate(floating, native('Table30'));
      assert.ok(initial.selected, 'selection propagated to the floating preview');
      assert.ok(initial.content[1] > initial.content[0], 'columns overflow the viewport');
      await rememberTableOwners(floating);
      await floating.evaluate('globalThis.__tableViewportOwners.content.scrollLeft = 24; true');
      assert.equal((await geometry(floating)).scrollLeft, 24, 'column content scrolls independently');
      const wideFrame = native('Table65').frame;
      const wide = await allocate(floating, { frame: wideFrame, grid: initial.grid });
      assert.deepEqual(wide.preferred, initial.preferred, 'resize keeps the authored size');
      assert.deepEqual(wide.content, initial.content, 'the fixed grid viewport stays the same in a wider window');
      const narrow = await allocate(floating, native('Table30'));
      assert.deepEqual(narrow.columnWidths, initial.columnWidths, 'resize restores column widths');
      const change = async (xml, name, label) => {
        await editFormSource(document, view, xml);
        await until(() => floating.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'floating table XML revision');
        const actual = await allocate(floating, native(name));
        assert.deepEqual(actual.preferred, native(name).frame, 'source width changes the preferred frame');
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
    } finally { await editFormSource(document, view, source); }
  });
}

async function checkScrollModes(service, view, main, ui, document, expected, results) {
  const source = document.getText();
  const read = async (floating, sample) => {
    await allocateFormViewport(floating, sample.frame);
    const actual = await geometry(floating);
    assert.deepEqual(actual.frame, sample.frame);
    assert.deepEqual(actual.grid, sample.grid);
    assert.deepEqual(actual.tail, sample.tail);
    assert.deepEqual(actual.bodyScroll, [0, sample.scrollRange]);
    assert.deepEqual(actual.preferred, expected.native.frame);
    assert.ok(actual.selected && actual.stableOwners, 'vertical scrolling keeps the selected table and its DOM');
    return actual;
  };
  await withDetachedTable(service, view, main, ui, async floating => {
    try {
      await geometry(floating);
      await rememberTableOwners(floating);
      for (const sample of expected.scrollModes) {
        const xml = sample.mode ? source.replace('<ChildItems>', '<VerticalScroll>' + sample.mode + '</VerticalScroll><ChildItems>') : source;
        assert.ok(!sample.mode || xml !== source);
        if (document.getText() !== xml) {
          await editFormSource(document, view, xml);
          await until(() => floating.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'floating scroll mode revision');
        }
        await floating.evaluate("document.querySelector('.taxi-form-scrollport').scrollTop=0; true");
        const actual = await read(floating, sample);
        const name = expected.name + '-' + (sample.mode ?? 'auto');
        results.push({ name, ...actual });
        if (sample.scrollRange > 0) {
          await floating.evaluate("document.querySelector('.taxi-form-scrollport').scrollTop=1e6; true");
          const end = await geometry(floating);
          assert.equal(end.bodyScroll[0], sample.scrollRange);
          assert.equal(end.tail[1], actual.tail[1] - sample.scrollRange, 'the last field scrolls into view');
          assert.ok(end.tail[1] + end.tail[3] < end.frame[1]);
        }
      }
      await editFormSource(document, view, source);
      await until(() => floating.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'original scroll mode restored');
      await floating.evaluate("document.querySelector('.taxi-form-scrollport').scrollTop=0; true");
      await read(floating, expected.scrollModes[0]);
      assert.deepEqual(floating.scriptErrors(), []);
    } finally { await editFormSource(document, view, source); }
  });
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
      if (process.platform === 'linux') {
        assert.deepEqual((await geometry(ui)).preferred, native.frame, 'preferred frame at opening');
      }
      const actual = await allocate(ui, native);
      results.push({ name: form.kind, ...actual });
      if (process.platform === 'linux') {
        if (form.expected.scrollModes) {
          await checkScrollModes(service, view, main, ui, document, form.expected, results);
        } else if (['Table6', 'Fixed4NoStatus'].includes(form.kind)) {
          assert.ok(actual.search && !actual.more && !actual.movement, 'search occupies the narrow toolbar');
        } else if (form.kind === 'Table30') {
          assert.ok(actual.search && actual.more && !actual.movement, 'commands fold into the menu');
          await resizeAndEdit(service, view, main, ui, document, fixture.formGallery, results);
        } else if (form.kind === 'Table45') {
          assert.ok(actual.search && actual.more && actual.movement, 'movement buttons return together');
        } else if (['Bare6', 'Fixed4BareStatus'].includes(form.kind)) {
          assert.ok(!actual.search && !actual.more && !actual.movement, 'hidden toolbar stays hidden');
        } else if (form.kind === 'TableHeight30') {
          await ui.evaluate("document.querySelector('.taxi-form-scrollport').scrollTop = 1e6; true");
          const end = await geometry(ui);
          assert.equal(end.bodyScroll[0], end.bodyScroll[1], 'body scroll reaches the end');
          assert.equal(end.grid[1], actual.grid[1] - end.bodyScroll[0], 'the table moves with the body');
          assert.deepEqual(end.footerButton, native.footerButton, 'bottom command stays in place');
          results.push({ name: 'TableHeight30-scrolled', ...end });
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
