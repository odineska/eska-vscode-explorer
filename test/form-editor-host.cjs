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
  }), 'action written to the form');
}

function drag(ui, sourceSelector, name, offset, targetSelector) {
  return dom(ui, (sourceSelector, name, offset, targetSelector) => {
    const source = document.querySelector(sourceSelector);
    const target = targetSelector ? document.querySelector(targetSelector) : [...document.querySelectorAll('[data-form-tree-node]')]
      .find(row => row.querySelector(':scope > .form-truncate')?.textContent === name);
    if (!source?.draggable || !target) return '';
    const dt = new DataTransfer(), box = target.getBoundingClientRect();
    const button = target.querySelector('.taxi-button');
    const zoom = Number(target.closest('.taxi-preview')?.style.zoom) || 1;
    const face = button?.getBoundingClientRect();
    const scale = face && !button.contains(document.elementFromPoint(face.x + face.width / 2, face.y + face.height / 2)) ? zoom : 1;
    const input = { bubbles: true, cancelable: true, dataTransfer: dt, clientY: (box.top + box.height * offset) * scale, clientX: (box.left + 10) * scale };
    source.dispatchEvent(new DragEvent('dragstart', input));
    target.dispatchEvent(new DragEvent('dragover', input));
    const marker = target.dataset.formDrop ?? '';
    target.dispatchEvent(new DragEvent('drop', input));
    source.dispatchEvent(new DragEvent('dragend', input));
    return marker;
  }, sourceSelector, name, offset, targetSelector);
}

