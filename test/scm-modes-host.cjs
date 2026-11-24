const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');
const { attachScm } = require('./scm-view-host.cjs');

/** Installed-host regression: ownership is local to the manifested workspace folder. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const uri = vscode.Uri.file(fixture.root);
  const output = path.join(fixture.root, 'host-result.json');
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)));
  const git = async (root, ...args) => (await execFile('git', ['-C', root, ...args], { env: gitEnv })).stdout;
  const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const native = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
  const roots = () => native.repositories.map(repo => repo.rootUri.fsPath).sort();
  const nativeRepo = root => native.repositories.find(repo => repo.rootUri.fsPath === root);
  const initialGitSettings = ['enabled', 'autorefresh', 'ignoredRepositories', 'autoRepositoryDetection'].map(key => [key, vscode.workspace.getConfiguration('git', uri).inspect(key)]);
  const config = () => vscode.workspace.getConfiguration('eska.explorer', uri);
  const setMode = value => config().update('scm.mode', value, vscode.ConfigurationTarget.WorkspaceFolder);
  const manifest = path.join(fixture.root, 'eska.toml');
  const manifestBytes = await fs.readFile(manifest);
  const relative = path.relative(fixture.root, fixture.module).split(path.sep).join('/');
  const baseline = await fs.readFile(fixture.module);
  const checks = [];
  let ui, lastContext;
  async function gitLogs() {
    const found = [];
    async function visit(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.name === 'Git.log') found.push({ path: file, text: (await fs.readFile(file, 'utf8')).slice(-100000) });
      }
    }
    await visit(path.join(path.dirname(fixture.root), 'profile', 'logs'));
    return found;
  }
  async function monitors() {
    if (process.platform !== 'linux') return undefined;
    const found = [];
    for (const entry of await fs.readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const args = (await fs.readFile(`/proc/${entry}/cmdline`, 'utf8')).split('\0');
        if (args.includes('monitor') && args.includes(fixture.root)) found.push({ pid: Number(entry), args });
      } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
    }
    return found;
  }
  async function expectOwners(expected, monitor) {
    await until(() => JSON.stringify(roots()) === JSON.stringify([...expected].sort()), `native roots: ${expected.join(', ')}`);
    if (process.platform === 'linux') await until(async () => (await monitors()).length === (monitor ? 1 : 0), `ESKA monitor active=${monitor}`);
  }
  const branchItems = () => ui.workbench(`(() => [...document.querySelectorAll('.part.statusbar .statusbar-item')]
    .filter(node => node.querySelector('[class*=\"codicon-git-branch\"], .codicon-git-commit') && node.getBoundingClientRect().width > 0)
    .map(node => ({ text: node.textContent.trim(), title: node.title, label: node.getAttribute('aria-label') })))()`);
  async function expectBranch(name) {
    await until(async () => { const items = await branchItems(); return items.length === 1 && items[0].text.includes(name); }, `exactly one visible branch status: ${name}`);
  }
  async function clickBranch() {
    await ui.workbench(`(() => {
      const nodes = [...document.querySelectorAll('.part.statusbar .statusbar-item')]
        .filter(node => node.querySelector('[class*=\"codicon-git-branch\"], .codicon-git-commit') && node.getBoundingClientRect().width > 0);
      if (nodes.length !== 1) throw new Error('Expected exactly one visible branch status');
      (nodes[0].querySelector('a') ?? nodes[0]).click();
    })()`);
    await until(() => ui.workbench("Boolean(document.querySelector('.quick-input-widget input:focus'))"), 'status bar click opens Quick Pick');
  }
  async function pickBranch(name) {
    await selectRepository(fixture.root);
    await clickBranch();
    await ui.insertText(name);
    await until(() => ui.workbench("[...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(row => row.textContent.includes(" + JSON.stringify(name) + "))"), `Quick Pick lists ${name}`);
    await command('workbench.action.acceptSelectedQuickOpenItem');
    await until(async () => (await git(fixture.root, 'branch', '--show-current')).trim() === name, `actual branch switched to ${name}`);
    await expectBranch(name);
  }
  async function selectRepository(root) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(root === fixture.root ? fixture.module : path.join(root, 'ordinary.txt'))));
    await command('workbench.view.scm');
    await ui.workbench(`(() => {
      const provider = [...document.querySelectorAll('.scm-view .scm-provider, .scm-repositories-view .monaco-list-row')]
        .find(row => row.querySelector('.label-name')?.textContent === ${JSON.stringify(path.basename(root))});
      // VS Code hides the repository header when only one provider remains.
      if (!provider && document.querySelectorAll('.scm-view .scm-provider').length === 0) return;
      if (!provider) throw new Error('Repository selector was not found');
      const target = provider.querySelector('.label-name') ?? provider;
      for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'mousedown' ? 1 : 0 }));
    })()`);
  }
  async function expandProviders() {
    await ui.workbench(`(() => {
      for (const row of document.querySelectorAll('.scm-view .monaco-list-row[aria-level=\"1\"][aria-expanded=\"false\"]')) {
        const target = row.querySelector('.monaco-tl-twistie');
        for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'mousedown' ? 1 : 0 }));
      }
    })()`);
  }
  const hasModule = () => ui.webview("[...document.querySelectorAll('.scm-row .scm-label')].some(node => node.textContent.includes('ObjectModule') || node.textContent.includes('МодульОбъекта'))");
  async function rowContext() {
    const context = () => ui.webview("JSON.parse([...document.querySelectorAll('.scm-row')].find(row => row.querySelector('.scm-label')?.textContent.includes('ObjectModule') || row.querySelector('.scm-label')?.textContent.includes('МодульОбъекта')).dataset.vscodeContext)");
    let current = await context(), stableSince = Date.now();
    await until(async () => {
      const next = await context();
      if (next.eskaScmRevision !== current.eskaScmRevision) { current = next; stableSince = Date.now(); }
      return Date.now() - stableSince >= 350;
    }, 'stable SCM action context');
    lastContext = current;
    return current;
  }

  try {
    assert.equal(config().get('scm.mode'), 'eska', 'default ownership is ESKA');
    await vscode.extensions.getExtension('1c-tooling.eska-explorer').activate();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.module)));
    await command('workbench.view.scm');
    await command('eska.explorer.scm.focus');
    await command('workbench.action.closeAuxiliaryBar');
    ui = await attachScm();
    const connecting = command('eska.explorer.connect');
    await until(() => ui.workbench("document.activeElement?.matches('.quick-input-widget input')"), 'multi-root project picker');
    await ui.insertText('project');
    await command('workbench.action.acceptSelectedQuickOpenItem');
    await connecting;
    await expectOwners([fixture.ordinary], true);
    checks.push('default-eska-only-manifested-root');
    const originalBranch = (await git(fixture.root, 'branch', '--show-current')).trim();
    await git(fixture.root, 'branch', 'host-status-topic');
    await git(fixture.ordinary, 'switch', '-c', 'ordinary-native');
    const monitorPids = (await monitors())?.map(item => item.pid);
    if (monitorPids) assert.equal(monitorPids.length, 1, 'one existing ESKA monitor');
    await selectRepository(fixture.root);
    await expectBranch(originalBranch);
    await clickBranch();
    await command('workbench.action.closeQuickOpen');
    assert.equal((await git(fixture.root, 'branch', '--show-current')).trim(), originalBranch, 'cancel leaves HEAD unchanged');
    await pickBranch('host-status-topic');
    await git(fixture.root, 'switch', '--detach');
    const detached = (await git(fixture.root, 'rev-parse', '--short=7', 'HEAD')).trim();
    await expectBranch(detached);
    await git(fixture.root, 'switch', originalBranch);
    await expectBranch(originalBranch);
    await selectRepository(fixture.ordinary);
    await expectBranch('ordinary-native');
    await selectRepository(fixture.root);
    await expectBranch(originalBranch);
    assert.deepEqual((await monitors())?.map(item => item.pid), monitorPids, 'branch changes reuse the resident monitor');
    assert.ok(await ui.workbench("[...document.querySelectorAll('.scm-view .scm-editor')].filter(node => node.getBoundingClientRect().height > 0).length <= 1"), 'no extra native commit input');
    assert.equal(await ui.workbench("document.querySelectorAll('.scm-view .monaco-editor[data-uri^=\"vscode-scm:eska/\"]').length"), 0, 'ESKA status provider hides its native commit input');
    checks.push('statusbar-dom-click-pick-switch-cancel-detached-external-multiroot-one-monitor');
    await expandProviders();

    await command('workbench.view.explorer');
    await new Promise(resolve => setTimeout(resolve, 500)); // Allow visibility/disposal handlers to run.
    await expectOwners([fixture.ordinary], true);
    checks.push('resident-monitor-with-scm-hidden');
    await command('eska.explorer.scm.focus');
    ui.close();
    ui = await attachScm();
    assert.equal(await hasModule(), false);
    const changed = Buffer.concat([baseline, Buffer.from('// SCM modes автономный 😀\r\n')]);
    await fs.writeFile(fixture.module, changed);
    await until(hasModule, 'autonomous ESKA sees module change');
    const ordinaryFile = path.join(fixture.ordinary, 'ordinary.txt');
    await fs.appendFile(ordinaryFile, 'native auto refresh\n');
    await until(() => nativeRepo(fixture.ordinary)?.state.workingTreeChanges.some(change => change.uri.fsPath === ordinaryFile), 'ordinary native Git still auto-refreshes');
    const nativeRow = name => ui.workbench("[...document.querySelectorAll('.scm-view:not(.scm-history-view):not(.scm-repositories-view) .label-name')].some(node => node.textContent === " + JSON.stringify(name) + ')');
    await until(() => nativeRow('ordinary.txt'), 'ordinary change is visible in native Git panel');
    assert.equal(await nativeRow('ObjectModule.bsl'), false);
    checks.push('ordinary-native-autorefresh');

    await command('eska.explorer.scm.diff', { ...await rowContext(), webview: 'eska.explorer.scm' });
    let diff;
    await until(() => { diff = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputTextDiff)?.input; return Boolean(diff); }, 'actual ESKA diff tab');
    assert.notEqual(diff.original.scheme, 'git', 'ESKA owns original revision content');
    const originalDoc = await vscode.workspace.openTextDocument(diff.original);
    const modifiedDoc = await vscode.workspace.openTextDocument(diff.modified);
    assert.deepEqual(Buffer.from(originalDoc.getText()), baseline);
    assert.deepEqual(Buffer.from(modifiedDoc.getText()), changed);
    checks.push('autonomous-diff-correct-bytes');
    await command('workbench.action.closeAllEditors');

    await command('eska.explorer.scm.stage', { ...await rowContext(), webview: 'eska.explorer.scm' });
    await until(async () => (await git(fixture.root, 'diff', '--cached', '--name-only', '-z')).split('\0').filter(Boolean).join('\n') === relative, 'ESKA stages exact file');
    await until(async () => (await rowContext()).eskaScmGroup === 'index', 'staged snapshot context');
    await command('eska.explorer.scm.unstage', { ...await rowContext(), webview: 'eska.explorer.scm' });
    await until(async () => (await git(fixture.root, 'diff', '--cached', '--name-only')).trim() === '', 'ESKA unstages exact file');
    checks.push('autonomous-stage-unstage');
    await until(async () => (await rowContext()).eskaScmGroup === 'working', 'unstaged snapshot context');
    await ui.pointer('textarea', 'left');
    await ui.insertText('ESKA autonomous modes save');
    await until(() => ui.webview("document.querySelector('textarea').value === 'ESKA autonomous modes save'"), 'autonomous commit draft');
    await ui.pointer('.scm-commit', 'left');
    await until(async () => (await git(fixture.root, 'log', '-1', '--format=%s')).trim() === 'ESKA autonomous modes save', 'eska save commits without native repository');
    assert.deepEqual(Buffer.from(await git(fixture.root, 'show', `HEAD:${relative}`)), changed);
    assert.equal((await git(fixture.root, 'diff', '--cached', '--name-only')).trim(), '');
    await until(async () => !(await hasModule()), 'ESKA save clears change');
    checks.push('autonomous-save-head-index');

    const retainedDraft = 'Retained draft across provider modes';
    await ui.pointer('textarea', 'left');
    await ui.insertText(retainedDraft);
    await until(() => ui.webview("document.querySelector('textarea').value === " + JSON.stringify(retainedDraft)), 'draft before mode changes');
    await setMode('eska');
    await vscode.workspace.getConfiguration('eska.explorer').update('scm.mode', 'vscode', vscode.ConfigurationTarget.Workspace);
    assert.equal(config().get('scm.mode'), 'eska', 'folder overrides workspace mode');
    await expectOwners([fixture.ordinary], true);
    checks.push('resource-folder-overrides-workspace');
    await setMode('vscode');
    await expectOwners([fixture.root, fixture.ordinary], false);
    await fs.appendFile(fixture.module, '// vscode mode\r\n');
    await until(() => nativeRepo(fixture.root)?.state.workingTreeChanges.some(change => change.uri.fsPath === fixture.module), 'vscode mode native update');
    assert.equal(nativeRepo(fixture.root).inputBox.value, retainedDraft, 'vscode provider receives existing ESKA draft');
    await until(() => nativeRow('ObjectModule.bsl'), 'vscode mode native module row visible');
    await selectRepository(fixture.root);
    await expectBranch(originalBranch);
    checks.push('vscode-mode-both-native-roots-no-monitor-one-branch');
    await setMode('both');
    await expectOwners([fixture.root, fixture.ordinary], true);
    ui.close();
    await command('eska.explorer.scm.focus');
    ui = await attachScm();
    await expandProviders();
    await until(() => nativeRow('ObjectModule.bsl'), 'both mode native row visible');
    await until(hasModule, 'both mode ESKA panel active');
    await until(() => ui.webview("document.querySelector('textarea').value === " + JSON.stringify(retainedDraft)), 'draft survives both mode');
    assert.ok(nativeRepo(fixture.root).state.workingTreeChanges.some(change => change.uri.fsPath === fixture.module));
    await selectRepository(fixture.root);
    await expectBranch(originalBranch);
    checks.push('both-mode-native-and-eska-one-branch');
    await setMode('eska');
    await expectOwners([fixture.ordinary], true);
    await until(() => ui.webview("document.querySelector('textarea').value === " + JSON.stringify(retainedDraft)), 'draft survives return to eska');
    await selectRepository(fixture.root);
    await expectBranch(originalBranch);
    checks.push('folder-override-back-to-eska-one-branch');
    await fs.unlink(manifest);
    await expectOwners([fixture.root, fixture.ordinary], false);
    checks.push('manifest-removal-restores-displaced-root');
    await fs.writeFile(manifest, manifestBytes);
    await expectOwners([fixture.ordinary], true);
    checks.push('manifest-return-resumes-eska');
    if (process.env.ESKA_HOST_SCM_GIT_DISABLED === '1') {
      const gitConfiguration = vscode.workspace.getConfiguration('git');
      const previous = gitConfiguration.inspect('enabled').workspaceValue;
      try {
        await gitConfiguration.update('enabled', false, vscode.ConfigurationTarget.Workspace);
        await until(() => vscode.workspace.getConfiguration('git').get('enabled') === false, 'native Git disabled dynamically');
        await expectOwners([], true);
        ui.close();
        await command('eska.explorer.scm.focus');
        ui = await attachScm();
        await expectBranch(originalBranch);
        await git(fixture.root, 'branch', 'host-status-git-disabled');
        await pickBranch('host-status-git-disabled');
        await pickBranch(originalBranch);
        if (process.platform === 'linux') assert.equal((await monitors()).length, 1, 'Git disabled retains one monitor');
        await fs.writeFile(fixture.module, changed);
        await until(async () => !(await hasModule()), 'ESKA independent clean snapshot with Git disabled');
        await fs.appendFile(fixture.module, '// git.enabled=false autonomy\r\n');
        await until(hasModule, 'ESKA watches changes with Git disabled');
        await command('eska.explorer.scm.stage', { ...await rowContext(), webview: 'eska.explorer.scm' });
        await until(async () => (await git(fixture.root, 'diff', '--cached', '--name-only', '-z')).split('\0').filter(Boolean).join('\n') === relative, 'ESKA stages with Git disabled');
        await until(async () => (await rowContext()).eskaScmGroup === 'index', 'Git-disabled staged context');
        await command('eska.explorer.scm.unstage', { ...await rowContext(), webview: 'eska.explorer.scm' });
        await until(async () => (await git(fixture.root, 'diff', '--cached', '--name-only')).trim() === '', 'ESKA unstages with Git disabled');
        assert.ok((await git(fixture.ordinary, 'status', '--porcelain=v1')).includes('ordinary.txt'), 'ordinary checkout is preserved');
      } finally { await gitConfiguration.update('enabled', previous, vscode.ConfigurationTarget.Workspace); }
      await until(() => vscode.workspace.getConfiguration('git').get('enabled') === true, 'native Git re-enabled dynamically');
      await expectOwners([fixture.ordinary], true);
      checks.push('git-disabled-eska-independent-ordinary-restored');
    }
    const finalGitSettings = initialGitSettings.map(([key]) => [key, vscode.workspace.getConfiguration('git', uri).inspect(key)]);
    assert.deepEqual(finalGitSettings, initialGitSettings, 'Git configuration is untouched');
    checks.push('git-settings-unchanged');
    await fs.writeFile(output, JSON.stringify({ passed: true, vscode: vscode.version, checks, nativeRoots: roots(), monitors: await monitors(), diff: { original: diff.original.toString(), modified: diff.modified.toString() }, gitSettingsUnchanged: true, branchStatus: await branchItems() }));
  } catch (error) {
    await fs.writeFile(output, JSON.stringify({ passed: false, vscode: vscode.version, error: String(error.stack ?? error), checks, nativeRoots: roots(), monitors: await monitors(), lastContext, statusDom: await ui?.workbench("document.querySelector('.part.statusbar')?.outerHTML").catch(() => undefined), scmDom: await ui?.workbench("[...document.querySelectorAll('.scm-view, .scm-repositories-view')].map(node => node.outerHTML).join('\\n').slice(0, 30000)").catch(() => undefined), branchStatus: ui ? await branchItems().catch(() => undefined) : undefined, gitLogs: await gitLogs(), dom: await ui?.webview('document.body.innerText').catch(() => undefined), workbench: await ui?.workbench('document.body.innerText').catch(() => undefined), tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => ({label:tab.label,input:tab.input})) }));
    throw error;
  } finally {
    ui?.close();
    await fs.writeFile(manifest, manifestBytes);
  }
};
