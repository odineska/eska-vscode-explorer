const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource } = require('./webview-host.cjs');

function platformRow(id) {
  return `document.querySelector('.form-properties [data-palette-id="platform:${id}"]')`;
}

async function checkPalette(ui, profile, target, captions, language) {
  const expected = profile[target.profile];
  const expression = `(() => {
    const rows = [...document.querySelectorAll('.form-properties [data-palette-id^="platform:"]')];
    return rows.map(row => ({
      id: row.dataset.paletteId.slice('platform:'.length),
      label: row.querySelector('th')?.textContent,
      available: row.dataset.paletteAvailable !== 'false'
    }));
  })()`;
  let actual;
  await until(async () => {
    actual = await ui.evaluate(expression);
    return actual.length === expected.length && actual.every((row, index) => row.id === expected[index]);
  }, `native palette rendered for ${target.name}`);
  assert.deepEqual(actual.map(row => row.id), expected);
  assert.deepEqual(actual.filter(row => !row.available).map(row => row.id), target.unavailable);
  for (const row of actual) {
    if (captions[row.id]) assert.equal(row.label, captions[row.id][language], row.id);
  }
}

async function selectFromTree(ui, view, name) {
  const node = [...view.nodes.values()].find(node => node.name === name);
  assert.ok(node, name);
  const { source, key } = node.identity;
  const id = 'form-row-' + source + ':current:' + key.value;
  await until(() => ui.evaluate(`!!document.getElementById(${JSON.stringify(id)})`), 'palette target present');
  await ui.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await until(() => view.palette?.revision === view.snapshot.revision
    && view.palette.identity.source === source && view.palette.identity.key.value === key.value,
  'palette selection published');
  assert.deepEqual(view.selected, node.identity);
  return node.identity;
}

async function awaitRevision(view) {
  await until(() => view.palette?.revision === view.snapshot.revision, 'palette matches dirty revision');
}

async function withPaletteForm(service, form, inspect, frameOptions = {}) {
  const before = await fs.readFile(form.path), source = before.toString('utf8');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const findView = () => [...service.views.values()].find(view => sameSourcePath(view.path, form.path));
  await until(() => findView()?.phase === 'ready', 'palette form ready');
  const view = findView(), main = view.frames.get('main');
  const ui = await frame({ ...frameOptions, state: { title: main.panel.title } });
  try {
    await inspect({ ui, view, document, main, source });
    assert.deepEqual(ui.scriptErrors(), []);
    assert.deepEqual(await fs.readFile(form.path), before);
  } finally {
    await editFormSource(document, view, source);
    ui.close();
    main.panel.dispose();
    await until(() => !findView(), 'palette form released');
    await Promise.all([...service.closing]);
  }
}

module.exports = { platformRow, checkPalette, selectFromTree, awaitRevision, withPaletteForm };