const previewField = '[data-element$=":2"]';
const previewAction = '[data-element$=":3"]';
const previewGroup = '[data-element$=":1"]';
async function previewZoom(ui, zoom) {
  assert.ok(await setValue(ui, '.form-zoom select', String(zoom), 'change'));
  await until(() => dom(ui, zoom => Number(document.querySelector('.taxi-preview').style.zoom) === zoom / 100, zoom), 'preview zoom applied');
}
async function checkZoomedDrag(ui, view) {
  for (const zoom of [50, 75, 125, 150, 200]) {
    await previewZoom(ui, zoom);
    const input = previewField + ' .taxi-input';
    await dom(ui, selector => document.querySelector(selector).scrollIntoView({ block: 'nearest', inline: 'nearest' }), input);
    await ui.pointer(input, true);
    await until(async () => view.selected?.key.value === '2' &&
      await dom(ui, selector => document.querySelector(selector)?.draggable, previewField), 'trusted click selected the zoomed field');
    assert.deepEqual(await dom(ui, (sourceSelector, targetSelector, groupSelector) => {
      const source = document.querySelector(sourceSelector), target = document.querySelector(targetSelector);
      const group = document.querySelector(groupSelector);
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const face = target.querySelector('.taxi-button'), faceRect = face.getBoundingClientRect();
      const point = { x: faceRect.x + faceRect.width / 2, y: faceRect.y + faceRect.height / 2 };
      const zoom = Number(face.closest('.taxi-preview').style.zoom);
      const scale = face.contains(document.elementFromPoint(point.x, point.y)) ? 1 : zoom;
      const transfer = new DataTransfer();
      const event = (type, dest, offset) => {
        const rect = dest.getBoundingClientRect();
        return new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: transfer,
          clientX: point.x * scale, clientY: (rect.top + rect.height * offset) * scale,
        });
      };
      const sourceSelected = source.classList.contains('taxi-selected');
      source.dispatchEvent(event('dragstart', source, 0.5));
      const markers = [[target, 0.05, 'borderTopWidth'], [target, 0.95, 'borderBottomWidth'], [group, 0.5, 'borderLeftWidth']]
        .map(([destination, offset, edge]) => {
          const drag = event('dragover', destination, offset);
          const hit = destination === target ? document.elementFromPoint(drag.clientX, drag.clientY) : destination;
          if (!destination.contains(hit)) return false;
          hit.dispatchEvent(drag);
          const layer = getComputedStyle(destination, '::before');
          const scale = Number(destination.closest('.taxi-preview').style.zoom);
          return [destination.dataset.formDrop, Math.round(parseFloat(layer[edge]) * scale), layer.pointerEvents, Number(layer.zIndex) > 1];
        });
      source.dispatchEvent(event('dragend', source, 0.5));
      return [sourceSelected, ...markers, !document.querySelector('[data-form-drop]')];
    }, previewField, previewAction, previewGroup), [
      true, ...['before', 'after', 'inside'].map(marker => [marker, Math.floor(zoom / 50), 'none', true]), true,
    ], 'drop feedback at ' + zoom + '%');
  }
  await previewZoom(ui, 75);
  assert.deepEqual(await dom(ui, selector => {
    const source = document.querySelector(selector);
    const wrapper = document.querySelector('.taxi-element[data-element$=":9"]');
    const projection = wrapper.querySelector('[data-view-status][data-element]');
    const dataTransfer = new DataTransfer(), rect = projection.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height * 0.6;
    const zoom = Number(wrapper.closest('.taxi-preview').style.zoom);
    const scale = projection.contains(document.elementFromPoint(x, y)) ? 1 : zoom;
    const hit = document.elementFromPoint(x * scale, y * scale);
    const event = (type, clientY = y * scale) => new DragEvent(type,
      { bubbles: true, cancelable: true, dataTransfer, clientX: x * scale, clientY });
    const group = wrapper.parentElement.closest('.taxi-element[data-element]');
    const edgeY = group.getBoundingClientRect().bottom * scale - 3;
    const edgeHit = document.elementFromPoint(x * scale, edgeY);
    source.dispatchEvent(event('dragstart'));
    if (projection.contains(hit)) hit.dispatchEvent(event('dragover'));
    const middle = [projection.dataset.element === wrapper.dataset.element, wrapper.dataset.formDrop,
      !!projection.dataset.formDrop, getComputedStyle(wrapper, '::before').position];
    if (projection.contains(edgeHit)) edgeHit.dispatchEvent(event('dragover', edgeY));
    const edge = [projection.contains(edgeHit), group.dataset.formDrop];
    source.dispatchEvent(event('dragend'));
    return { middle, edge };
  }, previewField), { middle: [true, 'after', false, 'absolute'], edge: [true, 'after'] },
  'standalone status targets its wrapper in the middle and the group at its outer edge');
}
async function checkSelectedRootDrop(ui, view) {
  const root = '.taxi-form-frame';
  assert.ok(await click(ui, root));
  await until(async () => view.selected?.key.kind === 'root' &&
    await dom(ui, selector => document.querySelector(selector).classList.contains('taxi-selected'), root),
  'selected form root is rendered');
  assert.deepEqual(await dom(ui, selector => {
    const root = document.querySelector(selector);
    const source = document.querySelector('[data-form-tree-node$=":2"]');
    const dataTransfer = new DataTransfer();
    const event = type => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
    root.style.setProperty('--vscode-focusBorder', 'rgb(1, 2, 3)');
    try {
      source.dispatchEvent(event('dragstart'));
      root.dispatchEvent(event('dragover'));
      const layer = getComputedStyle(root, '::after');
      return [root.dataset.formDrop, layer.borderTopColor, layer.top, layer.pointerEvents, layer.zIndex];
    } finally {
      source.dispatchEvent(event('dragend'));
      root.style.removeProperty('--vscode-focusBorder');
    }
  }, root), ['inside', 'rgb(1, 2, 3)', '0px', 'none', '3'], 'drop feedback takes priority over selected root outline');
}
function elementOrder(ui, attribute) {
  return dom(ui, attribute => [...document.querySelectorAll('[' + attribute + ']')]
    .map(element => element.getAttribute(attribute).split(':').at(-1))
    .filter(id => id === '2' || id === '3').join(','), attribute);
}
async function historyKey(ui, code) {
  await until(async () => {
    const result = await dom(ui, code => {
      const shell = document.querySelector('.form-shell');
      if (shell.getAttribute('aria-busy') === 'true') return { accepted: false, forwarded: false };
      let forwarded = false;
      const observe = () => { forwarded = true; };
      window.addEventListener('keydown', observe);
      const accepted = !shell.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, code }));
      window.removeEventListener('keydown', observe);
      return { accepted, forwarded };
    }, code);
    if (result.accepted) assert.equal(result.forwarded, false, 'handled history key does not reach workbench forwarding');
    return result.accepted;
  }, 'preview history can handle ' + code);
}

