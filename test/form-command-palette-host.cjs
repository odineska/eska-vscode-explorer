const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, editFormSource } = require('./webview-host.cjs');
const { platformRow, checkPalette, selectFromTree, awaitRevision, withPaletteForm } = require('./native-form-palette-host.cjs');

async function checkAutofill(ui, authored) {
  const row = platformRow('AutoFill');
  const control = await ui.evaluate(`(() => {
    const row = ${row}, checkbox = row.querySelector('input');
    return [row.dataset.paletteSource, row.dataset.propertyName ?? null, checkbox.checked, checkbox.disabled];
  })()`);
  assert.deepEqual(control, authored ? ['form', 'Autofill', false, true] : ['absent', null, true, true]);
}

async function checkDirtySource(ui, view, document, source) {
  const identity = view.selected;
  const reference = platformRow('Source'), maxWidth = platformRow('MaxWidth');
  await ui.evaluate(`(() => {
    globalThis.__additionSourceDetails = ${reference}.querySelector('details');
    __additionSourceDetails.querySelector('summary').click();
  })()`);
  const edited = source.replace('name="Rows" id="3"', 'name="Orders" id="3"')
    .replace('<CommandSource>Item.Rows</CommandSource>', '<CommandSource>Item.Orders</CommandSource>')
    .replaceAll('<Item>Rows</Item>', '<Item>Orders</Item>')
    .replace(/(<ViewStatusAddition name="StatusExtra"[^>]*>)/u,
      '$1<AutoMaxWidth>false</AutoMaxWidth><MaxWidth>15</MaxWidth>');
  assert.notEqual(edited, source);
  await editFormSource(document, view, edited);
  await awaitRevision(view);
  assert.deepEqual(view.selected, identity);
  await until(() => ui.evaluate(`${reference}.querySelector('summary').textContent === 'Orders.ViewStatus'`),
    'dirty addition source summary');
  assert.deepEqual(await ui.evaluate(`(() => {
    const source = ${reference}, details = source.querySelector('details');
    return [source.dataset.propertyName, details === __additionSourceDetails,
      details.open, details.querySelector('dl').textContent.includes('Orders'),
      ${maxWidth}.querySelector('td').textContent];
  })()`), ['AdditionSource', true, true, true, '15']);
  await ui.evaluate(`${reference}.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
  await until(() => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== document) return false;
    const selected = editor.document.getText(editor.selection);
    return selected.includes('<AdditionSource>') && selected.includes('<Item>Orders</Item>');
  }, 'addition source navigates to its actual XML record');
}

exports.run = async function run() {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const { profiles, captions, additionSourceMembers } = fixture.commandPalette;
  const language = vscode.env.language.startsWith('ru') ? 'ru-RU' : 'en-US';
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const cases = [];
  for (const form of fixture.formGallery) {
    await withPaletteForm(explorer.formPreview, form, async ({ ui, view, document, source }) => {
      for (const target of form.expected.selections) {
        const { name } = target;
        await selectFromTree(ui, view, name);
        await checkPalette(ui, profiles, target, captions, language);
        if (target.profile === 'autoBar') await checkAutofill(ui, form.kind === 'TableAuto');
        if (name === 'PictureMenu') {
          const representation = platformRow('Representation'), picture = platformRow('Picture');
          assert.deepEqual(await ui.evaluate(`[
            ${representation}.querySelector('td').textContent,
            ${picture}.dataset.propertyName, ${picture}.dataset.paletteSource
          ]`), [language === 'ru-RU' ? 'Картинка' : 'Icon', 'Picture', 'form']);
        }
        const member = additionSourceMembers[name]?.['en-US'];
        if (member) {
          assert.deepEqual(await ui.evaluate(`(() => {
            const row = ${platformRow('Source')};
            return [row.querySelector('summary').textContent, row.dataset.propertyName, row.dataset.paletteSource];
          })()`), [`Rows.${member}`, 'AdditionSource', 'form']);
        }
        cases.push({ name: `${form.kind}/${name}` });
      }
      if (form.kind === 'External') {
        await selectFromTree(ui, view, 'StatusExtra');
        await checkDirtySource(ui, view, document, source);
        cases.push({ name: 'dirty-addition-width-and-source' }, { name: 'addition-source-record-and-xml-navigation' });
      }
    });
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed:true, language, cases, sourceWrites:false }));
};
