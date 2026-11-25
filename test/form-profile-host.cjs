const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

function tabLayout() {
  const list = document.querySelector('.taxi-tabs');
  const group = list.parentElement;
  const active = list.querySelector('[aria-selected=true]');
  const panel = document.getElementById(active.getAttribute('aria-controls'));
  const css = getComputedStyle(list);
  const horizontal = list.getAttribute('aria-orientation') === 'horizontal';
  const bounds = active.getBoundingClientRect();
  const viewport = list.getBoundingClientRect();
  return {
    representation: group.dataset.representation, selected: active.getAttribute('aria-label'),
    palette: css.colorScheme, activeFill: getComputedStyle(active).backgroundColor,
    height: active.offsetHeight, group: group.clientWidth, strip: list.clientWidth, panel: panel.offsetWidth,
    bandHeight: list.offsetHeight, scrollLeft: list.scrollLeft,
    captions: [...list.children].map(tab => [tab.clientWidth, tab.textContent.length]),
    pageVisible: panel.getAttribute('aria-hidden') === 'false' && !panel.inert,
    scroll: list.scrollWidth, crossOverflow: css.overflowY,
    verticalOverflow: list.scrollHeight - list.clientHeight,
    selectionVisible: bounds.left >= viewport.left - .5 && bounds.right <= viewport.left + list.clientWidth + .5,
    native: list.querySelectorAll('[data-native-tab-border], canvas:not([style*="display: none"])').length,
    focusTargets: [...list.children].filter(tab => tab.tabIndex === 0).length,
    panelPosition: horizontal
      ? panel.getBoundingClientRect().top - viewport.bottom
      : panel.getBoundingClientRect().left - viewport.right,
  };
}

