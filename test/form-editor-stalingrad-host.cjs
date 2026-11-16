const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

const transactions = 'DataProcessors/РаботаСТранзакциями/Forms/ФормаСписка/Ext/Form.xml';
const loan = 'Documents/ВыдачаЗайма/Forms/ФормаДокумента/Ext/Form.xml';
const config = 'http://v8.1c.ru/8.1/data/enterprise/current-config';

const evaluate = (ui, body, ...args) => ui.evaluate('(' + body.toString() + ')(...' + JSON.stringify(args) + ')');
const click = (ui, selector) => evaluate(ui, selector => {
  const item = document.querySelector(selector);
  if (!item || item.disabled) return false;
  item.click();
  return true;
}, selector);
const button = (ui, label, scope = 'dialog') => evaluate(ui, (text, selector) => {
  const item = [...document.querySelectorAll(selector + ' button')].find(button => button.textContent.trim() === text && !button.disabled);
  if (!item) return false;
  item.click();
  return true;
}, label, scope);
const input = (ui, selector, value, eventName = 'input') => evaluate(ui, (selector, value, eventName) => {
  const item = document.querySelector(selector);
  if (!item) return false;
  item.value = value;
  if (item.value !== value) return false;
  item.dispatchEvent(new Event(eventName, { bubbles: true }));
  return true;
}, selector, value, eventName);

async function review(ui) {
  await until(() => button(ui, 'Проверить изменения'), 'review');
  await until(async () => {
    const state = await ui.evaluate("({review:!!document.querySelector('.form-edit-review'),error:document.querySelector('dialog [role=alert] p')?.textContent})");
    assert.ok(!state.error, state.error);
    return state.review;
  }, 'preview XML');
}

async function save(ui) {
  await until(() => button(ui, 'Сохранить форму'), 'save');
  await until(() => ui.evaluate("!document.querySelector('dialog[open]') && !!document.querySelector('[data-edit-action=appearance]')"), 'viewer updated');
}

async function replay(ui, direction, read, expected) {
  await until(() => click(ui, '[data-form-history=' + direction + ']'), direction + ' available');
  await until(async () => await read() === expected, direction + ' restores exact bytes');
  await until(() => ui.evaluate("!!document.querySelector('.form-shell[aria-busy=false] [data-edit-action=appearance]')"), 'viewer follows history');
}

async function geometry(ui, mode) {
  return await untilSample(async () => {
    const dimensions = await ui.evaluate("(() => {" +
      "const shell=document.querySelector('.form-shell'),inspector=document.querySelector('.form-inspectors'),view=document.querySelector('.preview-scroll'),dialog=document.querySelector('dialog[open]');" +
      "return {width:shell.clientWidth,height:shell.clientHeight,mode:inspector.dataset.inspectorLayout,viewWidth:view.clientWidth,inspectorHeight:inspector.clientHeight," +
      "dialogFits:!dialog||dialog.getBoundingClientRect().width<=window.innerWidth&&dialog.getBoundingClientRect().height<=window.innerHeight};})()");
    return dimensions?.mode === mode && dimensions.viewWidth > 0 && dimensions.dialogFits ? dimensions : null;
  }, 'form fits ' + mode);
}

async function untilSample(read, note) {
  let sample;
  await until(async () => { sample = await read(); return !!sample; }, note);
  return sample;
}

async function resize(ui, width, height, mode) {
  const owner = await ui.nativeWindow();
  await ui.resizeWindow(owner.targetId, { width, height });
  await ui.screenshot('resize.png', true);
  return geometry(ui, mode);
}

async function editTransactions(ui, read) {
  const original = await read();
  const wide = await resize(ui, 1120, 840, 'columns');
  await until(() => click(ui, '[data-edit-action=appearance]'), 'appearance button');
  await until(() => input(ui, 'dialog [data-form-edit-scope]', '1', 'change'), 'select transaction list');
  assert.equal(await ui.evaluate("document.querySelector('[data-form-edit-scope]').selectedOptions[0].textContent"), 'Транзакции');
  assert.ok(await button(ui, 'Добавить правило'));
  assert.ok(await input(ui, 'dialog .form-edit-settings select', 'background', 'change'));
  assert.ok(await button(ui, 'Добавить', '.form-edit-settings'));
  assert.ok(await input(ui, '[data-format=background] input[type=text]', '#DDEECC'));
  const narrow = await resize(ui, 450, 650, 'compactStacked');
  assert.ok(narrow.width < wide.width);
  assert.equal(await ui.evaluate("document.querySelector('[data-format=background] input[type=text]').value"), '#DDEECC');
  assert.ok(await button(ui, 'Условия', '.form-edit-tabs'));
  assert.ok(await button(ui, 'Добавить условие'));
  assert.ok(await input(ui, 'dialog .form-edit-compare input[list]', 'НомерЗаказа'));
  assert.ok(await input(ui, 'dialog .form-edit-compare select', 'NotInList', 'change'));
  for (const [index, value] of ['ESKA-A', 'ESKA-B'].entries()) {
    assert.ok(await button(ui, 'Добавить значение'));
    assert.ok(await input(ui, '.form-edit-list-value:nth-child(' + (index + 1) + ') input', value));
  }
  await review(ui);
  assert.equal(await read(), original);
  await save(ui);
  const saved = await read();
  assert.match(saved, /<dcsset:comparisonType>NotInList<\/dcsset:comparisonType>[^]*?>ESKA-A<\/dcsset:right>[^]*?>ESKA-B<\/dcsset:right>/);
  await replay(ui, 'undo', read, original);
  await replay(ui, 'redo', read, saved);
  await replay(ui, 'undo', read, original);
  return { wide, narrow, rules: 'dynamic list, two values, exact undo and redo' };
}

