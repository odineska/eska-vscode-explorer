const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, editFormSource, sameSourcePath } = require('./webview-host.cjs');

async function checkSourceBar(ui, view, document, english) {
  const bar = "document.querySelector('.taxi-command-bar')";
  const popup = `${bar}?.querySelector('.taxi-popup > button')`;
  const buttons = `[...${bar}.querySelectorAll('.taxi-button')].map(button => button.getAttribute('aria-label'))`;
  const customize = english ? 'Customize form...' : 'Изменить форму...';
  await until(() => ui.evaluate(`!!${popup} && ${buttons}.length === 1 && !document.querySelector('[data-kind=Table]')`), 'empty table leaves only its additional commands');
  assert.ok([...view.nodes.values()].some(node => node.kind === 'Table' && node.name === 'Rows'));
  await ui.evaluate(`${popup}.click()`);
  const menu = await ui.evaluate("[...document.querySelectorAll('.taxi-menu [role=menuitem]')].map(item => item.textContent)");
  assert.deepEqual(menu, [customize, 'Second command']);
  await ui.evaluate(`${popup}.click()`);
  const source = document.getText();
  async function change(xml) {
    const edit = new vscode.WorkspaceEdit();
    const revision = view.snapshot.revision;
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), xml);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await until(() => view.snapshot.revision !== revision, 'updated table command source');
  }
  const find = '<CommandName>Form.Item.Rows.StandardCommand.Find</CommandName>';
  const forced = '<LocationInCommandBar>InCommandBar</LocationInCommandBar>';
  const customizeCommand = '<CommandName>Form.StandardCommand.CustomizeForm</CommandName>';
  assert.ok(source.includes(find) && source.includes(customizeCommand));
  await change(source.replace(find, find + forced).replace(customizeCommand, customizeCommand + forced));
  await until(() => ui.evaluate(`${buttons}.length === 2 && ${buttons}[1] === ${JSON.stringify(customize)} && !document.querySelector('[data-kind=Table]')`),
    'forced Customize follows More and Find remains hidden');
  const visibleAfterEdit = await ui.evaluate(buttons);
  await ui.screenshot('table-empty-source-bar-' + vscode.env.language + '.png');

  const add = english ? 'Add' : 'Добавить';
  const up = english ? 'Move up' : 'Переместить вверх';
  const down = english ? 'Move down' : 'Переместить вниз';
  const findCaption = english ? 'Find...' : 'Найти...';
  const cancel = english ? 'Cancel search' : 'Отменить поиск';
  const more = english ? 'More actions' : 'Еще';
  const advanced = english ? 'Advanced search' : 'Расширенный поиск';
  const input = '<InputField name="Text" id="3"><DataPath>Rows.Text</DataPath></InputField>';
  const withColumn = source.replace('</Table>', '<ChildItems>' + input + '</ChildItems></Table>');
  const grid = "!!document.querySelector('.taxi-table-scroll')";
  const externalSearch = "document.querySelector('.taxi-command-bar > .taxi-table-search')";
  await change(withColumn);
  await until(() => ui.evaluate(`${grid} && ${buttons}.length === 6`), 'table source adds automatic and explicit actions');
  const projectedButtons = await ui.evaluate(buttons);
  assert.deepEqual(projectedButtons, [add, up, down, findCaption, cancel, more]);
  if (process.platform === 'linux') {
    const tableOffset = "document.querySelector('.taxi-table-scroll').getBoundingClientRect().y - document.querySelector('.taxi-form-frame').getBoundingClientRect().y";
    await until(() => ui.evaluate(tableOffset + ' === 75'), 'table starts at the native offset below its separate command bar');
  }
  assert.equal(await ui.evaluate("!!document.querySelector('.taxi-command-bar .taxi-button--icon-only[aria-label=" + JSON.stringify(cancel) + "] svg')"), true);
  await ui.evaluate("globalThis.__tableSourceBar = document.querySelector('.taxi-command-bar'); true");

  await change(withColumn.replace(input, input.replace('</InputField>', '<Visible>false</Visible></InputField>')));
  await until(() => ui.evaluate(`!${grid} && ${buttons}.length === 6`), 'declared but hidden columns keep source commands');
  assert.deepEqual(await ui.evaluate(buttons), projectedButtons);
  assert.equal(await ui.evaluate("document.querySelector('.taxi-command-bar') === __tableSourceBar"), true);

  const exclusions = '<CommandSet><ExcludedCommand>Add</ExcludedCommand><ExcludedCommand>MoveDown</ExcludedCommand><ExcludedCommand>Find</ExcludedCommand></CommandSet>';
  await change(withColumn.replace('<RowFilter', exclusions + '<RowFilter'));
  await until(() => ui.evaluate(`${grid} && ${buttons}.length === 3`), 'source actions use the table command exclusions');
  assert.deepEqual(await ui.evaluate(buttons), [up, cancel, more]);

  const withSearch = withColumn.replace('<SearchStringLocation>None</SearchStringLocation>', '')
    .replace('<Autofill>false</Autofill>', '');
  assert.notEqual(withSearch, withColumn);
  await change(withSearch);
  await until(() => ui.evaluate(`!!${externalSearch} && !!document.querySelector('.taxi-table-command-bar')`), 'search is projected with both command bars visible');
  assert.deepEqual(await ui.evaluate(buttons), [add, up, down, more]);
  assert.equal(await ui.evaluate("!!document.querySelector('.taxi-table-command-bar .taxi-table-search')"), false);
  await ui.evaluate(`${externalSearch}.click()`);
  await until(() => view.selected?.key?.value === '8', 'projected search selects its table source element');
  await ui.screenshot('table-source-search-' + vscode.env.language + '.png');

  await change(withSearch.replace(find, find + forced));
  await until(() => ui.evaluate(`!!${externalSearch} && ${buttons}.includes(${JSON.stringify(advanced)})`), 'forced Find keeps the advanced search action');
  assert.deepEqual(await ui.evaluate(buttons), [add, up, down, advanced, more]);
  if (process.platform === 'linux') {
    const searchBox = `${externalSearch}.getBoundingClientRect()`;
    const advancedButton = `${bar}.querySelector('[aria-label="${advanced}"]').getBoundingClientRect()`;
    await until(() => ui.evaluate(`${searchBox}.width === 161 && ${searchBox}.left >= ${advancedButton}.right + 9`),
      'the advanced search action and field keep their native widths without overlap');
  }
  await ui.evaluate("globalThis.__sourceGrid = document.querySelector('.taxi-table-scroll'); true");
  const top = withColumn.replace('<SearchStringLocation>None</SearchStringLocation>', '<SearchStringLocation>Top</SearchStringLocation>');
  await change(top);
  const above = "document.querySelector('.taxi-table-field > .taxi-table-search--top')";
  await until(() => ui.evaluate(`!!${above} && !${externalSearch}`), 'Top search appears above the grid');
  assert.deepEqual(await ui.evaluate(buttons), [add, up, down, more]);
  const topSearch = await ui.evaluate(`(() => {
    const form = document.querySelector('.taxi-form-frame').getBoundingClientRect();
    const field = ${above}.getBoundingClientRect();
    const grid = __sourceGrid.getBoundingClientRect();
    return { width: field.width, gridWidth: grid.width, offset: field.y - form.y,
      gap: grid.y - field.bottom, sameGrid: __sourceGrid === document.querySelector('.taxi-table-scroll') };
  })()`);
  assert.equal(topSearch.width, topSearch.gridWidth);
  assert.equal(topSearch.sameGrid, true);
  if (process.platform === 'linux') assert.deepEqual([topSearch.offset, topSearch.gap], [75, 8]);
  await ui.evaluate("__sourceGrid.click()");
  await until(() => view.selected?.key?.value === '1', 'the grid selects the table');
  await ui.evaluate(`${above}.click()`);
  await until(() => view.selected?.key?.value === '8', 'Top search selects the same source element');
  await ui.screenshot('table-top-search-' + vscode.env.language + '.png');
  return { menu, visibleAfterEdit, projectedButtons, searchProjected: true, topSearch };
}

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
    await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
    const ui = await frame({fixedFormArea:true, state: { title: panel.panel.title } });
    if (form.kind === 'SourceBarEmpty') {
      results.push({ kind: form.kind, ...await checkSourceBar(ui, view, document, english) });
      assert.deepEqual(await fs.readFile(form.path), before);
      panel.panel.dispose();
      await until(() => service.views.size === 0, form.kind + ' released');
      await Promise.all([...service.closing]);
      continue;
    }
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
    if (form.kind !== 'DynamicList') {
      const height = explicitCommands ? process.platform === 'linux' ? 314 : 312
        : form.kind === 'NoViewStatus' ? 312 : form.kind === 'GridFooter' ? process.platform === 'linux' ? 227 : 225
        : form.kind === 'NoAutoFill' ? process.platform === 'linux' ? 309 : 307 : form.kind === 'Vertical' ? 343 : 342;
      assert.equal(geometry.frame.height, height, `${form.kind} native frame height`);
    }
    if (explicitCommands && process.platform === 'linux') {
      assert.equal(geometry.control.y - geometry.frame.y, 74, `${form.kind} native grid offset`);
      assert.deepEqual(geometry.buttons.map(button => [button.x - geometry.frame.x, button.y - geometry.frame.y, button.width, button.height]),
        form.kind === 'TablePopup' ? [[13, 39, 77, 26]] : [[13, 39, 115, 26], [137, 39, 133, 26]]);
    }
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
      const initialSearchWidth = await ui.evaluate(searchWidth);
      if(process.platform==='linux') {
        assert.equal(geometry.buttons[0].width,english?51:85);
        assert.equal(geometry.buttons.at(-1).width,english?108:60);
        assert.equal(Math.round(initialSearchWidth),172);
      }
      const wide = await ui.evaluate(`(async () => {
        const viewport = document.querySelector('.preview-scroll'), width = viewport.style.width;
        try {
          viewport.style.width = '1000px';
          for (let tick = 0; tick < 30 && ${searchWidth} !== 260; tick++) {
            await new Promise(requestAnimationFrame);
          }
          return {search: ${searchWidth}, viewport: viewport.clientWidth,
            frame: document.querySelector('.taxi-form-frame').getBoundingClientRect().width};
        } finally {
          viewport.style.width = width;
        }
      })()`);
      assert.equal(wide.search, 260, 'search stays bounded in a wide table '+JSON.stringify(wide));
      await until(async () => await ui.evaluate(searchWidth)===initialSearchWidth, 'restored table search width');
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
      if (process.platform === 'linux') assert.equal(geometry.buttons[0].width, 77);
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
    let identity;
    if (['Default', 'GridFooter', 'HorizontalTitled', 'Vertical', 'InCell'].includes(form.kind)) {
      identity = await verifyGeometryIdentity(document, view, ui, form.kind);
    }
    const dynamicSearch = form.kind === 'DynamicList' ? await verifyDynamicSearch(document, view, ui, english) : undefined;
    if (dynamicSearch && process.platform === 'linux') {
      dynamicSearch.toolbar = await verifyDynamicToolbar(document, view, ui, english);
      dynamicSearch.pagination = await verifyDynamicPagination(document, view, ui);
    }
    assert.deepEqual(await fs.readFile(form.path), before);
    results.push({kind:form.kind,...geometry,...(identity ? {identity} : {}), ...(dynamicSearch ? {dynamicSearch} : {})}); panel.panel.dispose();
    await until(() => service.views.size === 0, 'release gallery form'); await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,formTables:true,locale:vscode.env.language,results}));
};