async function checkScrollingDrag(ui, view, read, zoom) {
  await previewZoom(ui, zoom);
  const before = await read();
  await until(() => click(ui, previewField), 'long form source selected');
  await until(() => dom(ui, selector => document.querySelector(selector)?.draggable, previewField), 'long form source draggable');
  const result = await dom(ui, async selector => {
    const viewport = document.querySelector('.preview-scroll');
    const source = document.querySelector(selector);
    const target = document.querySelector('[data-element$=":200"]');
    const scrollport = viewport.querySelector('.taxi-form-scrollport[data-scrollable]') ?? viewport;
    scrollport.scrollTop = 0;
    const start = source.querySelector('.taxi-input').getBoundingClientRect();
    const scaled = source.contains(document.elementFromPoint(start.x + start.width / 2, start.y + start.height / 2)) ? 1 : Number(source.closest('.taxi-preview').style.zoom);

    const targetBox = target.getBoundingClientRect();
    const x = (targetBox.left + targetBox.width / 2) * scaled;
    const box = scrollport.getBoundingClientRect();
    const scrollScale = scrollport === viewport ? 1 : scaled;
    const edge = box.bottom * scrollScale - 3;
    const pause = () => new Promise(resolve => setTimeout(resolve, 130));
    const transfer = new DataTransfer();
    const fire = (type, y, hit = document.elementFromPoint(x, y), dataTransfer = transfer, relatedTarget) =>
      hit.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y, relatedTarget,
      }));
    const marker = () => {
      const marked = document.querySelector('[data-form-drop]');
      return marked ? [marked.dataset.element?.split(':').at(-1), marked.dataset.formDrop] : null;
    };
    const firstRow = viewport.querySelector('[data-element$=":100"]');
    const group = viewport.querySelector('[data-element$=":201"]');
    firstRow.scrollIntoView({ block: 'center', inline: 'nearest' });
    let rowBox = firstRow.getBoundingClientRect();
    // Align the first child with the group's edge even when group insets differ by platform.
    firstRow.style.transform = 'translateY(' + (group.getBoundingClientRect().top - rowBox.top) * scaled
      / Number(source.closest('.taxi-preview').style.zoom) + 'px)';
    rowBox = firstRow.getBoundingClientRect();
    const edgeY = scaled * rowBox.top + 3;
    const edgeHit = document.elementFromPoint(x, edgeY);
    fire('dragstart', 0, source);
    fire('dragover', edgeY, edgeHit);
    const covered = { hit: firstRow.contains(edgeHit), marker: marker() };
    firstRow.style.transform = '';
    fire('dragend', edgeY, source);
    scrollport.scrollTop = 0;
    fire('dragstart', 0, source);
    fire('dragover', edge, undefined, new DataTransfer());
    await pause();
    const foreign = scrollport.scrollTop;
    fire('dragover', edge);
    const first = marker();
    for (let i = 0; scrollport.scrollTop < 40 && i < 15; i++) await pause();
    const scrolled = scrollport.scrollTop;
    const next = marker();
    const hit = document.elementFromPoint(x, edge);
    fire('dragleave', edge, hit, transfer, document.querySelector('.form-status'));
    await pause();
    const left = scrollport.scrollTop;
    const cleared = !marker();
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    const y = (rect.top + rect.height * .85) * scaled;
    fire('dragover', y);
    const destination = marker();
    fire('drop', y);
    fire('dragend', y, source);
    return { extent: scrollport.scrollHeight - scrollport.clientHeight, covered, foreign, scrolled, left, cleared, first, next, destination };
  }, previewField);
  assert.deepEqual(result.covered, { hit: true, marker: ['201', 'before'] });
  assert.ok(result.extent > 500 && result.foreign === 0 && result.scrolled > 0 && result.left === result.scrolled && result.cleared, JSON.stringify(result));
  assert.ok(result.first && result.next && result.first[0] !== result.next[0], 'drop target follows updated hit-testing: ' + JSON.stringify(result));
  assert.deepEqual(result.destination, ['200', 'after']);
  await until(async () => {
    const xml = await read();
    return /<LabelDecoration name="Target" id="200">[^]*?<\/LabelDecoration>\s*<InputField name="Name" id="2">/.test(xml)
      && !view.editor.dirty && !view.editor.status.saving;
  }, 'one move after scrolling is saved');
  const after = await read();
  await historyKey(ui, 'KeyZ');
  await until(async () => await read() === before && !view.editor.status.saving, 'one Undo after scrolling restores exact XML');
  await historyKey(ui, 'KeyY');
  await until(async () => await read() === after && !view.editor.status.saving, 'Redo after scrolling restores exact moved XML');
  await historyKey(ui, 'KeyZ');
  await until(async () => await read() === before && !view.editor.status.saving, 'restore long form for next window');
}

