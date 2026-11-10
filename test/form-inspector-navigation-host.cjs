const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath, editFormSource } = require('./webview-host.cjs');

const field = value => `.form-data-row[data-form-data-path=${JSON.stringify(value)}]`;
const lookup = selector => `document.querySelector(${JSON.stringify(selector)})`;
const rowFor = id => `.form-tree-row[id$=":current:${id}"]`;
const scrollTop = '.preview-scroll';
const title = '.form-property-context h3';

async function search(ui, value) {
  await ui.evaluate(`(() => {
    const input = document.querySelector('.form-inspector-search input');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
}
const click = (ui, selector) => ui.evaluate(`${lookup(selector)}.click()`);
const activePage = ui => ui.evaluate("document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent");
const waitFor = (ui, selector) => until(() => ui.evaluate(`!!${lookup(selector)}`), selector);

async function themeChecks(ui, label) {
  const config = vscode.workspace.getConfiguration('workbench');
  const old = config.get('colorTheme');
  const colors = [];
  try {
    for (const [name, kind] of [
      ['Default Dark Modern', 'dark'], ['Default Light Modern', 'light'],
      ['Default High Contrast', 'high-contrast'], ['Default High Contrast Light', 'high-contrast-light'],
    ]) {
      await config.update('colorTheme', name, vscode.ConfigurationTarget.Global);
      await until(() => ui.evaluate(`document.body.classList.contains('vscode-${kind}')`), `native ${kind} theme applied`);
      const sample = await ui.evaluate(`(() => {
        const shell=document.querySelector('.form-shell'), header=document.querySelector('.form-pane-heading'),
          input=document.querySelector('.form-inspector-search'), preview=document.querySelector('.taxi-form-frame');
        return [getComputedStyle(shell).backgroundColor,getComputedStyle(header).backgroundColor,
          getComputedStyle(input).backgroundColor,preview && getComputedStyle(preview).backgroundColor];
      })()`);
      colors.push(sample);
      const artwork = await ui.evaluate(`(() => {
        const icon = document.querySelector('.form-tree-row.selected [data-form-artwork="field"]');
        return icon && getComputedStyle(icon).backgroundImage;
      })()`);
      const assetTheme = kind === 'high-contrast' ? 'contrast' : kind === 'high-contrast-light' ? 'contrast-light' : kind;
      assert.ok(artwork?.includes('/resources/icons/' + assetTheme + '/attribute.svg'), artwork);
      await ui.screenshot(`inspector-${kind}-${label}.png`);
    }
  } finally { await config.update('colorTheme', old, vscode.ConfigurationTarget.Global); }
  assert.notDeepEqual(colors[0].slice(0, 3), colors[1].slice(0, 3), 'inspector follows VS Code theme');
  assert.ok(colors.every(sample => sample[3] === colors[0][3]), 'form profile background stays native');
  return colors;
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), form = fixture.form;
  const before = await fs.readFile(form.path);
  const explorer = await vscode.extensions.all.find(ext => ext.packageJSON.name === 'eska-explorer').activate();
  const service = explorer.formPreview, ru = vscode.env.language.startsWith('ru');
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  async function open(input = document) {
    await vscode.window.showTextDocument(input);
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const current = () => [...service.views.values()].find(view => sameSourcePath(view.path, input.uri.fsPath));
    await until(() => current()?.phase === 'ready', 'inspector form opened');
    const view = current(), main = view.frames.get('main');
    const ui = await frame({ state: { title: main.panel.title } });
    await waitFor(ui, '.form-inspector-search input');
    return { view, main, ui };
  }
  const { view, main, ui } = await open();
  const snapshot = view.snapshot;
  assert.ok(snapshot.model.dataFields?.some(row => row.path.join('.') === 'Object.Lines.Quantity'), 'unbound metadata child delivered');
  const dimensions = await ui.evaluate(`(() => {
    const area=document.querySelector('.form-inspectors'), header=document.querySelector('.form-inspector-header');
    return {mode:area.dataset.inspectorLayout,top:header.getBoundingClientRect().top,
      topTabs:[...document.querySelectorAll('.form-pane .form-tabs')].every(tabs=>
        tabs.getBoundingClientRect().bottom<=tabs.parentElement.querySelector('.form-tree,.form-data-grid').getBoundingClientRect().top),
      theme:document.body.className};
  })()`);
  assert.equal(dimensions.mode, 'columns');
  assert.equal(dimensions.topTabs, true);
  const annotated = snapshot.model.dataFields.find(row => row.path.join('.') === 'Object.Ref')?.caption !== undefined;
  if (process.env.ESKA_FORM_REQUIRE_INSPECTOR_PRESENTATION === '1') assert.equal(annotated, true);
  const expanded = async (target, path) => target.evaluate(`${lookup(field(path))}?.getAttribute('aria-expanded')`);
  const shown = (target, path) => target.evaluate(`!!${lookup(field(path))}`);
  const expander = path => field(path) + ' .form-tree-expander';
  await waitFor(ui, field('Object'));
  assert.equal(await expanded(ui, 'Object'), 'false');
  assert.equal(await shown(ui, 'Object.Ref'), false);
  await click(ui, rowFor('2'));
  await waitFor(ui, '.form-context-facts .form-handler');
  await click(ui, '.form-context-facts .form-handler');
  await waitFor(ui, field('Object.Amount'));
  assert.equal(view.inspectorState?.ui.dataFolded['attributes:Object'], undefined);
  await search(ui, 'Object.Lines.Quantity');
  await waitFor(ui, field('Object.Lines.Quantity'));
  await search(ui, '');
  await until(async () => (await expanded(ui, 'Object')) === 'false', 'clear search restores collapsed groups');
  await click(ui, expander('Object'));
  await waitFor(ui, field('Object.Amount'));
  assert.equal(await expanded(ui, 'Object.Lines'), 'false');
  await click(ui, field('Object.Lines'));
  await ui.evaluate(`document.querySelector('.form-data-grid').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  await waitFor(ui, field('Object.Lines.Quantity'));
  const offsets = await ui.evaluate(`['Object','Object.Lines','Object.Lines.Quantity','Object.Ref'].map(path => {
    const row = [...document.querySelectorAll('.form-data-row')].find(row => row.dataset.formDataPath === path);
    return row.querySelector('[data-form-artwork]').getBoundingClientRect().left;
  })`);
  assert.deepEqual(offsets.map(x => x - offsets[0]), [0, 12, 24, 12], 'each depth reserves the expander and one indentation step');
  for (const [path, localized, english] of [
    ['Object.Ref', 'Ссылка', 'Reference'], ['Object.Date', 'Дата', 'Date'],
    ['Object.DeletionMark', 'Пометка удаления', 'Deletion mark'],
  ]) {
    const expected = annotated ? (ru ? localized : english) : path.split('.').at(-1);
    assert.equal(await ui.evaluate(`${lookup(field(path))}.querySelector('.form-data-name > .form-truncate').textContent`), expected);
  }
  assert.equal(await ui.evaluate(`${lookup(field('Date'))}.querySelector('.form-data-name > .form-truncate').textContent`), 'Date');
  if (ru && annotated) {
    await search(ui, 'Ссылка');
    await waitFor(ui, field('Object.Ref'));
    await search(ui, '');
    await waitFor(ui, field('Object.Lines.Quantity'));
  }
  const type = await ui.evaluate(`${lookup(field('Object.Amount'))}.querySelector('td:last-child').textContent.trim()`);
  assert.equal(type, ru ? 'Число (15, 2)' : 'Number (15, 2)');
  assert.equal(await ui.evaluate(`${lookup(field('Object.Ref'))}.querySelector('td:last-child').textContent.trim()`),
    (ru ? 'ДокументСсылка' : 'DocumentRef') + '.InspectorReceipt');
  await search(ui, 'String 100');
  if (ru) await search(ui, 'Строка 100');
  await waitFor(ui, field('Amount'));
  assert.equal(await ui.evaluate(`!!${lookup(field('Object.Amount'))}`), false, 'same short name keeps separate search results');
  await search(ui, 'Object.Amount');
  await waitFor(ui, rowFor('2'));
  await waitFor(ui, rowFor('8'));
  assert.equal(await ui.evaluate(`!!${lookup(rowFor('1'))}`), true, 'element search retains its parent');
  await click(ui, rowFor('2'));
  await until(() => view.selected?.key.value === '2', 'element selected');
  await waitFor(ui, field('Object.Amount') + '.related');
  assert.equal(await ui.evaluate(`${lookup(title)}.textContent`), 'Name');
  const fontProperty = '[data-property-name="Font"]';
  await waitFor(ui, fontProperty + ' .form-property-qualifiers');
  if (annotated) {
    const font = await ui.evaluate(`(() => {
      const area = ${lookup(fontProperty)};
      return { ref: area.querySelector('[title="style:normaltextfont"]').textContent,
        flags: Array.from(area.querySelectorAll('input[type=checkbox]'), input => [input.checked,input.disabled]) };
    })()`);
    assert.equal(font.ref, ru ? 'Обычный шрифт текста' : 'Normal text font');
    assert.deepEqual(font.flags, [[true,true],[false,true]]);
  }
  const future = '[data-property-name="FutureSettings"] details';
  await waitFor(ui, future);
  await click(ui, future + ' > summary');
  await until(() => ui.evaluate(`${lookup(future)}.querySelectorAll('input').length === 2`), 'only typed nested booleans are checkboxes');
  const nested = await ui.evaluate(`(() => {
    const area = ${lookup(future)};
    return { flags: Array.from(area.querySelectorAll('input'), input => [input.checked,input.disabled]),
      literal: area.querySelector('span[title="false"]').textContent };
  })()`);
  assert.deepEqual(nested, { flags: [[true,true],[false,true]], literal: 'false' });
  await waitFor(ui, '[data-palette-id="platform:HorizontalStretch"]');
  const automatic = await ui.evaluate(`(() => {
    const row = document.querySelector('[data-palette-id="platform:HorizontalStretch"]');
    return row && [row.querySelector('td').textContent, !!row.querySelector('input')];
  })()`);
  assert.deepEqual(automatic, [ru ? 'Авто' : 'Default', false]);
  const initialPage = await activePage(ui);
  const scroll = await ui.evaluate(`${lookup(scrollTop)}.scrollTop`);
  await click(ui, field('Object.Amount'));
  await until(() => ui.evaluate(`${lookup(title)}.textContent==='Amount'`), 'properties follow the data selection');
  const uses = await ui.evaluate("[...document.querySelectorAll('.form-usage-list button')].map(button=>button.textContent.trim())");
  assert.deepEqual(uses, ['Name', 'SecondAmount']);
  assert.equal(await ui.evaluate("!!document.querySelector('.form-type-members')"), false, 'type details are mounted on demand');
  await click(ui, '.form-type-details > summary');
  await waitFor(ui, '.form-type-facts');
  const numericFacts = await ui.evaluate(`Array.from(document.querySelectorAll('.form-type-facts > div'),
    row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])`);
  assert.deepEqual(numericFacts, ru ? [
    ['Всего разрядов', '15'], ['Знаков после запятой', '2'], ['Допустимый знак', 'Неотрицательный'],
  ] : [
    ['Total digits', '15'], ['Fraction digits', '2'], ['Allowed sign', 'Nonnegative'],
  ]);
  assert.equal(await ui.evaluate("document.querySelector('.form-type-source details').open"), false);
  await click(ui, '.form-type-source summary');
  assert.equal(await ui.evaluate("document.querySelector('.form-type-source details').open"), true);
  const technical = await ui.evaluate("document.querySelector('.form-type-source pre').textContent");
  assert.match(technical, /AllowedSign = Nonnegative/u);
  await click(ui, '.form-type-source button');
  await until(async () => (await vscode.env.clipboard.readText()).replace(/\r\n/gu, '\n') === technical, 'complete technical type copied');
  await click(ui, '.form-type-source summary');
  await click(ui, '.form-usage-list button:last-child');
  await until(() => view.selected?.key.value === '8', 'second use explicitly selected');
  assert.equal(await activePage(ui), initialPage, 'ordinary selection does not switch preview pages');
  assert.equal(await ui.evaluate(`${lookup(scrollTop)}.scrollTop`), scroll);
  await click(ui, '.form-property-actions button:first-child');
  await until(async () => await activePage(ui) === 'Other', 'explicit reveal opens the enclosing page');
  await search(ui, '');
  const exactVisual = await ui.evaluate(`(() => {
    const field=[...document.querySelectorAll('.taxi-element[data-element]')].find(item=>item.dataset.element.endsWith(':current:8'));
    return field?.classList.contains('taxi-selected');
  })()`);
  assert.equal(exactVisual, true);
  await ui.evaluate("document.querySelector('.taxi-element[data-element$=\":current:2\"]').click()");
  await until(() => view.selected?.key.value === '2', 'visual selection updates the tree');
  const themes = await themeChecks(ui, vscode.env.language);

  await ui.evaluate("document.querySelector('#root').style.width='530px'");
  await until(() => ui.evaluate("document.querySelector('.form-inspectors').dataset.inspectorLayout==='compact'"), 'compact layout uses webview width');
  await click(ui, '.form-inspector-header [role=tab]:last-child');
  await until(() => ui.evaluate("!document.querySelector('.form-pane--data').hidden && document.querySelector('.form-pane--structure').hidden"), 'compact pane switch');
  await search(ui, 'Quantity');
  await waitFor(ui, field('Object.Lines.Quantity'));
  await click(ui, field('Object.Lines.Quantity'));
  await click(ui, '.form-property-actions button');
  await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === form.owner
    && vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection).includes('<Name>Quantity</Name>'), 'unbound metadata field navigates to its declaration');
  main.panel.reveal();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'native detached preview ready');
  await until(() => ui.evaluate("document.querySelector('.form-inspectors').dataset.inspectorLayout==='columns' && !document.querySelector('.preview-scroll')"), 'detached inspection keeps three columns at the same narrow width');
  const narrowColumns = await ui.evaluate(`(() => {
    const panels = [...document.querySelectorAll('.form-inspectors > .form-pane')];
    const areas = panels.map(panel => panel.getBoundingClientRect());
    return areas.length === 3 && areas.every((area, index) => area.width > 0 && area.top === areas[0].top
      && (!index || area.left >= areas[index - 1].right));
  })()`);
  assert.equal(narrowColumns, true);
  assert.equal(await ui.evaluate(`${lookup(title)}.textContent`), 'Quantity');
  assert.equal(await ui.evaluate("document.querySelector('.form-inspector-search input').value"), 'Quantity');
  const floating = await frame({ detached: true, state: { title: view.frames.get('preview').panel.title } });
  await waitFor(floating, '.taxi-preview');
  assert.equal(await floating.evaluate("!!document.querySelector('.form-inspectors')"), false);
  await floating.evaluate(`document.querySelector('.taxi-element[data-element$=":current:2"]').click()`);
  await until(() => view.selected?.key.value === '2' && ui.evaluate(`${lookup(title)}.textContent==='Name'`), 'selection from the separate form updates the inspector');
  await search(ui, 'Object.Amount');
  await waitFor(ui, field('Object.Amount'));
  await click(ui, field('Object.Amount'));
  await waitFor(ui, '.form-type-facts');
  const typeFit = await ui.evaluate(`(() => {
    const props = document.querySelector('.form-property-scroll');
    return props.scrollWidth <= props.clientWidth;
  })()`);
  assert.equal(typeFit, true);
  await ui.evaluate("document.querySelector('#root').style.width='100%'");
  await ui.screenshot(`inspector-type-number-${vscode.env.language}.png`);
  await search(ui, 'MixedType');
  await waitFor(ui, field('MixedType'));
  await click(ui, field('MixedType'));
  await until(() => ui.evaluate("document.querySelectorAll('.form-type-member').length === 3"), 'composite type shows its three members');
  const composite = await ui.evaluate(`Array.from(document.querySelectorAll('.form-type-member'), row => ({
    label: row.querySelector('strong').textContent,
    category: row.querySelector('small')?.textContent.replace(/\.$/, '') ?? null,
    values: Array.from(row.querySelectorAll('dd'), value => value.textContent),
  }))`);
  assert.deepEqual(composite, [
    { label: ru ? 'Строка' : 'String', category: null, values: ['80', ru ? 'Переменная' : 'Variable'] },
    { label: ru ? 'Дата' : 'Date', category: null, values: [ru ? 'Время' : 'Time'] },
    { label: 'InspectorReceipt', category: ru ? 'ДокументСсылка' : 'DocumentRef', values: [] },
  ]);
  assert.equal(await ui.evaluate(`!!document.querySelector('.form-properties [data-property-name="Type"]')`), false,
    'the main type declaration is presented once');
  await search(ui, '');
  await ui.screenshot(`inspector-type-composite-${vscode.env.language}.png`);
  await search(ui, 'Quantity');
  await waitFor(ui, field('Object.Lines.Quantity'));
  await click(ui, field('Object.Lines.Quantity'));
  floating.close();
  await service.receive(view, view.frames.get('preview'), { type: 'dock' });
  await waitFor(ui, '.preview-scroll');
  await ui.evaluate("document.querySelector('#root').style.width='100%'");
  await until(() => ui.evaluate("document.querySelector('.form-inspectors').dataset.inspectorLayout==='columns'"), 'wide panels restored');
  await ui.evaluate(`for (const selector of ['.form-inspector-sash--structure','.form-data-splitter']) {
    const splitter=document.querySelector(selector);
    splitter.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  }`);
  const dimensionsBefore = await ui.evaluate(`[
    document.querySelector('.form-inspector-sash--structure').getAttribute('aria-valuenow'),
    document.querySelector('.form-data-splitter').getAttribute('aria-valuenow')
  ]`);
  await until(() => view.inspectorState?.ui.search === 'Quantity' && view.inspectorState.ui.dataWidth === Number(dimensionsBefore[1]), 'workspace preferences delivered');
  assert.equal(view.snapshot, snapshot, 'inspection does not refresh the model');
  await search(ui, '');
  await waitFor(ui, field('Object.Lines.Quantity'));
  await editFormSource(document, view, form.text.replace('Second amount', 'Second amount after edit'));
  await until(() => ui.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'dirty revision reached inspector');
  assert.equal(await expanded(ui, 'Object'), 'true');
  assert.equal(await expanded(ui, 'Object.Lines'), 'true');
  assert.equal(await shown(ui, 'Object.Lines.Quantity'), true);
  await editFormSource(document, view, form.text);
  await search(ui, 'Quantity');
  await until(() => view.inspectorState?.ui.search === 'Quantity', 'search restored for close and reopen');
  assert.deepEqual(ui.scriptErrors(), []);
  ui.close();
  main.panel.dispose();
  await until(() => service.views.size === 0, 'original inspector closed');
  await Promise.all([...service.closing]);
  const reopened = await open();
  await until(() => reopened.ui.evaluate(`document.querySelector('.form-inspector-search input').value==='Quantity'
    && ${lookup(title)}.textContent==='Quantity'`), 'context and search restored across opening');
  assert.deepEqual(await reopened.ui.evaluate(`[
    document.querySelector('.form-inspector-sash--structure').getAttribute('aria-valuenow'),
    document.querySelector('.form-data-splitter').getAttribute('aria-valuenow')
  ]`), dimensionsBefore);
  await search(reopened.ui, '');
  await waitFor(reopened.ui, field('Object.Lines.Quantity'));
  assert.equal(await expanded(reopened.ui, 'Object'), 'true');
  assert.equal(await expanded(reopened.ui, 'Object.Lines'), 'true');
  assert.deepEqual(reopened.ui.scriptErrors(), []);
  reopened.ui.close();
  reopened.main.panel.dispose();
  await until(() => service.views.size === 0, 'reopened inspector closed');
  await Promise.all([...service.closing]);
  const largeDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(form.second));
  const large = await open(largeDocument);
  await waitFor(large.ui, '.form-data-row');
  const mounted = await large.ui.evaluate(`[
    document.querySelectorAll('.form-tree-row').length,document.querySelectorAll('.form-data-row').length
  ]`);
  assert.ok(mounted.every(count => count > 0 && count < 100), 'only visible rows are mounted');
  const largeRevision = large.view.snapshot.revision;
  await search(large.ui, 'DeepField2249');
  await large.ui.evaluate(`document.querySelector('.form-tree').dispatchEvent(new KeyboardEvent('keydown', {key:'End',bubbles:true}))`);
  await waitFor(large.ui, rowFor('3249'));
  assert.equal(await large.ui.evaluate(`${lookup(rowFor('3249'))}.getAttribute('aria-level')`), '25');
  await click(large.ui, rowFor('3249'));
  await until(() => large.view.selected?.key.value === '3249', 'deep element selected');
  assert.equal(large.view.snapshot.revision, largeRevision);
  assert.deepEqual(large.ui.scriptErrors(), []);
  large.ui.close();
  await explorer.shutdown();
  assert.deepEqual(await fs.readFile(form.path), before);
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, locale: vscode.env.language, themes, dimensions, dimensionsBefore, uses,
    compact: true, separatePreview: true, sameSnapshot: true, modelData: true, workspaceState: true, mounted,
    localizedStandardFields: annotated, threeLevelIndent: true, savedDataExpansion: true, typedProperties: true,
  }));
};
