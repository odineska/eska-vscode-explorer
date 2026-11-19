const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { connect } = require('./query-constructor-dom.cjs');

async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(label);
}
const field = '[data-setting="build.platform_version"] input';
const click = (ui, selector) => ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await until(() => explorer.connection.state.kind === 'ready', 'workspace connected');
  assert.ok(explorer.connection.state.session.projects.length > 1);
  const groups = await explorer.getChildren();
  const workspaceSettings = groups.find(entry => entry.fileKind === 'group' && entry.kind === 'settings' && !entry.scope.project);
  assert.ok(workspaceSettings);
  await vscode.commands.executeCommand('eska.explorer.configureProject', workspaceSettings);
  let ui = await connect(until, '.settings-page');
  try {
    await until(() => ui.evaluate('!!document.querySelector(\'[data-setting="workspace.members"]\')'), 'workspace composition loaded on opening');
    await until(() => ui.evaluate(`!!document.querySelector(${JSON.stringify(field)})`), 'workspace build field');
    await ui.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(field)}); input.value='8.3.27.2325'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click(ui, '[data-settings-action="preview"]');
    await until(() => ui.evaluate('!!document.querySelector("[data-settings-preview]")'), 'workspace preview');
    assert.ok(!(await fs.readFile(path.join(fixture.root, 'eska.toml'), 'utf8')).includes('8.3.27.2325'));
    await until(() => ui.evaluate('!document.querySelector(\'[data-settings-action="save"]\').disabled'), 'workspace save available');
    await click(ui, '[data-settings-action="save"]');
    await until(async () => (await fs.readFile(path.join(fixture.root, 'eska.toml'), 'utf8')).includes('8.3.27.2325'), 'workspace version saved');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    ui.close();
    await until(() => explorer.connection.state.kind === 'ready', 'workspace reconnected after save');
    const shared = (await explorer.getChildren()).find(entry => entry.fileKind === 'group' && entry.kind === 'settings' && !entry.scope.project);
    await vscode.commands.executeCommand('eska.explorer.configureProject', shared);
    ui = await connect(until, '.settings-page');
    await until(() => ui.evaluate(`document.querySelector(${JSON.stringify(field)})?.value === '8.3.27.2325'`), 'workspace saved version reopens');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    ui.close();
    const member = explorer.tree.projects.find(project => project.info.scope.kind === 'member');
    assert.ok(member);
    const settings = explorer.files.scopes.find(scope => scope.project === member).groups.find(group => group.kind === 'settings');
    const memberManifest = path.join(settings.scope.path, 'eska.toml');
    const originalMember = await fs.readFile(memberManifest, 'utf8');
    await vscode.commands.executeCommand('eska.explorer.configureProject', settings);
    ui = await connect(until, '.settings-page');
    await click(ui, '[data-settings-section="general"]');
    await until(() => ui.evaluate(`!!document.querySelector(${JSON.stringify(field)})`), 'member settings load');
    assert.equal(await ui.evaluate('!!document.querySelector(\'[data-setting="workspace.members"]\')'), false);
    await ui.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(field)}); input.value='8.3.28.1000'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await click(ui, '[data-settings-action="save"]');
    await until(async () => (await fs.readFile(memberManifest, 'utf8')).includes('8.3.28.1000'), 'member version saved');
    assert.notEqual(await fs.readFile(memberManifest, 'utf8'), originalMember);
    const rootManifest = await fs.readFile(path.join(fixture.root, 'eska.toml'), 'utf8');
    assert.ok(rootManifest.includes('8.3.27.2325'));
    assert.ok(!rootManifest.includes('8.3.28.1000'));
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,suite:'settings-workspace',locale:vscode.env.language,initialLoad:true,preview:true,saveReopen:true,memberIsolation:true}));
  } finally { ui.close(); }
};
