const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

const cases = [
  { form: 'DataProcessors/РаботаСТранзакциями/Forms/ФормаСписка/Ext/Form.xml', key: 'Title' },
  { form: 'Documents/ВыдачаЗайма/Forms/ФормаДокумента/Ext/Form.xml', target: 'ГруппаДанные', key: 'United' },
];
const dom = (ui, fn, ...args) => ui.evaluate('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')');

async function edit(ui, key) {
  return dom(ui, key => {
    const control = document.querySelector('[data-edit-property="' + key + '"] input');
    if (!control) return false;
    control.focus();
    if (control.type === 'checkbox') {
      control.checked = !control.checked;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      control.value = 'Проверка черновика';
      control.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }, key);
}

const action = id => '[data-edit-action="' + id + '"]';
const click = (ui, selector) => dom(ui, selector => {
  const button = document.querySelector(selector);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}, selector);
const button = (ui, label, scope = 'dialog') => dom(ui, (label, scope) => {
  const button = [...document.querySelectorAll(scope + ' button')].find(item => item.textContent.trim() === label && !item.disabled);
  if (!button) return false;
  button.click();
  return true;
}, label, scope);
const input = (ui, selector, value, eventName = 'input') => dom(ui, (selector, value, type) => {
  const control = document.querySelector(selector);
  if (!control) return false;
  control.value = value;
  if (control.value !== value) return false;
  control.dispatchEvent(new Event(type, { bubbles: true }));
  return true;
}, selector, value, eventName);

async function applyDialog(ui, view) {
  await until(() => click(ui, 'dialog button[type=submit][form=form-edit-draft]'), 'accept compound change');
  await until(async () => {
    const failure = await dom(ui, () => document.querySelector('dialog [role=alert] p')?.textContent);
    assert.ok(!failure, failure);
    return view.editor.overlay?.text && dom(ui, () => !document.querySelector('dialog[open]'));
  }, 'compound change enters the draft');
}

async function editHistory(ui, name, read, expected) {
  await until(() => click(ui, action(name)), name + ' available');
  await until(async () => await read() === expected, name + ' keeps exact XML bytes');
}

async function saveDraft(ui, view, read, original) {
  const changed = view.editor.overlay?.text;
  assert.ok(changed && changed !== original);
  assert.equal(await read(), original);
  await editHistory(ui, 'save', read, changed);
  return changed;
}

async function editTransactions(ui, view, read, original) {
  await until(() => click(ui, action('formMenu')), 'form menu available');
  await until(() => click(ui, action('appearance')), 'open conditional appearance');
  await until(() => input(ui, 'dialog [data-form-edit-scope]', '1', 'change'), 'choose transaction list');
  assert.equal(await dom(ui, () => document.querySelector('[data-form-edit-scope]').selectedOptions[0].textContent), 'Транзакции');
  assert.ok(await button(ui, 'Добавить правило'));
  assert.ok(await input(ui, 'dialog .form-edit-settings select', 'background', 'change'));
  assert.ok(await button(ui, 'Добавить', '.form-edit-settings'));
  assert.ok(await input(ui, '[data-format=background] input[type=text]', '#DDEECC'));
  await dom(ui, () => { document.getElementById('root').style.width = '480px'; });
  assert.equal(await dom(ui, () => document.querySelector('[data-format=background] input[type=text]').value), '#DDEECC');
  assert.ok(await button(ui, 'Условия', '.form-edit-tabs'));
  assert.ok(await button(ui, 'Добавить условие'));
  assert.ok(await input(ui, 'dialog .form-edit-compare input[list]', 'НомерЗаказа'));
  assert.ok(await input(ui, 'dialog .form-edit-compare select', 'NotInList', 'change'));
  for (const [index, value] of ['ESKA-A', 'ESKA-B'].entries()) {
    assert.ok(await button(ui, 'Добавить значение'));
    assert.ok(await input(ui, '.form-edit-list-value:nth-child(' + (index + 1) + ') input', value));
  }
  await dom(ui, () => { document.getElementById('root').style.width = ''; });
  await applyDialog(ui, view);
  assert.match(view.editor.overlay.text, /<dcsset:comparisonType>NotInList<\/dcsset:comparisonType>[^]*?>ESKA-A<\/dcsset:right>[^]*?>ESKA-B<\/dcsset:right>/);
  const saved = await saveDraft(ui, view, read, original);
  await editHistory(ui, 'undo', read, original);
  await editHistory(ui, 'redo', read, saved);
  await editHistory(ui, 'undo', read, original);
  return 'conditional appearance for a dynamic list, two typed values, exact save and history';
}

async function editLoan(ui, view, read, original) {
  const config = 'http://v8.1c.ru/8.1/data/enterprise/current-config';
  await until(() => click(ui, action('addDefinition')), 'open data attribute editor');
  await until(() => input(ui, 'dialog input[required]', 'EskaAcceptanceType'), 'attribute name');
  assert.ok(await input(ui, 'dialog .form-type-editor input[type=search]', 'ВыдачаЗайма'));
  assert.ok(await input(ui, 'dialog .form-type-editor select[aria-label]', JSON.stringify([config, 'DocumentRef.ВыдачаЗайма']), 'change'));
  assert.ok(await input(ui, 'dialog .form-type-editor select[aria-label]', JSON.stringify(['http://www.w3.org/2001/XMLSchema', 'decimal']), 'change'));
  assert.ok(await input(ui, 'dialog [data-type-qualifier=Digits]', '18'));
  assert.ok(await input(ui, 'dialog [data-type-qualifier=FractionDigits]', '3'));
  await dom(ui, () => { document.getElementById('root').style.width = '620px'; });
  assert.equal(await dom(ui, () => document.querySelector('[data-type-qualifier=FractionDigits]').value), '3');
  await dom(ui, () => { document.getElementById('root').style.width = ''; });
  await applyDialog(ui, view);
  assert.match(view.editor.overlay.text, /name="EskaAcceptanceType"[^]*?DocumentRef\.ВыдачаЗайма[^]*?FractionDigits>3/);
  await saveDraft(ui, view, read, original);
  await editHistory(ui, 'undo', read, original);

  let previous;
  for (const canvas of [false, true]) {
    await until(() => dom(ui, canvas => {
      const rows = [...document.querySelectorAll('[data-form-tree-node]')];
      function find(name) {
        const row = rows.find(row => row.querySelector(':scope > .form-truncate')?.textContent.trim() === name);
        return canvas && row ? document.querySelector('[data-element="' + CSS.escape(row.dataset.formTreeNode) + '"]') : row;
      }
      const from = find('Номер'), to = find('Дата');
      if (!from || !to) return false;
      if (canvas) from.click();
      if (!from.draggable) return false;
      const transfer = new DataTransfer(), rect = to.getBoundingClientRect();
      const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 1, clientY: rect.bottom - 1 };
      from.dispatchEvent(new DragEvent('dragstart', options));
      to.dispatchEvent(new DragEvent('dragover', options));
      const after = to.dataset.formDrop?.startsWith('after');
      if (after) to.dispatchEvent(new DragEvent('drop', options));
      from.dispatchEvent(new DragEvent('dragend', options));
      return after;
    }, canvas), 'move a loan field from ' + (canvas ? 'preview' : 'tree'));
    await until(() => !!view.editor.overlay, 'loan layout change enters the draft');
    const moved = await saveDraft(ui, view, read, original);
    assert.ok(moved.indexOf('<InputField name="Дата"') < moved.indexOf('<InputField name="Номер"'));
    if (previous) assert.equal(moved, previous);
    previous = moved;
    await editHistory(ui, 'undo', read, original);
  }
  return 'composite reference type and matching drag from tree and preview';
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
  for (const test of cases) {
    const file = path.join(root, 'src', test.form);
    const read = () => fs.readFile(file, 'utf8');
    const original = await read();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    let view;
    await until(() => {
      view = [...explorer.formPreview.views.values()].find(item => item.path === file);
      return !!view?.editor?.schema?.writable;
    }, 'editable complex form');
    const main = view.frames.get('main').panel;
    const ui = await frame({ state: { title: main.title } });
    let floating;
    try {
      if (test.target) {
        await until(() => dom(ui, name => {
          const row = [...document.querySelectorAll('[data-form-tree-node]')]
            .find(row => row.querySelector(':scope > .form-truncate')?.textContent === name);
          if (!row) return false;
          row.click();
          return true;
        }, test.target), 'select complex nested group');
      }
      const start = Date.now();
      await until(() => edit(ui, test.key), 'inline property control');
      await until(() => view.editor?.overlay?.text && view.snapshot?.dependencies.some(item => item.version?.startsWith('eska-form-')), 'renderer consumed draft overlay');
      const updateMs = Date.now() - start;
      assert.equal(await read(), original);
      const widths = [];
      for (const width of [1080, 660, 960]) {
        await dom(ui, width => { document.getElementById('root').style.width = width + 'px'; }, width);
        await until(() => dom(ui, width => document.querySelector('.form-shell').clientWidth === width, width), 'resized complex form');
        widths.push(await dom(ui, () => {
          const inspector = document.querySelector('.form-inspectors');
          return { width: inspector.clientWidth, height: inspector.clientHeight, layout: inspector.dataset.inspectorLayout,
            preview: document.querySelector('.preview-scroll').clientWidth };
        }));
      }
      await dom(ui, () => { document.getElementById('root').style.width = ''; });
      assert.ok(widths.every(value => value.layout === 'columns' && value.width > 0 && value.preview > 0));
      if (test.target) {
        await ui.screenshot('stalingrad-attached-ru.png');
        await dom(ui, () => document.querySelector('[data-edit-action=detachPreview]').click());
        await until(() => view.frames.get('preview')?.ready, 'detached complex preview');
        floating = await frame({ detached: true, state: { title: view.frames.get('preview').panel.title } });
        await floating.nativeWindow({ detached: true });
        main.reveal(undefined, false);
        await until(() => dom(ui, () => document.querySelector('.form-inspectors').dataset.inspectorLayout === 'detached'), 'layout changed after actual detach');
        await ui.screenshot('stalingrad-detached-ru.png');
        await dom(floating, () => document.querySelector('[data-edit-action=dockPreview]').click());
        await until(() => !view.frames.has('preview'), 'dock complex preview');
      }
      await dom(ui, () => document.querySelector('[data-edit-action=undo]').click());
      await until(() => !view.editor?.overlay && !view.snapshot?.dependencies.some(item => item.version?.startsWith('eska-form-')), 'complex form undo');
      assert.equal(await read(), original);
      const edits = await (test.target ? editLoan : editTransactions)(ui, view, read, original);
      results.push({ form: test.form, updateMs, widths, edits });
    } finally {
      floating?.close();
      ui.close();
      main.dispose();
      if (await read() !== original) await fs.writeFile(file, original);
    }
  }
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, locale: vscode.env.language, results }));
};
