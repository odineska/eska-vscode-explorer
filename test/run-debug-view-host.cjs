const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { connectWorkbench } = require('./query-constructor-dom.cjs');

async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(label);
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const marker = path.join(fixture.root, 'eska.toml');
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  // Do not force activation: this verifies workspaceContains/onStartupFinished in a fresh window.
  await until(() => extension.isActive, 'automatic activation before any debug, BSL or view command');
  const explorer = extension.exports;
  await explorer.projects.settled();
  assert.equal(vscode.debug.activeDebugSession, undefined);
  assert.ok(!vscode.workspace.textDocuments.some(document => document.languageId === 'bsl'));
  if (fixture.manifest) {
    assert.equal(explorer.prepared, false, 'ordinary-folder startup must not probe/install tools');
    assert.equal(explorer.attempted, false, 'ordinary-folder startup must not open a backend');
    assert.equal(explorer.selected, undefined, 'startup must not select an unrelated folder');
  }
  const workbench = await connectWorkbench(until);
  const header = `(() => {
    const element = [...document.querySelectorAll('.pane-header')].find(value => value.textContent.includes('ESKA:')
      && value.getBoundingClientRect().height > 0);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { text: element.textContent, expanded: element.getAttribute('aria-expanded'), x: rect.left + 12, y: rect.top + rect.height / 2 };
  })()`;
  const visible = () => workbench.evaluate(header);
  const evidence = { passed: false, scenarios: [], commands: [] };
  const record = name => evidence.scenarios.push(name);
  const rename = async (from, to) => {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(vscode.Uri.file(from), vscode.Uri.file(to));
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  const checkPresence = async (present, label) => {
    await until(() => (explorer.projects.folders.length > 0) === present, `${label}: detected roots`);
    await until(async () => Boolean(await visible()) === present, `${label}: native panel header`);
    record(label);
  };
  try {
    await vscode.commands.executeCommand('workbench.view.debug');
    if (fixture.manifest) {
      await checkPresence(false, 'ordinary folder before the first debug operation');
      await vscode.commands.executeCommand('eska.explorer.projects.focus');
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.equal(explorer.prepared, false, 'opening/restoring the Explorer without a marker remains cheap');
      await vscode.commands.executeCommand('workbench.view.debug');
      const nested = path.join(fixture.root, 'nested');
      await fs.mkdir(nested);
      await fs.writeFile(path.join(nested, 'eska.toml'), fixture.manifest);
      await fs.writeFile(path.join(path.dirname(fixture.root), 'eska.toml'), fixture.manifest);
      await checkPresence(false, 'nested and parent markers do not enable the section');
      await fs.mkdir(marker);
      await new Promise(resolve => setTimeout(resolve, 150));
      await checkPresence(false, 'a directory named eska.toml does not enable the section');
      await fs.rm(marker, { recursive: true });
      const configuration = vscode.workspace.getConfiguration('eska.explorer', vscode.Uri.file(fixture.root));
      const executable = configuration.inspect('executable').workspaceFolderValue;
      await configuration.update('executable', path.join(fixture.root, 'missing-backend'), vscode.ConfigurationTarget.WorkspaceFolder);
      await vscode.commands.executeCommand('eska.explorer.connect');
      assert.equal(explorer.attempted, true);
      assert.notEqual(explorer.connection.state.kind, 'ready');
      await configuration.update('executable', executable, vscode.ConfigurationTarget.WorkspaceFolder);
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(vscode.Uri.file(marker), { contents: Buffer.from(fixture.manifest) });
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await checkPresence(true, 'creating the root marker enables the section without reload');
      const run = explorer.projectRuntime.run;
      let chosen;
      explorer.projectRuntime.run = async project => { chosen = project.root; };
      try { await vscode.commands.executeCommand('eska.explorer.runTest'); }
      finally { explorer.projectRuntime.run = run; }
      assert.equal(chosen, fixture.root);
      record('a runtime action retries a previously failed connection after the root marker appears');
    } else {
      await checkPresence(true, 'fresh project exposes the native section before F5, green button and BSL');
    }
    const state = await visible();
    if (state.expanded === 'false') await workbench.click(state.x, state.y);
    const commands = await explorer.runDebug.getChildren();
    const items = commands.map(command => explorer.runDebug.getTreeItem(command));
    const labels = items.map(item => item.label);
    evidence.commands = items.map(item => ({ command: item.command.command, label: item.label, icon: item.iconPath.id }));
    assert.deepEqual(items.map(item => item.command.command.split('.').at(-1)),
      ['runTest', 'debugLaunch', 'debugAttach', 'applyTest', 'applyAndRunTest', 'applyAndDebugTest']);
    await until(async () => workbench.evaluate(`(() => {
      const labels = ${JSON.stringify(labels)};
      const text = document.querySelector('.sidebar')?.textContent ?? '';
      return labels.every(label => text.includes(label));
    })()`), 'all six existing command labels are visible after normal expansion');
    record('six existing commands, labels, order and icons');
    await until(() => explorer.connection.state.kind === 'ready', 'fixture metadata connection');
    const original = await fs.readFile(marker, 'utf8');
    await fs.writeFile(marker, '[project invalid');
    await new Promise(resolve => setTimeout(resolve, 200));
    await checkPresence(true, 'invalid TOML does not hide the section');
    assert.equal((await explorer.runDebug.getChildren()).length, 6);
    await fs.writeFile(marker, original);
    await rename(marker, `${marker}.disabled`);
    await checkPresence(false, 'renaming the last marker hides the section');

    const { createTreeProject } = await import('./fixture.mjs');
    const second = await createTreeProject(path.join(path.dirname(fixture.root), 'second'));
    const third = await createTreeProject(path.join(path.dirname(fixture.root), 'third'));
    assert.equal(vscode.workspace.updateWorkspaceFolders(1, 0, { uri: vscode.Uri.file(second.root), name: 'second' }), true);
    await checkPresence(true, 'adding a matching workspace folder enables the section');
    const calls = [];
    const originals = { run: explorer.projectRuntime.run, apply: explorer.projectRuntime.apply, startDebug: explorer.projectRuntime.startDebug };
    // Exercise the real registered handlers and project chooser, intercepting only the final DB operations.
    explorer.projectRuntime.run = async project => calls.push({ action: 'run', root: project.root });
    explorer.projectRuntime.apply = async (project, after) => calls.push({ action: 'apply', after, root: project.root });
    explorer.projectRuntime.startDebug = async (project, mode) => calls.push({ action: 'debug', mode, root: project.root });
    try {
      for (const item of items) await vscode.commands.executeCommand(item.command.command);
      assert.equal(calls.length, 6); assert.ok(calls.every(call => call.root === second.root));
      assert.deepEqual(calls.map(call => call.action), ['run', 'debug', 'debug', 'apply', 'apply', 'apply']);
      assert.deepEqual(calls.filter(call => call.action === 'debug').map(call => call.mode), ['launch', 'attach']);
      assert.deepEqual(calls.filter(call => call.action === 'apply').map(call => call.after), [undefined, 'run', 'debug']);
      record('all six existing handlers target the recognized second folder, never the unrelated first folder');
      assert.equal(vscode.workspace.updateWorkspaceFolders(2, 0, { uri: vscode.Uri.file(third.root), name: 'third' }), true);
      await until(() => explorer.projects.folders.length === 2, 'two matching roots');
      const command = vscode.commands.executeCommand('eska.explorer.runTest');
      await until(async () => workbench.evaluate(`(() => {
        const picker = document.querySelector('.quick-input-widget');
        return picker && getComputedStyle(picker).display !== 'none' && picker.textContent.includes('second') && picker.textContent.includes('third');
      })()`), 'ambiguous runtime command opens the existing folder picker');
      await workbench.submitInput('third'); await command;
      assert.equal(calls.at(-1).root, third.root);
      record('ambiguous roots require an explicit choice and use the selected third project');
    } finally { Object.assign(explorer.projectRuntime, originals); }
    assert.equal(vscode.workspace.updateWorkspaceFolders(1, 2), true);
    await checkPresence(false, 'removing matching folders hides the section');
    await rename(`${marker}.disabled`, marker);
    await checkPresence(true, 'restoring the root marker shows the section again');
    const deletion = new vscode.WorkspaceEdit(); deletion.deleteFile(vscode.Uri.file(marker));
    assert.equal(await vscode.workspace.applyEdit(deletion), true);
    await checkPresence(false, 'deleting the final root marker hides the section');
    assert.equal(vscode.debug.activeDebugSession, undefined, 'no real debug session or database operation');
    assert.ok(!vscode.workspace.textDocuments.some(document => document.languageId === 'bsl'));
    assert.equal(await fs.stat(path.join(fixture.root, '.vscode', 'launch.json')).then(() => true, () => false), false);
    evidence.passed = true;
  } catch (error) {
    evidence.error = String(error.stack ?? error);
    evidence.workspace = { folders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()),
      roots: explorer.projects.folders.map(folder => folder.uri.toString()), disposed: explorer.disposed,
      watcherExclude: vscode.workspace.getConfiguration('files').get('watcherExclude') };
    evidence.native = await workbench.evaluate(`({ text: document.querySelector('.sidebar')?.textContent,
      dialogs: [...document.querySelectorAll('.monaco-dialog-box')].map(item => item.textContent),
      panes: [...document.querySelectorAll('.pane-header')].map(item => ({ text: item.textContent, expanded: item.getAttribute('aria-expanded') })) })`).catch(() => undefined);
    throw error;
  } finally {
    if (process.env.ESKA_HOST_DOM_ARTIFACTS) {
      await fs.mkdir(process.env.ESKA_HOST_DOM_ARTIFACTS, { recursive: true });
      await workbench.screenshot(path.join(process.env.ESKA_HOST_DOM_ARTIFACTS, fixture.manifest ? 'run-debug-startup.png' : 'run-debug-project.png'));
      if (!evidence.passed) await fs.cp(path.join(path.dirname(fixture.root), 'profile', 'logs'),
        path.join(process.env.ESKA_HOST_DOM_ARTIFACTS, 'logs'), { recursive: true });
    }
    workbench.close();
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify(evidence));
  }
};
