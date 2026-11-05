const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate(); await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results = [];
  const english = !vscode.env.language.startsWith('ru');
  for (const form of fixture.formGallery) {
    const explicitCommands = ['TablePopup', 'TableButtonGroup'].includes(form.kind);
    const before = await fs.readFile(form.path);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service = explorer.formPreview;
    await until(() => [...service.views.values()].some(view => view.path === form.path && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => view.path === form.path), panel = view.frames.get('main');
    const ui = await frame({ state: { title: panel.panel.title } });
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-table-scroll')"), `render ${form.kind}`);
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    if(process.platform==='linux')await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-table-command-bar .taxi-button')].every(button=>button.style.width||button.classList.contains('taxi-button--picture'))"),'native table captions allocated');
    const geometry = await ui.evaluate(`(() => {
      const rect = node => {const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),control:rect(document.querySelector('.taxi-table-scroll')),
        header:rect(document.querySelector('.taxi-table-head')),headerColor:getComputedStyle(document.querySelector('.taxi-table-head')).backgroundColor,
        columns:[...document.querySelectorAll('[data-column]')].map(node=>({label:node.textContent,...rect(node)})),
        bar:!!document.querySelector('.taxi-table-command-bar'),chips:document.querySelector('.taxi-table-search-controls')?.textContent,
        buttons:[...document.querySelectorAll('.taxi-table-command-bar .taxi-button')].map(button=>({label:button.textContent,...rect(button)})),
        mark:!!document.querySelector('.taxi-table-incomplete'),footer:document.querySelector('.taxi-table-footer')?.textContent,
        gutter:!!document.querySelector('.taxi-table-scrollbar'),paging:document.querySelectorAll('.taxi-table-pagination > span').length,
        fabricatedRows:document.querySelectorAll('.taxi-table-empty [role=row], .taxi-table-empty [role=cell]').length};
    })()`);
    assert.equal(geometry.control.width, form.kind === 'MetadataTable' ? 520 : form.kind === 'DynamicList' ? english ? 454 : 418 : explicitCommands || ['GridFooter', 'NoAutoFill'].includes(form.kind) ? 400 : english ? 429 : 415, `${form.kind} width`);
    assert.equal(geometry.control.height, form.kind === 'DynamicList' ? 452 : form.kind === 'GridFooter' ? 145 : form.kind === 'Vertical' ? 228 : 227, `${form.kind} height`);
    assert.equal(geometry.header.height, form.kind === 'Vertical' ? 90 : ['HorizontalTitled', 'InCell'].includes(form.kind) ? 60 : 30);
    assert.equal(geometry.bar, !['GridFooter', 'NoAutoFill'].includes(form.kind));
    assert.equal(geometry.mark, ['Marked', 'MetadataTable'].includes(form.kind));
    assert.equal(geometry.chips !== undefined, !explicitCommands && form.kind !== 'NoViewStatus');
    assert.equal(geometry.gutter, form.kind !== 'DynamicList');
    assert.equal(geometry.paging, form.kind === 'DynamicList' ? 4 : 0);
    assert.equal(geometry.fabricatedRows, 0);
    assert.equal(geometry.headerColor, 'rgb(242, 242, 242)');
    if (form.kind !== 'DynamicList') assert.equal(geometry.frame.height, explicitCommands || form.kind === 'NoViewStatus' ? 312 : form.kind === 'GridFooter' ? 225 : form.kind === 'NoAutoFill' ? 307 : form.kind === 'Vertical' ? 343 : 342);
    if (form.kind === 'MetadataTable') assert.deepEqual(geometry.columns.map(column => column.width), [97, 177, 176, 54]);
    if (form.kind === 'DynamicList') assert.deepEqual(geometry.columns.map(column => column.width), [108, english ? 344 : 308]);
    if (form.kind === 'ColumnHidden') assert.deepEqual(geometry.columns.map(column => column.label),['Amount','Active']);
    if (form.kind === 'GridFooter') assert.equal(geometry.footer, 'Total');
    if (['Default', 'ReadOnly', 'Marked'].includes(form.kind)) {
      assert.equal(geometry.columns[1].width, form.kind === 'ReadOnly' ? 108 : 129);
      assert.equal(geometry.columns[2].width, 54);
    }
    if (form.kind === 'Default') {
      const searchWidth = "document.querySelector('.taxi-table-search').getBoundingClientRect().width";
      if(process.platform==='linux') {
        assert.equal(geometry.buttons[0].width,english?51:85);
        assert.equal(geometry.buttons.at(-1).width,english?108:60);
        assert.equal(Math.round(await ui.evaluate(searchWidth)),172);
      }
      await ui.evaluate("document.querySelector('.taxi-form-frame').style.width='1000px'");
      assert.equal(await ui.evaluate(searchWidth), 260, 'search stays bounded in a wide table');
      await ui.evaluate("document.querySelector('.taxi-form-frame').style.width='max-content'");
    }
    await ui.screenshot(`table-${form.kind}-${vscode.env.language}.png`);
    if (form.kind === 'TableButtonGroup') {
      assert.deepEqual(geometry.buttons.map(button => button.label), ['First command', 'Second command']);
      if (process.platform === 'linux') assert.deepEqual(geometry.buttons.map(button => button.width), [115, 133]);
      await ui.evaluate("document.querySelectorAll('.taxi-table-command-bar .taxi-button')[1].click()");
      await until(() => view.selected?.key?.value === '220', 'select grouped table command');
    }
    if (form.kind === 'TablePopup') {
      assert.deepEqual(geometry.buttons.map(button => button.label), ['Actions▾']);
      if (process.platform === 'linux') assert.equal(geometry.buttons[0].width, 76);
      assert.equal(await ui.evaluate("!!document.querySelector('.taxi-table-search')"), false);
      await ui.evaluate("document.querySelector('.taxi-popup > button').click()");
      assert.deepEqual(await ui.evaluate("[...document.querySelectorAll('.taxi-menu [role=menuitem]')].map(item=>item.textContent)"), ['First command', 'Second command']);
      assert.deepEqual(await ui.evaluate("(() => {const menu=document.querySelector('.taxi-menu'),item=menu.firstElementChild;return [menu.getBoundingClientRect().width,item.getBoundingClientRect().height,getComputedStyle(item).backgroundColor]})()"), [210, 30, 'rgb(250, 204, 31)']);
      await ui.screenshot(`table-popup-open-${vscode.env.language}.png`);
      await ui.evaluate("document.querySelector('.taxi-popup').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
      assert.equal(await ui.evaluate('document.activeElement.textContent'), 'Second command');
      await ui.evaluate("document.querySelectorAll('.taxi-menu [role=menuitem]')[1].click()");
      await until(() => view.selected?.key?.value === '220', 'select popup table command');
      assert.equal(await ui.evaluate("!!document.querySelector('.taxi-menu')"), false);
      await ui.evaluate("document.querySelector('.taxi-popup > button').click();globalThis.__tableMenu=document.querySelector('.taxi-menu')");
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), document.getText().replaceAll('Second command', 'Updated command'));
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-menu [role=menuitem]')[1]?.textContent==='Updated command'"), 'dirty table command updates in the open menu');
      assert.equal(await ui.evaluate("document.querySelector('.taxi-menu')===globalThis.__tableMenu"), true, 'open table menu keeps its DOM');
      await ui.evaluate("document.querySelector('.taxi-popup').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await ui.evaluate("!!document.querySelector('.taxi-menu')"), false);
      assert.equal(document.isDirty, true);
    }
    assert.deepEqual(await fs.readFile(form.path), before);
    results.push({kind:form.kind,...geometry}); panel.panel.dispose();
    await until(() => service.views.size === 0, 'release gallery form'); await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,formTables:true,locale:vscode.env.language,results}));
};
