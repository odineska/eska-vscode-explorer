const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), file = fixture.form.path;
  const expectedCatalogue = process.env.ESKA_HOST_PROPERTY_CATALOGUE !== 'legacy';
  const before = await fs.readFile(file);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, {preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => service.views.size === 1 && [...service.views.values()][0].phase === 'ready', 'catalogue form ready');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  assert.equal(view.client.limits.propertyPalette === true, expectedCatalogue);
  const ui = await frame({fixedFormArea:true,state:{title:main.panel.title}});
  const ru = vscode.env.language.startsWith('ru');
  const group = view.snapshot.model.root.children.find(node => node.name === 'Group');
  const input = group.children.find(node => node.name === 'Name');
  const select = async node => {
    const identity = node.identity;
    const id = `form-row-${identity.source}:current:${identity.key.value}`;
    await ui.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    await until(() => view.selected?.key.value === identity.key.value, 'selected ' + node.name);
  };
  await until(() => ui.evaluate("!!document.querySelector('.form-tree-row')"), 'element tree rendered');
  await select(group);
  const cases = [];
  if (!expectedCatalogue) {
    await until(() => ui.evaluate("!!document.querySelector('.form-properties [data-property-name=ShowTitle]')"), 'legacy XML properties');
    assert.equal(await ui.evaluate("document.querySelectorAll('.form-properties [data-palette-id]').length"), 0);
    cases.push('api-1.40-raw-properties');
  } else {
    await until(() => ui.evaluate("document.querySelectorAll('.form-properties [data-palette-id]').length===35"), '35 native rows');
    const baseline = await ui.evaluate(`(() => {
      const row = name => document.querySelector('[data-palette-id="platform:'+name+'"]');
      const checkbox = row('United').querySelector('input');
      return {categories:[...document.querySelectorAll('.form-property-category')].map(row=>row.textContent),
        type:row('Type').querySelector('td').textContent,width:row('Width').querySelector('td').textContent,
        through:row('ThroughAlign').querySelector('td').textContent,stretch:row('HorizontalStretch').querySelector('td').textContent,
        united:{checked:checkbox.checked,disabled:checkbox.disabled,source:row('United').dataset.paletteSource,
          tab:row('United').getAttribute('tabindex')}};})()`);
    assert.deepEqual(baseline, {
      categories:ru ? ['Основные','Использование','Оформление','Расположение'] : ['General','Use','Appearance','Layout'],
      type:ru ? 'Обычная группа' : 'Regular group',width:'0',through:ru?'Авто':'Auto',stretch:ru?'Авто':'Default',
      united:{checked:true,disabled:true,source:'absent',tab:null}
    });
    cases.push('native-order-categories-and-defaults');
    await ui.screenshot(`form-property-catalogue-${vscode.env.language}.png`);
    await ui.evaluate(`(() => {
      const title=document.querySelector('[data-palette-id="platform:Title"] details');
      globalThis.__catalogueTitle=title;
      title.querySelector('summary').click();
    })()`);
    await until(() => ui.evaluate("globalThis.__catalogueTitle.open"), 'localized title expanded');
    const original = document.getText();
    const override = original.replace('<UsualGroup name="Group" id="1">', '<UsualGroup name="Group" id="1" DisplayImportance="High">')
      .replace('<Group>Vertical</Group>', '<Group>Vertical</Group><United>false</United><GroupHorizontalAlign>Left</GroupHorizontalAlign><Width>0</Width><ToolTip/><f:United xmlns:f="urn:extra">first</f:United><f:United xmlns:f="urn:extra">second</f:United>');
    const edit = async text => {
      const change = new vscode.WorkspaceEdit();
      change.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
      assert.equal(await vscode.workspace.applyEdit(change),true);
    };
    const revision = view.snapshot.revision;
    await edit(override);
    await until(async () => view.phase==='ready' && view.snapshot.revision!==revision && await ui.evaluate(`document.querySelector('[data-palette-id="platform:United"]')?.dataset.paletteSource==='form'`), 'dirty palette installed');
    const dirty = await ui.evaluate(`(() => {
      const row = name => document.querySelector('[data-palette-id="platform:'+name+'"]');
      return {united:row('United').querySelector('input').checked,alignment:row('HorizontalAlignInGroup').dataset.propertyName,
        width:[row('Width').dataset.paletteSource,row('Width').querySelector('td').textContent],
        tooltip:row('ToolTip').dataset.paletteSource, importance:row('DisplayImportance').querySelector('td').textContent,
        keptTitle:globalThis.__catalogueTitle===row('Title').querySelector('details') && globalThis.__catalogueTitle.open};})()`);
    assert.deepEqual(dirty,{united:false,alignment:'GroupHorizontalAlign',width:['form','0'],tooltip:'form',importance:'High',keptTitle:true});
    cases.push('dirty-aliases-and-stable-expanded-title');
    await ui.evaluate(`document.querySelector('[data-palette-id="platform:DisplayImportance"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file && !vscode.window.activeTextEditor.selection.isEmpty, 'attribute XML navigation');
    assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection), 'DisplayImportance="High"');
    main.panel.reveal();
    cases.push('exact-attribute-source');
    await ui.evaluate(`(() => {
      const repeated = document.querySelectorAll('[data-property-namespace="urn:extra"]');
      repeated[1].dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}));
    })()`);
    await until(() => {
      const editor = vscode.window.activeTextEditor;
      return editor?.document.uri.fsPath === file && editor.document.getText(editor.selection).includes('>second<');
    }, 'repeated XML navigation');
    assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection), '<f:United xmlns:f="urn:extra">second</f:United>');
    cases.push('exact-repeated-xml-source');
    main.panel.reveal();
    await edit(original);
    await until(async () => view.phase==='ready' && await ui.evaluate(`document.querySelector('[data-palette-id="platform:United"]')?.dataset.paletteSource==='absent'`), 'removed overrides revert to defaults');
    assert.equal(await ui.evaluate(`globalThis.__catalogueTitle===document.querySelector('[data-palette-id="platform:Title"] details') && globalThis.__catalogueTitle.open`),true);
    cases.push('removed-override-restores-default');
    await select(input);
    await until(() => ui.evaluate("!!document.querySelector('[data-property-name=DataPath]') && !document.querySelector('[data-palette-id]')"), 'unverified context shows XML');
    await select(group);
    await until(() => ui.evaluate("document.querySelectorAll('[data-palette-id]').length===35"), 'selection returns to verified catalogue');
    cases.push('rapid-context-switch-and-raw-fallback');
  }
  assert.deepEqual(await fs.readFile(file),before);
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,cases,diskUnchanged:true}));
};