async function checkLongForm(fixture, service) {
  const file = fixture.form.second, read = () => fs.readFile(file, 'utf8');
  const rows = Array.from({ length: 90 }, (_, index) =>
    `<LabelDecoration name="Row${index}" id="${100 + index}"><Title>Row ${index}</Title></LabelDecoration>`).join('\n');
  const longGroup = '<UsualGroup name="Destination" id="201"><Group>Vertical</Group><ShowTitle>false</ShowTitle><ChildItems>'
    + rows + '<LabelDecoration name="Target" id="200"><Title>Target</Title></LabelDecoration>'
    + '<LabelDecoration name="Tail" id="202"><Title>Tail</Title></LabelDecoration></ChildItems></UsualGroup>';
  await fs.writeFile(file, (await read()).replace('</Pages>', '</Pages>' + longGroup));
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  let view;
  await until(() => {
    view = [...service.views.values()][0];
    return view?.editor?.schema?.writable;
  }, 'long form writable');
  const main = view.frames.get('main');
  const ui = await frame({ state: { title: main.panel.title } });
  let floating;
  try {
    await checkScrollingDrag(ui, view, read, 75);
    await until(() => click(ui, action('detachPreview')), 'detach long form preview');
    await until(() => view.frames.get('preview')?.ready, 'long form preview opened');
    floating = await frame({ detached: true, state: { title: view.frames.get('preview').panel.title } });
    await checkScrollingDrag(floating, view, read, 125);
  } finally {
    view.frames.get('preview')?.panel.dispose();
    main.panel.dispose();
    ui.close();
    floating?.close();
  }
}

