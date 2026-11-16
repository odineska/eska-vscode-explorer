const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

const dom = (ui, action, ...args) => ui.evaluate('(' + action.toString() + ')(...' + JSON.stringify(args) + ')');
const click = (ui, selector) => dom(ui, selector => {
  const button = document.querySelector(selector);
  if (!button || button.disabled) return false;
  button.click();
  return true;
}, selector);
const action = name => '[data-edit-action="' + name + '"]';

function setValue(ui, selector, value, type = 'input') {
  return dom(ui, (selector, value, type) => {
    const field = document.querySelector(selector);
    if (!field) return false;
    field.focus();
    if (field.type === 'checkbox') field.checked = value;
    else field.value = value;
    if (field.type === 'text') field.setSelectionRange(4, 4);
    field.dispatchEvent(new Event(type, { bubbles: true }));
    return true;
  }, selector, value, type);
}

function namedRow(ui, name, mouse = 'click') {
  return dom(ui, (name, mouse) => {
    const row = [...document.querySelectorAll('[data-form-tree-node]')]
      .find(row => row.querySelector(':scope > .form-truncate')?.textContent === name);
    if (!row) return false;
    if (mouse === 'click') row.click();
    else {
      const box = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.x + 20, clientY: box.y + 8 }));
    }
    return true;
  }, name, mouse);
}

async function submit(ui) {
  await until(() => click(ui, 'dialog button[type="submit"]'), 'confirm action');
  await until(() => dom(ui, () => {
    const error = document.querySelector('dialog [role="alert"] p')?.textContent;
    if (error) throw Error(error);
    return !document.querySelector('dialog[open]');
  }), 'action applied to the draft');
}

function drag(ui, sourceSelector, name, offset) {
  return dom(ui, (sourceSelector, name, offset) => {
    const source = document.querySelector(sourceSelector);
    const target = [...document.querySelectorAll('[data-form-tree-node]')]
      .find(row => row.querySelector(':scope > .form-truncate')?.textContent === name);
    if (!source?.draggable || !target) return '';
    const dt = new DataTransfer(), box = target.getBoundingClientRect();
    const input = { bubbles: true, cancelable: true, dataTransfer: dt, clientY: box.top + box.height * offset, clientX: box.left + 10 };
    source.dispatchEvent(new DragEvent('dragstart', input));
    target.dispatchEvent(new DragEvent('dragover', input));
    const marker = target.dataset.formDrop ?? '';
    target.dispatchEvent(new DragEvent('drop', input));
    source.dispatchEvent(new DragEvent('dragend', input));
    return marker;
  }, sourceSelector, name, offset);
}

