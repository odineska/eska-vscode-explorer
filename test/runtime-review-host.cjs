const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { connect, connectWorkbench } = require('./query-constructor-dom.cjs');

const until = async (check, label) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(label);
};

exports.run = async () => {
  const { root } = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const evidence = process.env.ESKA_REVIEW_FIXTURE;
  const ru = vscode.env.language.startsWith('ru');
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await vscode.workspace.getConfiguration('eska.explorer', vscode.Uri.file(root)).update('buildExecutable', process.env.ESKA_TEST_APPLY_BINARY, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand('eska.explorer.restart');
  await until(() => explorer.connection.state.kind === 'ready', 'project connection');
  const roots = await explorer.getChildren();
  const group = roots.find(item => item.runtimeKind === 'group');
  assert.ok(group, 'explicit runtime group');
  assert.equal(explorer.getTreeItem(group).label, ru ? 'Запуск и отладка' : 'Run and Debug');
  const commands = await explorer.getChildren(group);
  assert.equal(commands.length, 6);
  for (const command of commands) {
    assert.equal(explorer.getParent(command), group);
    const item = explorer.getTreeItem(command);
    assert.equal(item.command.arguments[0].project, group.project);
  }
  const settings = roots.find(item => item.fileKind === 'group' && item.kind === 'settings');
  assert.ok(settings);
  const workbench = await connectWorkbench(until);
  await workbench.focus();
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await vscode.commands.executeCommand('eska.explorer.projects.focus');
  await explorer.view.reveal(settings, { select: true, focus: true });
  const settingsLabel = explorer.getTreeItem(settings).label;
  let previousPosition, stable = 0;
  const position = await until(async () => {
    const current = await workbench.evaluate(`(() => {
    const row = [...document.querySelectorAll('.monaco-list-row')].find(row => row.innerText.includes(${JSON.stringify(settingsLabel)}));
    if (!row) return null; const rect = row.getBoundingClientRect(), x = rect.left + rect.width / 2;
    for (let y = rect.top + 3; y < rect.bottom - 2; y += 3) {
      if (row.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    row.scrollIntoView({ block: 'center' }); return null;
    })()`);
    stable = JSON.stringify(current) === JSON.stringify(previousPosition) ? stable + 1 : 0;
    previousPosition = current;
    return current && stable >= 4 ? current : false;
  }, 'stable settings row after reveal scrolling');
  await workbench.click(position.x, position.y, 'right');
  await workbench.screenshot(path.join(evidence, 'settings-menu.png'));
  const menu = await until(() => workbench.evaluate("document.querySelector('.monaco-menu')?.innerText"), 'settings context menu');
  const labels = JSON.parse(await fs.readFile(path.join(extension.extensionPath, ru ? 'package.nls.ru.json' : 'package.nls.json'), 'utf8'));
  assert.ok(menu.includes(labels.configureProject), menu);
  for (const key of ['runTest', 'applyTest', 'debugLaunch', 'debugAttach', 'applyAndRunTest', 'applyAndDebugTest']) assert.ok(!menu.includes(labels[key]), menu);
  await workbench.key('Escape', 'Escape', 27);

  const changes = {}, display = {};
  for (let index = 0; index < 1000; index++) {
    const name = `Товар${String(index).padStart(4, '0')}`, file = `Catalogs/${name}/Ext/ManagerModule.bsl`;
    changes[file] = index % 3 === 0 ? 'added' : index % 3 === 1 ? 'modified' : 'removed';
    display[file] = { 'ru-RU': { label: `Справочник.${name}.МодульМенеджера`, group: 'Справочник' },
      'en-US': { label: `Catalog.${name}.ManagerModule`, group: 'Catalog' } };
  }
  await fs.writeFile(path.join(evidence, 'plan.json'), JSON.stringify({ schema_version: 1, kind: 'apply', status: 'preview', display,
    plan: { mode: 'incremental', target: root, platform_version: '8.3.27.2342', confirmation: 'fixture-token', changes } }));
  const update = commands.find(item => item.command.endsWith('.applyTest'));
  const open = async () => {
    const operation = vscode.commands.executeCommand(update.command, update);
    const ui = await connect(until, '#changes');
    await until(() => ui.evaluate("document.getElementById('changes').textContent.includes('Товар0999')"), 'complete review');
    assert.equal(await ui.evaluate("document.getElementById('cancel').textContent"), ru ? 'Отмена' : 'Cancel');
    return { operation, ui };
  };
  const finish = async (ui, operation, expression) => {
    // Closing the panel can destroy its Chromium target before the click reply arrives.
    await ui.evaluate(expression).catch(error => { if (!String(error).includes('debug target closed')) throw error; });
    await operation; ui.close();
  };
  try {
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await vscode.commands.executeCommand('workbench.action.closePanel');
    let { operation, ui } = await open();
    for (const [width, height] of [[1280, 900], [650, 600]]) {
      await workbench.viewport(width, height);
      let previousSize, stableSize = 0;
      await until(async () => {
        const size = await ui.evaluate('[innerWidth, innerHeight]');
        stableSize = JSON.stringify(size) === JSON.stringify(previousSize) ? stableSize + 1 : 0;
        previousSize = size;
        return size[0] < width && size[1] < height && stableSize >= 4;
      }, 'stable review viewport after workbench relayout');
      const layout = await ui.evaluate(`(() => {
        const list=document.getElementById('changes'), footer=document.querySelector('footer').getBoundingClientRect();
        list.scrollTop=list.scrollHeight;
        return { count:(list.textContent.match(/Товар[0-9]{4}/g)||[]).length, scrollable:list.scrollHeight>list.clientHeight,
          scrolled:list.scrollTop>0, footer:footer.top>=0&&footer.bottom<=innerHeight, overflow:document.documentElement.scrollWidth>innerWidth,
          text:list.textContent.includes(${JSON.stringify(ru ? 'Справочник.Товар0999.МодульМенеджера' : 'Catalog.Товар0999.ManagerModule')}) };
      })()`);
      assert.deepEqual(layout, { count: 1000, scrollable: true, scrolled: true, footer: true, overflow: false, text: true });
      if (width === 1280) await ui.evaluate("document.getElementById('changes').scrollTop=0");
      await workbench.screenshot(path.join(evidence, `review-${width}.png`));
    }
    await finish(ui, operation, "document.getElementById('cancel').click()");
    assert.equal(await fs.access(path.join(evidence, 'confirmed')).then(() => true, () => false), false);
    ({ operation, ui } = await open());
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); await operation; ui.close();
    assert.equal(await fs.access(path.join(evidence, 'confirmed')).then(() => true, () => false), false);
    ({ operation, ui } = await open());
    await finish(ui, operation, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.equal(await fs.access(path.join(evidence, 'confirmed')).then(() => true, () => false), false);
    ({ operation, ui } = await open());
    await finish(ui, operation, "document.getElementById('accept').click()");
    await fs.access(path.join(evidence, 'confirmed'));
    await vscode.commands.executeCommand('notifications.clearAll');
    await vscode.commands.executeCommand(update.command, update);
    await until(() => workbench.evaluate(`document.body.innerText.includes(${JSON.stringify(ru ? 'Тестовая база соответствует последнему применённому снимку.' : 'The test infobase matches the last applied snapshot.')})`), 'unchanged notification');
    const run = commands.find(item => item.command.endsWith('.runTest'));
    await vscode.commands.executeCommand(run.command, run);
    const calls = await fs.readFile(path.join(evidence, 'calls.log'), 'utf8');
    assert.equal(calls.split('\n').filter(line => line.includes('--confirm')).length, 1);
    assert.ok(calls.includes('"run"'));
    const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    for (const line of calls.split('\n').filter(line => line.includes('"apply"') || line.includes('"run"'))) {
      const args = JSON.parse(line);
      assert.equal(canonical(args[args.indexOf('--project-dir') + 1]), canonical(root));
    }
    await fs.writeFile(path.join(root, 'host-result.json'), JSON.stringify({ passed: true, locale: vscode.env.language, rows: 1000,
      cancelled: true, closed: true, escaped: true, confirmedOnce: true, settingsMenu: menu, runtimeCommands: commands.map(item => item.command) }));
  } finally { workbench.close(); }
};