/** A width edit must retain the actual header/footer DOM, including the changed column. */
async function verifyGeometryIdentity(document, view, ui, kind) {
  async function replace(text) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  }
  const original = document.getText();
  const footer = original.includes('<Footer>true</Footer>') ? original
    : original.replace('<Table name="Rows" id="1">', '<Table name="Rows" id="1"><Footer>true</Footer>');
  assert.ok(footer.includes('<Footer>true</Footer>'));
  if (footer !== original) await replace(footer);
  await until(async () => await ui.evaluate("!!document.querySelector('.taxi-table-footer')"), 'identity footer ready');
  const captured = await ui.evaluate(`(() => {
    globalThis.__tableIdentity = {
      headers: [...document.querySelectorAll('.taxi-table-head [data-column]')],
      footer: [...document.querySelectorAll('.taxi-table-footer [role=cell]')],
      tracks: document.querySelector('.taxi-table-head').style.gridTemplateColumns
    };
    return {headers: __tableIdentity.headers.length, footer: __tableIdentity.footer.length};
  })()`);
  assert.ok(captured.headers >= 3 && captured.footer >= 2);
  // Exceed the available group width so a fill column cannot absorb the edit.
  const widthEdit = 72;
  const changed = footer.replace(/<InputField\b[^>]*\bname="Text"[^>]*>/,
    opening => opening + `<Width>${widthEdit}</Width>`);
  assert.notEqual(changed, footer, 'controlled Text column fixture exists');
  const fixed = kind === 'Default' && process.platform === 'linux';
  const wide = fixed ? changed.replace('<Table name="Rows" id="1">',
    '$&<Width>60</Width><HorizontalStretch>false</HorizontalStretch>') : changed;
  await replace(wide);
  await until(async () => await ui.evaluate("document.querySelector('.taxi-table-head').style.gridTemplateColumns !== __tableIdentity.tracks"), 'dirty column width rendered');
  if (process.platform === 'linux') {
    const bar = "document.querySelector('.taxi-table-horizontal-scrollbar')";
    const viewport = "document.querySelector('.taxi-table-content')";
    await until(() => ui.evaluate(`!!${bar} && ${viewport}.scrollWidth > ${viewport}.clientWidth`), 'horizontal table strip visible');
    if (fixed) await until(() => ui.evaluate(`${viewport}.closest('.taxi-form-frame').offsetWidth === 634`), 'fixed table frame follows the dirty preferred width');
    const geometry = await ui.evaluate(`(() => {
      const content = ${viewport}, strip = ${bar}, table = content.parentElement;
      return { height: strip.offsetHeight, reserved: table.clientHeight - content.clientHeight,
        controls: strip.getAttribute('aria-controls') === content.id, tableWidth: table.offsetWidth,
        frameWidth: table.closest('.taxi-form-frame').offsetWidth };
    })()`);
    assert.equal(geometry.height, 14);
    assert.equal(geometry.reserved, 14);
    assert.equal(geometry.controls, true);
    if (fixed) assert.deepEqual([geometry.tableWidth, geometry.frameWidth], [600, 634]);
    await ui.evaluate(`${bar}.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true, cancelable: true}))`);
    assert.equal(await ui.evaluate(`${viewport}.scrollLeft === ${viewport}.scrollWidth - ${viewport}.clientWidth`), true);
    await ui.evaluate(`${bar}.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true, cancelable: true}))`);
    assert.equal(await ui.evaluate(`${viewport}.scrollLeft`), 0);
  }
  const retained = await ui.evaluate(`({
    headers: __tableIdentity.headers.filter(node => node.isConnected).length,
    footer: __tableIdentity.footer.filter(node => node.isConnected).length
  })`);
  await ui.screenshot(`table-identity-${kind}-${vscode.env.language}.png`);
  assert.equal(retained.headers, captured.headers, `${kind}: Width retains all header DOM nodes`);
  assert.equal(retained.footer, captured.footer, `${kind}: Width retains all footer DOM nodes`);
  await ui.evaluate("document.querySelector('.taxi-table-head [data-column$=\":4\"]').click()");
  await until(() => view.selected?.key?.value === '4', 'retained header selects its original source column');
  await replace(original);
  await until(async () => await ui.evaluate("document.querySelector('.taxi-table-head').style.gridTemplateColumns === __tableIdentity.tracks"), 'width restored');
  if (process.platform === 'linux') await until(() => ui.evaluate("!document.querySelector('.taxi-table-horizontal-scrollbar')"), 'restoring Width removes overflow');
  assert.equal(await ui.evaluate('__tableIdentity.headers.every(node => node.isConnected)'), true, 'restoring Width retains headers');
  assert.equal(document.getText(), original);
  return {headers: retained.headers, footerCells: retained.footer, widthEdit, selection: '4', restored: true};
}


