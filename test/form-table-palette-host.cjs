const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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
    return actual.length === expected.length;
  }, 'native table palette rows rendered');
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
  await until(() => ui.evaluate(`!!document.getElementById(${JSON.stringify(id)})`), 'table palette target present');
  await ui.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await until(() => view.palette?.revision === view.snapshot.revision
    && view.palette.identity.source === source && view.palette.identity.key.value === key.value,
  'table palette selection published');
  assert.deepEqual(view.selected, node.identity);
  return node.identity;
}

async function awaitRevision(view) {
  await until(() => view.palette?.revision === view.snapshot.revision, 'palette matches dirty revision');
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const { profiles, captions } = fixture.tablePalette;
  const forms = fixture.formGallery, cases = [];
  const language = vscode.env.language.startsWith('ru') ? 'ru-RU' : 'en-US';
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;

  for (const form of forms) {
    const before = await fs.readFile(form.path), source = before.toString('utf8');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const findView = () => [...service.views.values()].find(view => sameSourcePath(view.path, form.path));
    await until(() => findView()?.phase === 'ready', 'table palette form ready');
    const view = findView(), main = view.frames.get('main');
    const ui = await frame({ state: { title: main.panel.title } });
    try {
      for (const target of form.expected.selections) {
        await selectFromTree(ui, view, target.name);
        await checkPalette(ui, profiles, target, captions, language);
        cases.push(form.kind + '/' + target.name);
      }

      if (form.kind === 'ValueTable') {
        const identity = view.selected;
        const footer = platformRow('Footer');
        const defaultFooter = await ui.evaluate(`(() => {
          const row = ${footer}, control = row.querySelector('input');
          return [row.dataset.paletteSource,control.checked,control.disabled,row.getAttribute('tabindex')];
        })()`);
        assert.deepEqual(defaultFooter, ['absent', false, true, null]);
        const manual = forms.find(form => form.kind === 'ManualTableRows');
        await editFormSource(document, view, await fs.readFile(manual.path, 'utf8'));
        await awaitRevision(view);
        await checkPalette(ui, profiles, manual.expected.selections[0], captions, language);
        assert.deepEqual(view.selected, identity);
        const row = platformRow('MaxHeightInTableRows');
        assert.deepEqual(await ui.evaluate(`(() => {
          const row = ${row};
          return [row.dataset.propertyName,row.dataset.paletteSource,row.querySelector('td').textContent];
        })()`), ['MaxRowsCount','form','12']);
        await ui.evaluate(`${row}.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
        await until(() => vscode.window.activeTextEditor?.document === document
          && vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection).includes('<MaxRowsCount>12</MaxRowsCount>'),
        'table row limit navigates to canonical XML');
        cases.push('dirty-table-limit-and-xml-navigation');
        await editFormSource(document, view, source);
        main.panel.reveal(undefined, false);
        await awaitRevision(view);
        await checkPalette(ui, profiles, form.expected.selections[0], captions, language);
        assert.equal(await ui.evaluate(`${row}===null`), true);
        cases.push('table-limit-returns-to-automatic');
      }

      if (form.kind === 'VerticalHeader') {
        const identity = view.selected;
        const title = platformRow('Title');
        await ui.evaluate(`(() => {
          globalThis.__tablePaletteTitle=${title}.querySelector('details');
          __tablePaletteTitle.querySelector('summary').click();
        })()`);
        const edited = source.replace('<ShowInHeader>true</ShowInHeader>',
          '<ShowInHeader>false</ShowInHeader><HeaderDataPath>Rows.Text</HeaderDataPath>');
        assert.notEqual(edited, source);
        await editFormSource(document, view, edited);
        await awaitRevision(view);
        const vertical = forms.find(form => form.kind === 'Vertical');
        await checkPalette(ui, profiles, vertical.expected.selections[0], captions, language);
        assert.deepEqual(view.selected, identity);
        assert.equal(await ui.evaluate(`globalThis.__tablePaletteTitle===${title}.querySelector('details') && __tablePaletteTitle.open`), true);
        assert.equal(await ui.evaluate(`!!document.querySelector('.form-properties [data-property-name=HeaderDataPath]')`), true);
        cases.push('column-header-dirty-keeps-raw-value-and-expanded-title');
      }
      assert.deepEqual(ui.scriptErrors(), []);
      assert.deepEqual(await fs.readFile(form.path), before);
    } finally {
      await editFormSource(document, view, source);
      ui.close();
      main.panel.dispose();
      await until(() => !findView(), 'table palette form released');
      await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed:true, language, cases, sourceWrites:false }));
};