const inputTitle = '[data-edit-property="Title"] input';
const inputVisible = '[data-edit-property="Visible"] input[type=checkbox]';
const selected = ui => dom(ui, () => document.querySelector('.form-tree-row[aria-selected=true] > .form-truncate')?.textContent);
const group = 'EditorGroup';
const leaf = 'EditorLeaf';

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const file = fixture.form.path, read = () => fs.readFile(file, 'utf8');
  const initial = (await read()).replace('<Width>50</Width>', '<!-- keep this -->\r\n<Width>50</Width>')
    .replace('</ChildItems></UsualGroup>', '<PDFDocumentField name="StatusOwner" id="10"><Visible>false</Visible></PDFDocumentField>'
      + '<ViewStatusAddition name="StandaloneStatus" id="9"><AdditionSource><Item>StatusOwner</Item>'
      + '<Type>ViewStatusRepresentation</Type></AdditionSource></ViewStatusAddition></ChildItems></UsualGroup>');
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
    const value = 'Saved name';
    const title = inputTitle + (vscode.env.language.startsWith('ru') ? '[aria-label$="(ru)"]' : '[aria-label$="(en)"]');
    await until(() => setValue(ui, title, value), 'inline property of selected element ready');
    await until(async () => (await read()).includes(value) && !view.editor.dirty && !view.editor.status.saving, 'inline title saved automatically');
    await until(() => dom(ui, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'live title in attached preview');
    assert.deepEqual(await dom(ui, input => [document.activeElement === document.querySelector(input), document.activeElement?.selectionStart], title), [true, 4]);
    assert.notEqual(await read(), initial);
    assert.equal(view.editor.dirty, false);
    // Platform defaults are localized captions, never technical translation keys written as XML values.
    const skip = '[data-edit-property="SkipOnInput"] select';
    const defaultCaption = vscode.env.language.startsWith('ru') ? 'Авто' : 'Default';
    await until(() => dom(ui, (selector, expected) => {
      const select = document.querySelector(selector);
      return select?.value === '' && select.selectedOptions[0]?.textContent === expected;
    }, skip, defaultCaption), 'absent enum has a localized default option');
    assert.ok(await setValue(ui, skip, 'true', 'change'));
    await until(async () => /<SkipOnInput>true<\/SkipOnInput>/.test(await read()) && !view.editor.dirty, 'explicit enum is saved as its XML value');
    await until(() => dom(ui, selector => document.querySelector(selector)?.value === 'true', skip), 'explicit enum displayed');
    assert.ok(await setValue(ui, skip, '', 'change'));
    await until(async () => !(await read()).includes('<SkipOnInput>') && !view.editor.dirty, 'choosing the default removes the explicit XML property');
    await until(() => dom(ui, (selector, expected) => document.querySelector(selector)?.selectedOptions[0]?.textContent === expected,
      skip, defaultCaption), 'localized default restored');
    assert.ok(!(await read()).includes('>default<'), 'translation keys never become source values');
    await checkSelectedRootDrop(ui, view);
    const dockedBeforeMove = await read();
    await checkZoomedDrag(ui, view);
    assert.equal(await drag(ui, previewField, undefined, 0.95, previewAction), 'after');
    await until(async () => await elementOrder(ui, 'data-element') === '3,2'
      && await elementOrder(ui, 'data-form-tree-node') === '3,2' && await read() !== dockedBeforeMove
      && !view.editor.dirty && !view.editor.status.saving, '75% attached move updates XML and preview');
    await historyKey(ui, 'KeyZ');
    await until(async () => await read() === dockedBeforeMove && !view.editor.status.saving
      && await elementOrder(ui, 'data-element') === '2,3', '75% attached Undo restores exact XML and preview');
    await previewZoom(ui, 100);
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
    await until(() => dom(ui, () => document.querySelector('.form-property-groups')?.dataset.propertyLayout === 'packed'), 'property categories packed after measuring');
    const packed = await dom(ui, () => {
      const container = document.querySelector('.form-property-groups');
      const tables = [...container.children].map(table => {
        const { left, right, top, bottom, width, height } = table.getBoundingClientRect();
        return { left, right, top, bottom, width, height, title: table.querySelector('th')?.textContent };
      });
      const firstRow = tables.filter(table => Math.abs(table.top - tables[0].top) < 1);
      const highestBottom = Math.max(...firstRow.map(table => table.bottom));
      return { columns: getComputedStyle(container).gridTemplateColumns.split(' ').length, tables,
        fillsGap: tables.some(table => table.top > tables[0].top + 1 && table.top < highestBottom - 1) };
    });
    assert.ok(packed.columns >= 2, 'whole categories use multiple columns');
    assert.ok(packed.fillsGap, 'next category fills the space below a shorter first-row category: ' + JSON.stringify(packed.tables));
    for (let index = 0; index < packed.tables.length; index++) for (const other of packed.tables.slice(index + 1)) {
      const current = packed.tables[index];
      assert.ok(!(current.left < other.right - 1 && other.left < current.right - 1 && current.top < other.bottom - 1 && other.top < current.bottom - 1),
        'property tables do not overlap: ' + JSON.stringify([current, other]));
    }
    await dom(ui, () => { document.querySelector('#root').style.width = '436px'; });
    await until(() => dom(ui, () => getComputedStyle(document.querySelector('.form-property-groups')).gridTemplateColumns.split(' ').length === 1), 'groups reflow into one column');
    assert.ok(await dom(ui, () => {
      const tables = [...document.querySelector('.form-property-groups').children].map(table => table.getBoundingClientRect());
      return tables.every((table, index) => !index || table.top >= tables[index - 1].bottom);
    }), 'one-column categories preserve their reading order without overlap');
    await dom(ui, () => { document.querySelector('#root').style.width = ''; });
    await until(() => dom(ui, () => getComputedStyle(document.querySelector('.form-property-groups')).gridTemplateColumns.split(' ').length >= 2), 'wide packing restored');
    if (process.env.ESKA_SCREENSHOT_DIR) await ui.screenshot('editor-detached-' + vscode.env.language + '.png');
    await until(() => dom(floating, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'detached preview initialized with saved XML');
    assert.ok(await setValue(ui, inputVisible, false, 'change'));
    await until(() => dom(floating, value => !document.querySelector('.preview-scroll').textContent.includes(value), value), 'visibility updates detached preview');
    await until(async () => (await read()).includes('<Visible>false</Visible>') && !view.editor.dirty && !view.editor.status.saving, 'visibility saved automatically');
    await until(() => click(ui, action('undo')), 'saved undo command available');
    await until(() => dom(floating, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'undo reaches detached preview');
    await until(() => !view.editor.dirty && !view.editor.status.saving, 'form saved before detached drag');
    const beforeMove = await read();
    await checkZoomedDrag(floating, view);
    assert.ok(await click(floating, previewField));
    await until(() => dom(floating, selector => document.querySelector(selector)?.draggable, previewField), 'selected detached element is draggable');
    assert.equal(await drag(floating, previewField, undefined, 0.95, previewAction), 'after');
    await until(async () => /<Button name="Action"[^]*?<InputField name="Name"/.test(await read())
      && !view.editor.dirty && !view.editor.status.saving, 'detached move saved automatically');
    const afterMove = await read();
    await until(async () => await elementOrder(floating, 'data-element') === '3,2'
      && await elementOrder(ui, 'data-form-tree-node') === '3,2', 'detached move updates preview and main tree');
    await historyKey(floating, 'KeyZ');
    await until(async () => await read() === beforeMove && !view.editor.status.saving, 'detached Undo restores exact XML');
    await until(async () => await elementOrder(floating, 'data-element') === '2,3'
      && await elementOrder(ui, 'data-form-tree-node') === '2,3', 'detached Undo synchronizes both frames');
    await historyKey(floating, 'KeyY');
    await until(async () => await read() === afterMove && !view.editor.status.saving, 'detached Redo restores the move');
    await until(async () => await elementOrder(floating, 'data-element') === '3,2'
      && await elementOrder(ui, 'data-form-tree-node') === '3,2', 'detached Redo synchronizes both frames');
    await until(() => click(ui, action('undo')), 'main frame can undo the detached move');
    await until(async () => await read() === beforeMove && !view.editor.status.saving, 'shared history restores XML from main frame');
    await previewZoom(floating, 100);
    const previewBefore = view.frames.get('preview');
    previewBefore.panel.dispose();
    await until(() => dom(ui, () => document.querySelector('.form-inspectors').dataset.inspectorLayout === 'columns'), 'closing preview restores docked layout');
    floating.close(); floating = undefined;
    assert.ok(await click(ui, action('detachPreview')));
    await until(() => view.frames.get('preview')?.ready && view.frames.get('preview') !== previewBefore, 'preview can be reopened');
    floating = await frame({ detached: true, state: { title: view.frames.get('preview').panel.title } });
    await until(() => dom(floating, value => document.querySelector('.preview-scroll').textContent.includes(value), value), 'reopened preview receives current saved XML');
    assert.ok(await click(floating, previewField));
    await until(() => dom(floating, selector => document.querySelector(selector)?.draggable, previewField), 'reopened detached preview retains dragging');
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
    await until(async () => await namedRow(ui, 'Name', 'contextmenu') && await dom(ui, () => !!document.querySelector('[data-edit-action=addElement]')), 'right click an ordinary leaf after save');
    assert.equal(await dom(ui, () => document.querySelector('[data-edit-action=addElement]').textContent.trim()),
      vscode.env.language.startsWith('ru') ? 'Добавить' : 'Add');
    assert.ok(await click(ui, action('addElement')));
    assert.ok(await setValue(ui, 'dialog select[required]', 'LabelDecoration', 'change'));
    assert.ok(await setValue(ui, 'dialog input[required]', leaf));
    await submit(ui);
    await until(() => selected(ui).then(value => value === leaf), 'new sibling selected');
    assert.match(await read(), /name="Name"[^]*?name="EditorLeaf"[^]*?name="Action"/);
    assert.ok(await click(ui, action('moveUp')));
    await until(async () => /name="EditorLeaf"[^]*?name="Name"/.test(await read()) && !view.editor.dirty, 'move within siblings');
    await until(() => dom(ui, () => document.querySelector('[data-edit-action=moveUp]')?.disabled), 'up disabled at first child');
    assert.equal(await drag(ui, '[data-form-attribute="attributes:Name"]', group, 0.5), 'inside');
    await until(async () => /name="EditorGroup"[^]*?<DataPath>Name<\/DataPath>/.test(await read()) && !view.editor.dirty, 'attribute drop creates a bound child');
    assert.match(await read(), /<Attribute name="Name"/);
    assert.equal(await drag(ui, '[data-form-attribute="attributes:Name"]', 'Action', 0.05), 'before');
    await until(async () => /name="Name2"[^]*?<DataPath>Name<\/DataPath>[^]*?name="Action"/.test(await read()) && !view.editor.dirty, 'attribute drop uses line insertion');
    const beforeRemoval = await read();
    await until(() => namedRow(ui, group, 'contextmenu'), 'delete nested group');
    assert.ok(await click(ui, action('remove')));
    assert.ok(await click(ui, 'dialog input[type=checkbox][required]'));
    await submit(ui);
    await until(async () => { const xml = await read(); return !xml.includes('name="EditorGroup"') && !xml.includes('name="Name1"') && !view.editor.dirty; }, 'entire deleted subtree disappears');
    assert.match(await read(), /<Attribute name="Name"/);
    await until(() => click(ui, action('undo')), 'saved undo command available');
    await until(async () => await read() === beforeRemoval && !view.editor.status.saving, 'undo restores complete subtree bytes on disk');
    const current = await read();
    assert.equal(view.editor.dirty, false);
    assert.equal(await dom(ui, () => !!document.querySelector('[data-edit-action=save]')), false, 'successful edits need no Save button');
    assert.ok((await read()).includes('<!-- keep this -->\r\n'));
    await until(() => dom(ui, () => !document.querySelector('[data-edit-action=undo]')?.disabled), 'saved undo available');
    await until(() => click(ui, action('undo')), 'saved undo command available');
    await until(async () => !(await read()).includes('name="Name2"'), 'saved undo affects only last action');
    await until(() => dom(ui, () => !document.querySelector('[data-edit-action=redo]')?.disabled), 'saved redo available');
    await until(() => click(ui, action('redo')), 'saved redo command available');
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
    assert.match(await read(), /<ConditionalAppearance[ >][^]*?#AABBCC/);
    assert.match(await read(), /<dcsset:comparisonType>Filled<\/dcsset:comparisonType>/);
    assert.match(await read(), /<dcsset:field>Name<\/dcsset:field>/);
    await until(async () => (await read()).includes('#AABBCC') && !view.editor.dirty && !view.editor.status.saving, 'conditional appearance saved automatically');
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
    await until(() => setValue(ui, title, 'Saved after reopening'), 'edit the reopened field');
    await until(async () => (await read()).includes('Saved after reopening') && !reopened.editor.dirty, 'reopened form autosaved');
    const persisted = await read();
    reopened.frames.get('main').panel.dispose();
    ui.close();
    await until(() => service.views.size === 0, 'all form views closed');
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    let restored;
    await until(() => {
      restored = [...service.views.values()][0];
      return restored?.editor?.schema?.writable && restored.phase === 'ready';
    }, 'automatically saved form restored after all views closed');
    assert.equal(await read(), persisted);
    assert.equal(restored.editor.dirty, false);
    // A native editor may address the same source through a directory symlink/junction.
    const alias = path.join(fixture.root, 'form alias [Кириллица]');
    await fs.symlink(path.dirname(file), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliased = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(alias, path.basename(file))));
    await vscode.window.showTextDocument(aliased, { preview: false });
    const unsaved = new vscode.WorkspaceEdit();
    unsaved.insert(aliased.uri, new vscode.Position(0, 0), '<!-- unsaved native source -->');
    assert.equal(await vscode.workspace.applyEdit(unsaved), true);
    assert.equal(aliased.isDirty, true);
    let refused;
    await restored.editor.receive({ action: 'change', id: 901, operations: [{ kind: 'setProperty', target: { kind: 'form' },
      property: { key: { name: 'Width', namespace: 'http://v8.1c.ru/8.3/xcf/logform' }, qualifiers: [], value: { Text: '75' } } }] }, value => { refused = value; });
    // A preview refresh can invalidate the context before the dirty-buffer preflight finishes.
    assert.ok(['editDirty', 'editConflict'].includes(refused?.message), JSON.stringify(refused));
    assert.equal(await read(), persisted);
    assert.equal(aliased.isDirty, true);
    assert.ok(aliased.getText().startsWith('<!-- unsaved native source -->'));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await restored.editor.receive({ action: 'discard', id: 902 }, () => {});
    restored.frames.get('main').panel.reveal(undefined, false);
    await until(() => restored.editor.schema?.writable && restored.phase === 'ready', 'editor ready after resolving a dirty alias');
    ui = await frame({ state: { title: restored.frames.get('main').panel.title } });
    await until(() => namedRow(ui, 'Name'), 'field after dirty alias conflict');
    await until(() => setValue(ui, title, 'Saved after alias'), 'edit after dirty alias conflict');
    await until(async () => (await read()).includes('Saved after alias') && !restored.editor.dirty, 'automatic save resumes after dirty alias conflict');
    restored.frames.get('main').panel.dispose();
    await until(() => service.views.size === 0, 'close ordinary fixture before testing long form');
    await checkLongForm(fixture, service);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
      passed: true, locale: vscode.env.language, nativeWindow: true, automaticSave: true, localizedDefaultRoundtrip: true, packedProperties: true,
      exactSave: true, savedUndoRedo: true, propertySearch: true, attributeDrop: ['inside', 'before'],
      savedReopen: true, dirtySourceAlias: true, conditionalAppearance: true, previewAutoScroll: [75, 125],
    }));
  } finally { ui.close(); floating?.close(); }
};