const inputTitle = '[data-edit-property="Title"] input';
const inputVisible = '[data-edit-property="Visible"] input[type=checkbox]';
const selected = ui => dom(ui, () => document.querySelector('.form-tree-row[aria-selected=true] > .form-truncate')?.textContent);
const draftText = view => view.editor?.overlay?.text ?? '';
const group = 'EditorGroup';
const leaf = 'EditorLeaf';

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const file = fixture.form.path, read = () => fs.readFile(file, 'utf8');
  const initial = (await read()).replace('<Width>50</Width>', '<!-- keep this -->\r\n<Width>50</Width>');
  await fs.mkdir(path.join(fixture.source, 'Ext'), { recursive: true });
  await fs.writeFile(path.join(fixture.source, 'Ext', 'ParentConfigurations.bin'), '{6,0,0,0,0,0}');
  await fs.writeFile(file, initial);
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => [...service.views.values()][0]?.editor?.schema?.writable, 'editable form schema ready');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  let ui = await frame({ state: { title: main.panel.title } });
  let floating;
  try {
    assert.deepEqual(await dom(ui, () => {
      const panels = document.querySelector('.form-inspectors'), preview = document.querySelector('.preview-scroll');
      return [panels.dataset.inspectorLayout, panels.querySelectorAll('.form-pane').length, preview.getBoundingClientRect().y > panels.getBoundingClientRect().y];
    }), ['columns', 3, true]);
    assert.equal(await dom(ui, () => document.querySelectorAll('.form-toolbar input[type=search]').length), 1);
    assert.equal(await dom(ui, () => !!document.querySelector('[data-edit-action=properties]')), false);
    const config = vscode.workspace.getConfiguration('workbench');
    const oldTheme = config.get('colorTheme');
    try {
      for (const [theme, kind] of [['Default Light Modern', 'light'], ['Default High Contrast', 'high-contrast'], ['Default Dark Modern', 'dark']]) {
        await config.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
        await until(() => dom(ui, expected => document.body.classList.contains('vscode-' + expected), kind), theme);
        assert.ok(await dom(ui, () => {
          const field = document.querySelector('[data-edit-property="Title"] input');
          const style = field && getComputedStyle(field);
          return style?.color !== style?.backgroundColor;
        }));
      }
    } finally { await config.update('colorTheme', oldTheme, vscode.ConfigurationTarget.Global); }
    if (process.env.ESKA_SCREENSHOT_DIR) await ui.screenshot('editor-attached-' + vscode.env.language + '.png');
    await until(() => namedRow(ui, 'Name'), 'field ready');
    const value = 'Draft name';
    const title = inputTitle + (vscode.env.language.startsWith('ru') ? '[aria-label$="(ru)"]' : '[aria-label$="(en)"]');
    await until(() => setValue(ui, title, value), 'inline property of selected element ready');
    await until(() => draftText(view).includes(value), 'inline title checked');
    await until(() => dom(ui, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'live title in attached preview');
    assert.deepEqual(await dom(ui, input => [document.activeElement === document.querySelector(input), document.activeElement?.selectionStart], title), [true, 4]);
    assert.equal(await read(), initial);
    assert.ok(await click(ui, action('detachPreview')));
    await until(() => view.frames.get('preview')?.ready, 'preview opened');
    floating = await frame({ detached: true, state: { title: view.frames.get('preview').panel.title } });
    await floating.nativeWindow({ detached: true });
    main.panel.reveal(undefined, false);
    await until(() => dom(ui, () => document.querySelector('.form-inspectors')?.dataset.inspectorLayout === 'detached'), 'detached editor layout');
    assert.ok(await dom(ui, () => {
      const properties = document.querySelector('.form-pane--properties').getBoundingClientRect();
      const data = document.querySelector('.form-pane--data').getBoundingClientRect();
      return properties.top >= data.bottom && properties.width > data.width + 100 && !document.querySelector('.preview-scroll');
    }));
    const wide = await dom(ui, () => getComputedStyle(document.querySelector('.form-property-groups')).gridTemplateColumns.split(' ').length);
    assert.ok(wide >= 2, 'whole categories use multiple columns');
    await dom(ui, () => { document.querySelector('#root').style.width = '436px'; });
    await until(() => dom(ui, () => getComputedStyle(document.querySelector('.form-property-groups')).gridTemplateColumns.split(' ').length === 1), 'groups reflow into one column');
    await dom(ui, () => { document.querySelector('#root').style.width = ''; });
    if (process.env.ESKA_SCREENSHOT_DIR) await ui.screenshot('editor-detached-' + vscode.env.language + '.png');
    await until(() => dom(floating, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'detached preview initialized with current draft');
    assert.ok(await setValue(ui, inputVisible, false, 'change'));
    await until(() => dom(floating, value => !document.querySelector('.preview-scroll').textContent.includes(value), value), 'visibility updates detached preview');
    assert.equal(await read(), initial);
    assert.ok(await click(ui, action('undo')));
    await until(() => dom(floating, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'undo reaches detached preview');
    const previewBefore = view.frames.get('preview');
    previewBefore.panel.dispose();
    await until(() => dom(ui, () => document.querySelector('.form-inspectors').dataset.inspectorLayout === 'columns'), 'closing preview restores docked layout');
    floating.close(); floating = undefined;
    assert.ok(await click(ui, action('detachPreview')));
    await until(() => view.frames.get('preview')?.ready && view.frames.get('preview') !== previewBefore, 'preview can be reopened');
    floating = await frame({ detached: true, state: { title: view.frames.get('preview').panel.title } });
    await until(() => dom(floating, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'reopened preview receives unsaved XML');
    assert.ok(await click(floating, action('dockPreview')));
    await until(() => !view.frames.has('preview'), 'return preview');
    await until(() => main.panel.active, 'main form active after docking');
    floating.close(); floating = undefined;

    // The context target is independent of the preceding selection.
    await until(() => namedRow(ui, 'Group', 'contextmenu'), 'right click a previously unselected group');
    await until(() => dom(ui, () => !!document.querySelector('[data-edit-action=addElement]')), 'group menu ready');
    assert.equal(await dom(ui, () => document.querySelector('[data-edit-action=addElement]').textContent.trim()),
      vscode.env.language.startsWith('ru') ? 'Добавить внутрь' : 'Add inside');
    assert.ok(await click(ui, action('addElement')));
    assert.ok(await setValue(ui, 'dialog select[required]', 'UsualGroup', 'change'));
    assert.ok(await setValue(ui, 'dialog input[required]', group));
    await submit(ui);
    await until(() => selected(ui).then(value => value === group), 'created group selected');
    const parentKey = await dom(ui, () => [...document.querySelectorAll('[data-form-tree-node]')]
      .find(row => row.querySelector(':scope > .form-truncate')?.textContent === 'Group')?.dataset.formTreeNode);
    assert.ok(parentKey);
    assert.equal(await drag(ui, '[data-form-tree-node="' + parentKey + '"]', group, 0.5), '', 'cannot drag a parent into its descendant');
    await until(() => namedRow(ui, 'Name', 'contextmenu'), 'right click an ordinary leaf');
    assert.equal(await dom(ui, () => document.querySelector('[data-edit-action=addElement]').textContent.trim()),
      vscode.env.language.startsWith('ru') ? 'Добавить' : 'Add');
    assert.ok(await click(ui, action('addElement')));
    assert.ok(await setValue(ui, 'dialog select[required]', 'LabelDecoration', 'change'));
    assert.ok(await setValue(ui, 'dialog input[required]', leaf));
    await submit(ui);
    await until(() => selected(ui).then(value => value === leaf), 'new sibling selected');
    assert.match(draftText(view), /name="Name"[^]*?name="EditorLeaf"[^]*?name="Action"/);
    assert.ok(await click(ui, action('moveUp')));
    await until(() => /name="EditorLeaf"[^]*?name="Name"/.test(draftText(view)), 'move within siblings');
    await until(() => dom(ui, () => document.querySelector('[data-edit-action=moveUp]')?.disabled), 'up disabled at first child');
    assert.equal(await drag(ui, '[data-form-attribute="attributes:Name"]', group, 0.5), 'inside');
    await until(() => /name="EditorGroup"[^]*?<DataPath>Name<\/DataPath>/.test(draftText(view)), 'attribute drop creates a bound child');
    assert.match(draftText(view), /<Attribute name="Name"/);
    assert.equal(await drag(ui, '[data-form-attribute="attributes:Name"]', 'Action', 0.05), 'before');
    await until(() => /name="Name2"[^]*?<DataPath>Name<\/DataPath>[^]*?name="Action"/.test(draftText(view)), 'attribute drop uses line insertion');
    const beforeRemoval = draftText(view);
    await until(() => namedRow(ui, group, 'contextmenu'), 'delete nested group');
    assert.ok(await click(ui, action('remove')));
    assert.ok(await click(ui, 'dialog input[type=checkbox][required]'));
    await submit(ui);
    await until(() => !draftText(view).includes('name="EditorGroup"') && !draftText(view).includes('name="Name1"'), 'entire deleted subtree disappears');
    assert.match(draftText(view), /<Attribute name="Name"/);
    assert.ok(await click(ui, action('undo')));
    await until(() => draftText(view) === beforeRemoval, 'undo restores complete subtree bytes');
    assert.equal(await read(), initial);
    const current = draftText(view);
    assert.ok(await click(ui, action('save')));
    await until(async () => await read() === current, 'single atomic save writes checked draft');
    assert.ok((await read()).includes('<!-- keep this -->\r\n'));
    await until(() => dom(ui, () => !document.querySelector('[data-edit-action=undo]')?.disabled), 'saved undo available');
    assert.ok(await click(ui, action('undo')));
    await until(async () => !(await read()).includes('name="Name2"'), 'saved undo affects only last action');
    await until(() => dom(ui, () => !document.querySelector('[data-edit-action=redo]')?.disabled), 'saved redo available');
    assert.ok(await click(ui, action('redo')));
    await until(async () => await read() === current, 'saved redo restores exact XML');

    // Search matches property values and reveals the editor for the selected result.
    const search = '.form-toolbar input[type=search]';
    assert.ok(await setValue(ui, search, vscode.env.language.startsWith('ru') ? 'вертикальная' : 'vertical'));
    await until(() => dom(ui, () => [...document.querySelectorAll('#form-search-results [data-result-property="Group"]')]
      .some(row => /· (Vertical|Вертикальная)$/.test(row.textContent))), 'localized property search');
    await dom(ui, () => {
      const input = document.querySelector('.form-toolbar input[type=search]');
      const rows = [...document.querySelectorAll('#form-search-results [role=option]')];
      const index = rows.findIndex(row => row.dataset.resultProperty === 'Group' && /· (Vertical|Вертикальная)$/.test(row.textContent));
      for (let cursor = 0; cursor < index; cursor++)
        input.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    });
    try {
      await until(() => dom(ui, () => !!document.activeElement?.closest('[data-edit-property="Group"]')), 'property search focuses the matching editor');
    } catch (error) {
      error.message += ' ' + JSON.stringify(await dom(ui, () => ({
        active: document.activeElement?.outerHTML.slice(0, 240),
        selected: document.querySelector('.form-tree-row[aria-selected=true] > .form-truncate')?.textContent,
        property: document.querySelector('[data-palette-id="platform:Group"]')?.outerHTML.slice(0, 530),
        search: document.querySelector('.form-toolbar input[type=search]')?.outerHTML,
      })));
      throw error;
    }

    const ru = vscode.env.language.startsWith('ru');
    const appearanceButton = (en, ruLabel, scope = 'dialog') => dom(ui, (label, selector) => {
      const item = [...document.querySelectorAll(selector + ' button')].find(button => button.textContent.trim() === label && !button.disabled);
      if (!item) return false;
      item.click();
      return true;
    }, ru ? ruLabel : en, scope);
    await until(() => click(ui, action('formMenu')), 'form menu opens');
    await until(() => click(ui, action('appearance')), 'open conditional appearance for the form');
    assert.ok(await appearanceButton('Add rule', 'Добавить правило'));
    assert.ok(await setValue(ui, 'dialog .form-edit-settings select', 'background', 'change'));
    assert.ok(await appearanceButton('Add', 'Добавить', '.form-edit-settings'));
    assert.ok(await setValue(ui, '[data-format="background"] input[type=text]', '#AABBCC'));
    assert.ok(await appearanceButton('Conditions', 'Условия', '.form-edit-tabs'));
    assert.ok(await appearanceButton('Add condition', 'Добавить условие'));
    assert.ok(await setValue(ui, 'dialog .form-edit-compare input[list]', 'Name'));
    assert.ok(await setValue(ui, 'dialog .form-edit-compare select', 'Filled', 'change'));
    assert.ok(await appearanceButton('Formatted fields', 'Оформляемые поля', '.form-edit-tabs'));
    assert.ok(await setValue(ui, 'dialog input[list="form-appearance-elements"]', 'Name'));
    assert.ok(await appearanceButton('Add', 'Добавить', '.form-edit-formatted'));
    await submit(ui);
    assert.match(draftText(view), /<ConditionalAppearance[ >][^]*?#AABBCC/);
    assert.match(draftText(view), /<dcsset:comparisonType>Filled<\/dcsset:comparisonType>/);
    assert.match(draftText(view), /<dcsset:field>Name<\/dcsset:field>/);
    assert.equal(await read(), current);
    await until(() => click(ui, action('save')), 'save form conditional appearance');
    await until(async () => (await read()).includes('#AABBCC'), 'rule on disk');
    await until(() => click(ui, action('undo')), 'undo the saved rule');
    await until(async () => await read() === current, 'undo recovers the exact form XML');

    main.panel.dispose(); ui.close();
    await until(() => service.views.size === 0, 'old consumers released');
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...service.views.values()][0]?.editor?.schema?.writable, 'saved form opens again');
    assert.equal(await read(), current);
    const reopened = [...service.views.values()][0];
    ui = await frame({ state: { title: reopened.frames.get('main').panel.title } });
    await until(() => namedRow(ui, 'Name'), 'reopened field available');
    await until(() => setValue(ui, title, 'Recover this title'), 'edit the reopened field');
    await until(() => draftText(reopened).includes('Recover this title'), 'a checked draft was checkpointed');
    reopened.frames.get('main').panel.dispose();
    ui.close();
    await until(() => service.views.size === 0, 'all form views closed');
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    let restored;
    await until(() => {
      restored = [...service.views.values()][0];
      return draftText(restored ?? {}).includes('Recover this title');
    }, 'checked draft restored after all views closed');
    const external = current.replace('<!-- keep this -->', '<!-- external -->');
    await fs.writeFile(file, external);
    await until(() => restored.editor.status.conflict, 'external XML conflict is recognized');
    assert.equal(await read(), external);
    assert.ok(draftText(restored).includes('Recover this title'));
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
      passed: true, locale: vscode.env.language, nativeWindow: true, liveDraft: true,
      exactSave: true, groupedUndo: true, propertySearch: true, attributeDrop: ['inside', 'before'],
      draftRecovery: true, externalConflict: true, conditionalAppearance: true,
    }));
  } finally { ui.close(); floating?.close(); }
};
