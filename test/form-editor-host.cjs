const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const ru = vscode.env.language.startsWith('ru');
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  await fs.mkdir(path.join(fixture.source, 'Ext'), { recursive: true });
  await fs.writeFile(path.join(fixture.source, 'Ext', 'ParentConfigurations.bin'), '{6,0,0,0,0,0}');
  const list = '<Attribute name="DynamicRows" id="50"><Type><v8:Type xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">cfg:DynamicList</v8:Type></Type>'
    + '<Settings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="DynamicList"><ListSettings/></Settings></Attribute>';
  await fs.writeFile(fixture.form.path, (await fs.readFile(fixture.form.path, 'utf8')).replace('</Attributes>', list + '</Attributes>'));
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => [...service.views.values()][0]?.phase === 'ready', 'form preview ready');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  const ui = await frame({ state: { title: main.panel.title } });
  const source = () => fs.readFile(fixture.form.path, 'utf8');
  const act = action => ui.evaluate(`(() => {
    const row=document.querySelector('[data-edit-action="${action}"]');
    if(!row) return false; row.click(); return true;
  })()`);
  const textButton = (english, russian, selector = 'dialog') => ui.evaluate(`(() => {
    const button=[...document.querySelectorAll(${JSON.stringify(selector + ' button')})].find(item=>item.textContent.trim()===${JSON.stringify(ru ? russian : english)}&&!item.disabled);
    if(!button) return false; button.click(); return true;
  })()`);
  const input = (selector, value, event = 'input') => ui.evaluate(`(() => {
    const control=document.querySelector(${JSON.stringify(selector)});
    if(!control) return false; control.value=${JSON.stringify(value)}; control.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true})); return true;
  })()`);
  async function open(action) {
    await until(() => act(action), `${action} button`);
    await until(() => ui.evaluate(`!!document.querySelector('dialog[open] form') || !!document.querySelector('dialog [role="alert"] p')`), `${action} loaded`);
    assert.equal(await ui.evaluate(`document.querySelector('dialog [role="alert"] p')?.textContent || ''`), '');
  }
  async function preview() {
    await until(() => textButton('Review changes', 'Проверить изменения'), 'review button');
    await until(() => ui.evaluate(`!!document.querySelector('.form-edit-review') || !!document.querySelector('dialog [role="alert"] p')`), 'preview result');
    assert.equal(await ui.evaluate(`document.querySelector('dialog [role="alert"] p')?.textContent || ''`), '');
  }
  async function save() {
    await until(() => textButton('Save form', 'Сохранить форму'), 'save button');
    await until(() => ui.evaluate(`!document.querySelector('dialog[open]') || !!document.querySelector('dialog [role="alert"] p')`), 'save result');
    assert.equal(await ui.evaluate(`document.querySelector('dialog [role="alert"] p')?.textContent || ''`), '');
    await until(() => ui.evaluate(`!document.querySelector('dialog[open]') && !!document.querySelector('[data-edit-action="appearance"]')`), 'viewer refreshed');
  }
  try {
    const initial = await source();
    await open('addElement');
    assert.equal(await input('dialog select[required]', 'UsualGroup', 'change'), true);
    assert.equal(await input('dialog input[required]', 'EditorGroup'), true);
    await preview();
    assert.equal(await source(), initial, 'review writes nothing');
    await save();
    assert.match(await source(), /<UsualGroup name="EditorGroup" id="\d+"/);
    await until(() => ui.evaluate("document.querySelector('[aria-selected=true].form-tree-row')?.textContent.includes('EditorGroup')"), 'new group selected');
    await open('properties');
    assert.ok(await ui.evaluate(`(() => {
      const control=document.querySelector('dialog [data-edit-property="United"] input[type="checkbox"]');
      if(!control)return false;control.checked=true;control.dispatchEvent(new Event('change',{bubbles:true}));return true;
    })()`));
    await preview(); await save();
    assert.match(await source(), /<UsualGroup name="EditorGroup"[^>]*><United>true<\/United>/);

    await open('copy');
    assert.ok(await input('dialog input[required]', 'EditorGroupCopy'));
    await preview(); await save();
    assert.match(await source(), /name="EditorGroupCopy"/);
    await until(() => ui.evaluate("document.querySelector('[aria-selected=true].form-tree-row')?.textContent.includes('EditorGroupCopy')"), 'copied group selected');
    await open('move');
    assert.ok(await input('dialog select', 'element:7', 'change'));
    await preview(); await save();
    assert.match(await source(), /<Page name="Other"[\s\S]*?<UsualGroup name="EditorGroupCopy"/);
    await open('remove');
    assert.ok(await ui.evaluate(`(() => {
      const control=document.querySelector('dialog input[type="checkbox"][required]');
      if(!control)return false;control.click();return true;
    })()`));
    await preview(); await save();
    assert.doesNotMatch(await source(), /name="EditorGroupCopy"/);

    assert.ok(await ui.evaluate("(" + function () {
      const tree = [...document.querySelectorAll('[data-form-tree-node]')];
      const from = tree.find(row => row.textContent.trim() === 'EditorGroup');
      const to = tree.find(row => row.textContent.trim().startsWith('Other'));
      if (!from?.draggable || !to) return false;
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const rectangle = to.getBoundingClientRect();
      const target = { bubbles: true, cancelable: true, dataTransfer, clientY: rectangle.top + rectangle.height / 2 };
      to.dispatchEvent(new DragEvent('dragover', target));
      if (to.dataset.formDrop !== 'inside') return false;
      to.dispatchEvent(new DragEvent('drop', target));
      return true;
    }.toString() + ")()"));
    await until(() => ui.evaluate("!!document.querySelector('.form-edit-review')"), 'drag creates a reviewed plan');
    await save();
    assert.match(await source(), /<Page name="Other"[^]*?<UsualGroup name="EditorGroup"/);

    await open('addDefinition');
    assert.ok(await input('dialog input[required]', 'EditorFlag'));
    assert.ok(await input('dialog select[aria-label]', JSON.stringify(['http://www.w3.org/2001/XMLSchema','boolean']), 'change'));
    assert.ok(await input('dialog select[aria-label]', JSON.stringify(['http://www.w3.org/2001/XMLSchema','decimal']), 'change'));
    assert.ok(await input('dialog [data-type-qualifier="Digits"]', '18'));
    assert.ok(await input('dialog [data-type-qualifier="FractionDigits"]', '4'));
    await preview(); await save();
    assert.match(await source(), /name="EditorFlag"[^]*?xs:boolean[^]*?xs:decimal[^]*?FractionDigits>4/);

    await open('appearance');
    assert.ok(await input('dialog [data-form-edit-scope]', '1', 'change'));
    assert.ok(await textButton('Add rule', 'Добавить правило'));
    assert.ok(await input('dialog select[aria-label]', 'background', 'change'));
    assert.ok(await textButton('Add', 'Добавить', '.form-edit-settings'));
    assert.ok(await textButton('Conditions', 'Условия', '.form-edit-tabs'));
    assert.ok(await textButton('Add condition', 'Добавить условие'));
    assert.ok(await input('dialog .form-edit-compare input[list]', 'Number'));
    assert.ok(await input('dialog .form-edit-compare select', 'InList', 'change'));
    assert.ok(await textButton('Add value', 'Добавить значение'));
    assert.ok(await input('.form-edit-list-value:nth-child(1) input', 'One'));
    assert.ok(await textButton('Add value', 'Добавить значение'));
    assert.ok(await input('.form-edit-list-value:nth-child(2) input', 'Two'));
    await preview(); await save();
    assert.match(await source(), /<ListSettings>.*<dcsset:comparisonType>InList<\/dcsset:comparisonType>.*>One<\/dcsset:right>.*>Two<\/dcsset:right>/s);

    const beforeAppearance = await source();
    await open('appearance');
    assert.ok(await textButton('Add rule', 'Добавить правило'));
    assert.ok(await input('dialog select[aria-label]', 'background', 'change'));
    assert.ok(await textButton('Add', 'Добавить', '.form-edit-settings'));
    assert.ok(await input('[data-format="background"] input[type="text"]', '#AABBCC'));
    assert.ok(await textButton('Conditions', 'Условия', '.form-edit-tabs'));
    assert.ok(await textButton('Add condition', 'Добавить условие'));
    assert.ok(await input('dialog .form-edit-compare input[list]', 'EditorFlag'));
    assert.ok(await input('dialog .form-edit-compare select', 'Filled', 'change'));
    assert.ok(await textButton('Formatted fields', 'Оформляемые поля', '.form-edit-tabs'));
    assert.ok(await input('dialog input[list="form-appearance-elements"]', 'Name'));
    assert.ok(await textButton('Add', 'Добавить', '.form-edit-formatted'));
    await preview();
    assert.equal(await source(), beforeAppearance);
    assert.match(await ui.evaluate(`document.querySelector('.form-edit-review').textContent`), /#AABBCC/);
    await save();
    const saved = await source();
    assert.match(saved, /<ConditionalAppearance[ >].*#AABBCC/s);
    assert.match(saved, /<dcsset:comparisonType>Filled<\/dcsset:comparisonType>/);
    assert.match(saved, /<dcsset:field>Name<\/dcsset:field>/);
    await open('appearance');
    assert.ok(await textButton('Format', 'Оформление', '.form-edit-tabs'));
    assert.equal(await ui.evaluate(`document.querySelector('[data-format="background"] input[type="text"]').value`), '#AABBCC');
    assert.ok(await input('[data-format="background"] input[type="text"]', '#000000'));
    await preview();
    assert.ok(await textButton('Cancel', 'Отмена'));
    assert.equal(await source(), saved, 'cancel discards a reviewed draft');

    await open('appearance');
    assert.ok(await input('[data-format="background"] input[type="text"]', '#112233'));
    await preview();
    const external = saved.replace('#AABBCC', '#CCDDEE');
    await fs.writeFile(fixture.form.path, external);
    await until(() => textButton('Save form', 'Сохранить форму'), 'try to save a stale plan');
    await until(() => ui.evaluate(`!!document.querySelector('dialog [role="alert"] p')`), 'conflict message');
    assert.equal(await source(), external, 'a changed source is never overwritten');
    assert.ok(await textButton('Cancel', 'Отмена'));
    await until(() => ui.evaluate(`!!document.querySelector('[data-edit-action="appearance"]')`), 'saved external revision ready');
    await open('appearance');
    assert.ok(await input('[data-format="background"] input[type="text"]', '#123456'));
    await preview();
    const dirty = new vscode.WorkspaceEdit();
    dirty.insert(document.uri, document.positionAt(document.getText().length), '\n');
    assert.equal(await vscode.workspace.applyEdit(dirty), true);
    assert.equal(document.isDirty, true);
    assert.ok(await textButton('Save form', 'Сохранить форму'));
    await until(() => ui.evaluate(`!!document.querySelector('dialog [role="alert"] p')`), 'dirty buffer rejected');
    assert.equal(await source(), external);
    assert.equal(document.isDirty, true);
    assert.ok(await textButton('Cancel', 'Отмена'));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, suite: 'form-editor',
      scenarios: ['add and select a form element', 'edit a boolean property', 'copy, move and delete a form element', 'drag and save a tree element inside a page', 'add a composite form attribute with number qualifiers',
        'create conditional rule with typed condition and formatted field', 'save a dynamic-list rule with two values', 'edit existing rule', 'cancel reviewed changes', 'external change blocks a stale save', 'dirty source blocks publication'] }));
  } finally { ui.close(); }
};
