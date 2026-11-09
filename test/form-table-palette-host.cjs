const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, editFormSource } = require('./webview-host.cjs');

const { platformRow, checkPalette, selectFromTree, awaitRevision, withPaletteForm } = require('./native-form-palette-host.cjs');

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
    await withPaletteForm(service, form, async ({ ui, view, document, main, source }) => {
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
    });
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed:true, language, cases, sourceWrites:false }));
};