async function verifyDynamicToolbar(document, view, ui, english) {
  const original = document.getText(), binding = '<DataPath>Rows</DataPath>';
  assert.ok(original.includes(binding));
  const steps = english ? [[24, 300, 1, 181], [36, 360, 2, 168], [40, 400, 3, 169], [62, 620, 4, 260]]
    : [[24, 300, 1, 225], [32, 320, 2, 164], [36, 360, 3, 165], [62, 620, 4, 260]];
  const grid = '.taxi-table-scroll', bar = '.taxi-table-command-bar', search = '.taxi-table-search';
  const selectors = [grid, bar, search];
  await ui.evaluate(`globalThis.__toolbarNodes = ${JSON.stringify(selectors)}.map(selector=>document.querySelector(selector));true`);
  const measure = () => ui.evaluate(`(() => {
    const [grid,bar,search] = ${JSON.stringify(selectors)}.map(selector=>document.querySelector(selector));
    const buttons = [...bar.querySelectorAll('.taxi-button')].filter(button=>button.offsetWidth);
    const r = node => node.getBoundingClientRect();
    const body = document.querySelector('.taxi-form-content');
    return [r(grid).width, r(grid).height, r(bar).width, buttons.length, r(search).width,
      body.scrollWidth-body.clientWidth, __toolbarNodes[0]===grid && __toolbarNodes[1]===bar && __toolbarNodes[2]===search];
  })()`);
  const results = [];
  try {
    for (const [width, toolbar, buttons, searchWidth] of steps) {
      const properties = `<Width>${width}</Width><HorizontalStretch>false</HorizontalStretch>`;
      await editFormSource(document, view, original.replace(binding, binding + properties));
      const expected = [width * 10, 452, toolbar, buttons, searchWidth, 0, true];
      await until(async () => (await measure()).every((value,index)=>value===expected[index]), `dynamic toolbar allocation at Width=${width}`);
      results.push(await measure());
      if (buttons === 1) {
        await ui.evaluate("document.querySelector('[data-table-more] > button').click()");
        assert.deepEqual(await ui.evaluate("[...document.querySelectorAll('[data-table-more] [role=menuitem]')].slice(0,2).map(item=>item.getAttribute('aria-label'))"),
          english ? ['Create','Copy'] : ['Создать','Скопировать']);
        const menuLabels = await ui.evaluate("[...document.querySelectorAll('[data-table-more] [role=menuitem]')].map(item=>item.getAttribute('aria-label'))");
        for (const label of english ? ['Configure list...','Restore default settings','Search management'] : ['Настроить список...','Установить стандартные настройки','Управление поиском'])
          assert.ok(menuLabels.includes(label), label);
        await ui.evaluate("document.querySelector('[data-table-more] [role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        await until(() => ui.evaluate("!document.querySelector('[data-table-more] [role=menu]')"), 'overflow menu closes with Escape');
      }
    }
    const withoutFilters = binding + '<Width>24</Width><HorizontalStretch>false</HorizontalStretch><ViewStatusLocation>None</ViewStatusLocation>';
    await editFormSource(document, view, original.replace(binding, withoutFilters));
    const expected = [240, 452, 240, english ? 0 : 1, english ? 234 : 171, 0, true];
    await until(async () => (await measure()).every((value,index)=>value===expected[index]), 'search fits without the filter row');
    results.push(await measure());
    const excluded = '<CommandSet><ExcludedCommand>Create</ExcludedCommand><ExcludedCommand>Copy</ExcludedCommand></CommandSet>';
    await editFormSource(document, view, original.replace(binding, binding + excluded));
    await until(() => ui.evaluate("!!document.querySelector('[data-table-more] > button')"), 'More survives excluded inline actions');
    await ui.evaluate("document.querySelector('[data-table-more] > button').click()");
    const labels = await ui.evaluate("[...document.querySelectorAll('[data-table-more] [role=menuitem]')].map(item=>item.getAttribute('aria-label'))");
    assert.ok(labels.includes(english ? 'Configure list...' : 'Настроить список...'));
    assert.ok(!labels.includes(english ? 'Create' : 'Создать'));
    assert.ok(!labels.includes(english ? 'Copy' : 'Скопировать'));
    await ui.evaluate("document.querySelector('[data-table-more] [role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  } finally {
    await editFormSource(document, view, original);
  }
  return results;
}

async function verifyDynamicPagination(document, view, ui) {
  const original = document.getText();
  const narrow = original.replace('<DataPath>Rows</DataPath>', '<DataPath>Rows</DataPath><Width>24</Width><HorizontalStretch>false</HorizontalStretch><CommandBarLocation>None</CommandBarLocation><SearchStringLocation>None</SearchStringLocation><SearchControlLocation>None</SearchControlLocation><ViewStatusLocation>None</ViewStatusLocation>');
  assert.notEqual(narrow, original);
  await ui.evaluate("globalThis.__dynamicGrid=document.querySelector('.taxi-table-content');true");
  const sizes = () => ui.evaluate(`(() => {
    const grid = document.querySelector('.taxi-table-scroll'), page = document.querySelector('.taxi-table-pagination');
    const rail = page?.querySelector('[role=scrollbar]');
    if (!rail) return;
    const [g,p,r] = [grid,page,rail].map(node => node.getBoundingClientRect());
    return [g.width, g.height, p.height, r.left-p.left, r.top-p.top, r.width, Number(rail.getAttribute('aria-valuemax'))];
  })()`);
  try {
    await editFormSource(document, view, narrow);
    await until(async () => (await sizes())?.[0] === 240, 'narrow list acquires a pagination scrollbar');
    assert.deepEqual(await sizes(), [240, 452, 21, 1, 2, 123, 71]);
    const key = name => ui.evaluate(`document.querySelector('.taxi-table-pagination [role=scrollbar]')
      .dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(name)}, bubbles:true})); true`);
    await key('End');
    assert.equal(await ui.evaluate('__dynamicGrid.scrollLeft'), 71);
    await key('Home');
    assert.equal(await ui.evaluate('__dynamicGrid.scrollLeft'), 0);
  } finally {
    await editFormSource(document, view, original);
  }
  await until(async () => !(await sizes()), 'restored list fits without its pagination scrollbar');
  assert.equal(await ui.evaluate("__dynamicGrid===document.querySelector('.taxi-table-content')"), true);
  return { width: 240, railWidth: 123, scrollRange: 71 };
}

async function verifyDynamicSearch(document, view, ui, english) {
  const original = document.getText();
  const source = '<CommandBar name="Separate" id="910"><CommandSource>Item.Rows</CommandSource></CommandBar>';
  const withoutString = original.replace('<ChildItems>', '<ChildItems>' + source)
    .replace('<DataPath>Rows</DataPath>', '<DataPath>Rows</DataPath><SearchStringLocation>None</SearchStringLocation><SearchControlLocation>CommandBar</SearchControlLocation>');
  const create = english ? 'Create' : 'Создать';
  const copy = english ? 'Copy' : 'Скопировать';
  const find = english ? 'Find...' : 'Найти...';
  const cancel = english ? 'Cancel search' : 'Отменить поиск';
  const search = english ? 'Search' : 'Поиск';
  const more = english ? 'More actions' : 'Еще';
  async function change(xml) {
    const edit = new vscode.WorkspaceEdit();
    const revision = view.snapshot.revision;
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), xml);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await until(() => view.snapshot.revision !== revision, 'dynamic list command layout recomposed');
  }
  const outer = "document.querySelector('.taxi-command-bar[data-table-commands]')";
  const inner = "document.querySelector('.taxi-table-command-bar')";
  const actions = bar => `[...(${bar}?.querySelectorAll('.taxi-button') ?? [])].map(button => button.getAttribute('aria-label'))`;
  await change(withoutString);
  await until(() => ui.evaluate(`!!${outer} && ${actions(outer)}.includes(${JSON.stringify(search)})`), 'search control moved to the linked bar');
  const projected = await ui.evaluate(actions(outer));
  assert.deepEqual(projected, [create, copy, find, cancel, search, more]);
  assert.deepEqual(await ui.evaluate(actions(inner)), [create, copy, find, cancel, more]);
  assert.equal(await ui.evaluate("!!document.querySelector('.taxi-table-search')"), false);
  await ui.evaluate(`${outer}.querySelector('[aria-label="${search}"]').click()`);
  await until(() => view.selected?.key?.value === '13', 'projected dropdown selects the actual SearchControlAddition');
  await ui.screenshot('table-dynamic-search-source-' + vscode.env.language + '.png');

  await change(withoutString.replace('<SearchStringLocation>None</SearchStringLocation>', '<SearchStringLocation>Top</SearchStringLocation>'));
  await until(() => ui.evaluate("!!document.querySelector('.taxi-table-search--top')"), 'dynamic list shows Top search');
  assert.deepEqual(await ui.evaluate(actions(outer)), [create, copy, search, more]);
  assert.deepEqual(await ui.evaluate(actions(inner)), [create, copy, more]);
  assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-table-search').length"), 1);

  await change(original);
  await until(() => ui.evaluate(`!${outer} && ${actions(inner)}.includes(${JSON.stringify(search)})`), 'removing the source bar restores the local search control');
  assert.deepEqual(await ui.evaluate(actions(inner)), [create, copy, search, more]);
  assert.equal(document.getText(), original);
  return { projected, sourceIdentity: '13', restored: true };
}