async function editLoan(ui, read) {
  const original = await read();
  const wide = await resize(ui, 1120, 850, 'columns');
  await until(() => click(ui, '[data-edit-action=addDefinition]'), 'new data attribute');
  await until(() => input(ui, 'dialog input[required]', 'EskaAcceptanceType'), 'attribute name');
  assert.ok(await input(ui, 'dialog .form-type-editor input[type=search]', 'ВыдачаЗайма'));
  assert.ok(await input(ui, 'dialog .form-type-editor select[aria-label]', JSON.stringify([config, 'DocumentRef.ВыдачаЗайма']), 'change'));
  assert.ok(await input(ui, 'dialog .form-type-editor select[aria-label]', JSON.stringify(['http://www.w3.org/2001/XMLSchema', 'decimal']), 'change'));
  assert.ok(await input(ui, 'dialog [data-type-qualifier=Digits]', '18'));
  assert.ok(await input(ui, 'dialog [data-type-qualifier=FractionDigits]', '3'));
  const compact = await resize(ui, 620, 730, 'compact');
  assert.equal(await ui.evaluate("document.querySelector('[data-type-qualifier=FractionDigits]').value"), '3');
  await review(ui); await save(ui);
  assert.match(await read(), /name="EskaAcceptanceType"[^]*?DocumentRef\.ВыдачаЗайма[^]*?FractionDigits>3/);
  await replay(ui, 'undo', read, original);
  await resize(ui, 1120, 850, 'columns');
  await until(() => evaluate(ui, () => {
    const tree = [...document.querySelectorAll('[data-form-tree-node]')];
    const where = name => tree.find(row => row.querySelector('.form-truncate')?.textContent.trim() === name);
    const from = where('Номер'), to = where('Дата');
    if (!from?.draggable || !to) return false;
    const dataTransfer = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    const rectangle = to.getBoundingClientRect();
    const event = { bubbles: true, cancelable: true, dataTransfer, clientY: rectangle.bottom - 1 };
    to.dispatchEvent(new DragEvent('dragover', event));
    if (to.dataset.formDrop !== 'after') return false;
    to.dispatchEvent(new DragEvent('drop', event));
    return true;
  }), 'tree drag targets ready and accepted');
  await until(() => ui.evaluate("!!document.querySelector('.form-edit-review')"), 'drag preview in real form');
  await save(ui);
  const moved = await read();
  assert.ok(moved.indexOf('<InputField name="Дата"') < moved.indexOf('<InputField name="Номер"'));
  await replay(ui, 'undo', read, original);
  await until(() => evaluate(ui, () => {
    const rows = [...document.querySelectorAll('[data-form-tree-node]')];
    const key = name => rows.find(row => row.querySelector('.form-truncate')?.textContent.trim() === name)?.dataset.formTreeNode;
    const element = name => document.querySelector('[data-element="' + CSS.escape(key(name)) + '"]');
    const from = element('Номер'), to = element('Дата');
    if (!from || !to) return false;
    from.click();
    if (!from.draggable) return false;
    const dataTransfer = new DataTransfer();
    const rect = to.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, dataTransfer, clientX: rect.right - 1, clientY: rect.bottom - 1 };
    from.dispatchEvent(new DragEvent('dragstart', options));
    to.dispatchEvent(new DragEvent('dragover', options));
    if (!to.dataset.formDrop?.startsWith('after')) return false;
    to.dispatchEvent(new DragEvent('drop', options));
    return true;
  }), 'canvas drag targets ready and accepted');
  await until(async () => {
    const result = await ui.evaluate("({review:!!document.querySelector('.form-edit-review'),error:document.querySelector('dialog [role=alert] p')?.textContent})");
    assert.ok(!result.error, result.error);
    return result.review;
  }, 'canvas drag preview');
  await save(ui);
  assert.equal(await read(), moved);
  await replay(ui, 'undo', read, original);
  return { wide, compact, edits: 'composite metadata reference, matching tree and canvas drag, exact undo' };
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const root = process.env.ESKA_PERF_PROJECT;
  assert.ok(root && path.isAbsolute(root) && path.basename(root).startsWith('editor-stalingrad.'));
  assert.ok(vscode.env.language.startsWith('ru'));
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results = [];
  for (const [relative, run] of [[transactions, editTransactions], [loan, editLoan]]) {
    const file = path.join(root, 'src', relative);
    const read = () => fs.readFile(file, 'utf8');
    const original = await read();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const view = await untilSample(() => [...explorer.formPreview.views.values()].find(view => view.path === file && view.phase === 'ready'), 'complex form ready');
    const window = view.frames.get('main').panel;
    const ui = await frame({ state: { title: window.title } });
    try {
      results.push(await run(ui, read));
      assert.equal(await read(), original);
    } finally {
      ui.close();
      window.dispose();
      if (await read() !== original) await fs.writeFile(file, original);
    }
  }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'stalingrad-form-editor', results }));
};