async function checkPageTabs(ui, view, service, source, original) {
  const anchor = '<Pages name="Pages" id="4">';
  const short = 'First tab';
  const title = 'A deliberately long caption '.repeat(55).trim();
  const change = async (authored, rendered, caption = title) => {
    const text = original.toString().replace(anchor, anchor + `<PagesRepresentation>${authored}</PagesRepresentation>`)
      .replace('<Title>First</Title>', `<Title>${caption}</Title>`);
    await fs.writeFile(source, text);
    service.schedule(view, 0);
    await until(() => [...view.nodes.values()].find(node => node.kind === 'Pages')
      ?.properties.some(property => property.key.name === 'PagesRepresentation' && property.value.text === authored), 'authored tab placement');
    await until(async () => {
      const tab = await read();
      return tab.representation === rendered && tab.captions[0]?.[1] === caption.length;
    }, 'preview uses ' + rendered + ' with updated title');
    await ui.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  };
  const read = () => ui.evaluate(`(${tabLayout})()`);
  const press = key => ui.evaluate(`document.querySelector('.taxi-tabs [aria-selected=true]')
    .dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles:true, cancelable:true }))`);
  const theme = value => ui.evaluate(`(() => {
    const select = document.querySelector('select:has(option[value=vscode])');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);

  await ui.evaluate("document.querySelector('#root').style.width = '330px'");
  await change('TabsOnBottom', 'TabsOnTop', short);
  await theme('light');
  await until(async () => view.inspectorState?.ui.previewTheme === 'light' && (await read()).palette === 'light', 'light palette');
  const top = await read();
  assert.equal(top.height, 34);
  assert.equal(top.focusTargets, 1);
  assert.equal(top.native, 0);
  assert.ok(top.group <= 600 && top.scroll > top.strip && top.crossOverflow === 'hidden');
  assert.equal(top.verticalOverflow, 0);
  assert.ok(top.panelPosition >= -.5);
  await press('End');
  await until(async () => {
    const tab = await read();
    return tab.selected === 'Other' && tab.selectionVisible && tab.pageVisible;
  }, 'last horizontal tab selected and scrolled into view');
  const beforeEdit = await read();
  await change('TabsOnBottom', 'TabsOnTop');
  await until(async () => (await read()).selectionVisible, 'active tab revealed after the preceding caption grows');
  const afterEdit = await read();
  assert.equal(afterEdit.selected, beforeEdit.selected);
  assert.equal(afterEdit.strip, beforeEdit.strip);
  assert.equal(afterEdit.bandHeight, beforeEdit.bandHeight);
  assert.ok(afterEdit.scrollLeft > beforeEdit.scrollLeft);
  await change('TabsOnRightHorizontal', 'TabsOnLeftHorizontal');
  const left = await read();
  assert.equal(left.height, 44);
  assert.equal(left.selected, 'Other');
  assert.ok(left.group <= 600 && left.strip > 0
    && left.strip <= Math.min(180, left.group * .4) + 1 && left.panel >= left.group * .6 - 1);
  assert.ok(Math.abs(left.panelPosition) <= .5);
  await theme('dark');
  await until(async () => view.inspectorState?.ui.previewTheme === 'dark' && (await read()).palette === 'dark', 'dark palette');
  const dark = await read();
  assert.equal(dark.selected, left.selected);
  assert.notEqual(dark.activeFill, left.activeFill);
  await ui.evaluate("document.body.style.setProperty('--vscode-editor-background', '#ff00ff')");
  assert.equal((await read()).activeFill, dark.activeFill);
  await press('ArrowUp');
  await until(async () => (await read()).selected === title, 'vertical keyboard navigation preserves complete authored title');
  await ui.evaluate(`document.querySelector('#root').style.removeProperty('width');
    document.body.style.removeProperty('--vscode-editor-background')`);
  return { top, left, dark, captionEdit: { beforeScroll: beforeEdit.scrollLeft, afterScroll: afterEdit.scrollLeft } };
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  if (process.platform !== 'linux') {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,skipped:'8.5 geometry is calibrated for Linux'}));
    return;
  }
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  const config = path.join(fixture.source, 'Configuration.xml');
  const original = await fs.readFile(config, 'utf8');
  const source = await fs.readFile(fixture.form.path);
  const samples = [];
  let tabs;
  let ui;
  try {
    await vscode.commands.executeCommand('eska.explorer.connect');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture.form.path), { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service = explorer.formPreview;
    await until(() => [...service.views.values()].some(view => view.phase === 'ready'), 'form opened');
    const view = [...service.views.values()][0];
    ui = await frame({ state: { title: view.frames.get('main').panel.title } });
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-input[data-native-border=ready]')"), 'Taxi input painted');
    await ui.evaluate("globalThis.retainedInput = document.querySelector('.taxi-input')");
    for (const [mode, profile, native] of [['Version8_5', 'version-8.5', null], ['Taxi', 'taxi-8.3.27', 'ready'], ['Version8_5', 'version-8.5', null]]) {
      const property = `<InterfaceCompatibilityMode>${mode}</InterfaceCompatibilityMode>`;
      const changed = original.includes('<InterfaceCompatibilityMode>')
        ? original.replace(/<InterfaceCompatibilityMode>[^<]*<\/InterfaceCompatibilityMode>/, property)
        : original.replace('</Properties>', property + '</Properties>');
      await fs.writeFile(config, changed);
      service.schedule(view, 0);
      await until(() => view.snapshot.profile === profile, 'backend profile ' + profile);
      await until(async () => await ui.evaluate(`document.querySelector('.taxi-preview')?.dataset.profile === '${profile}'
        && (document.querySelector('.taxi-input').dataset.nativeBorder ?? null) === ${JSON.stringify(native)}`), 'profile paint reset ' + profile);
      const sample = await ui.evaluate(`(() => {
        const input = document.querySelector('.taxi-input');
        return {profile:document.querySelector('.taxi-preview').dataset.profile,
          retained: input === globalThis.retainedInput, native: input.dataset.nativeBorder ?? null,
          border: getComputedStyle(input).borderTopColor,
          nativeBorder: input.style.getPropertyValue('--taxi-input-native-border'), height: input.offsetHeight};
      })()`);
      assert.equal(sample.retained, true);
      assert.equal(sample.height, native ? 23 : 40);
      if (!native) {
        assert.equal(sample.nativeBorder, '');
        assert.equal(sample.border, 'rgb(153, 153, 153)');
      }
      sample.interfaceCompatibilityMode = view.snapshot.interfaceCompatibilityMode;
      assert.equal(sample.interfaceCompatibilityMode, mode);
      samples.push(sample);
    }
    try {
      tabs = await checkPageTabs(ui, view, service, fixture.form.path, source);
    } finally {
      await fs.writeFile(fixture.form.path, source);
    }
    assert.deepEqual(await fs.readFile(fixture.form.path), source);
    assert.deepEqual(ui.scriptErrors(), []);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,samples,tabs,sourceUnchanged:true}));
  } finally {
    await fs.writeFile(config, original);
    ui?.close();
    await explorer.shutdown();
  }
};
