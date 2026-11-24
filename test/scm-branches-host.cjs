const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');
const { attachScm } = require('./scm-view-host.cjs');
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), checks = [];
  const output = path.join(fixture.root, 'host-result.json');
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)));
  const git = async (...args) => (await execFile('git', ['-C', fixture.root, ...args], { env: gitEnv })).stdout.trim();
  const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const ru = vscode.env.language.startsWith('ru');
  let ui;
  try {
    await fs.writeFile(path.join(fixture.root, '.gitignore'), '.eska/\n.vscode/\nhost-result.json\n');
    await fs.appendFile(path.join(fixture.root, 'eska.toml'), "\n[vcs.workflow]\npreset='trunk'\n");
    await git('init'); await git('add', '.');
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Branch picker fixture');
    const initial = await git('branch', '--show-current');
    await git('branch', 'local-source'); await git('tag', 'tag-source');
    await git('branch', 'develop'); await git('branch', 'task/develop');
    await git('remote', 'add', 'origin', 'https://example.invalid/branches');
    await git('update-ref', 'refs/remotes/origin/remote-source', 'HEAD');
    await vscode.extensions.getExtension('1c-tooling.eska-explorer').activate();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.module)));
    await command('workbench.view.scm'); await command('eska.explorer.scm.focus'); await command('workbench.action.closeAuxiliaryBar');
    ui = await attachScm();
    await command('eska.explorer.connect');
    const native = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
    const monitors = async () => {
      if (process.platform !== 'linux') return [];
      const found = [];
      for (const pid of await fs.readdir('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        try { const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0'); if (args.includes('monitor') && args.includes(fixture.root)) found.push(Number(pid)); }
        catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
      }
      return found;
    };
    const assertOwners = async () => {
      assert.equal(native.repositories.filter(repo => repo.rootUri.fsPath === fixture.root).length, 0, 'ESKA does not open native Git repository');
      if (process.platform === 'linux') assert.equal((await monitors()).length, 1, 'one existing ESKA monitor');
      assert.equal((await branchItems()).length, 1, 'one branch status indicator');
    };
    const branchItems = () => ui.workbench(`([...document.querySelectorAll('.part.statusbar .statusbar-item')].filter(node => node.querySelector('[class*="codicon-git-branch"], .codicon-git-commit') && node.getBoundingClientRect().width > 0).map(node => node.textContent.trim()))`);
    const expectBranch = name => until(async () => (await branchItems()).some(item => item.includes(name)), `branch status ${name}`);
    const open = async () => {
      await ui.workbench(`(() => { const node = [...document.querySelectorAll('.part.statusbar .statusbar-item')].find(node => node.querySelector('[class*="codicon-git-branch"], .codicon-git-commit') && node.getBoundingClientRect().width > 0); if (!node) throw Error('No branch status'); (node.querySelector('a') ?? node).click(); })()`);
      await until(() => ui.workbench("Boolean(document.querySelector('.quick-input-widget input:focus'))"), 'branch Quick Pick');
    };
    const pick = async label => {
      await ui.insertText(label);
      await until(() => ui.workbench(`[...document.querySelectorAll('.quick-input-widget .monaco-list-row')].some(row => row.textContent.includes(${JSON.stringify(label)}))`), `picker lists ${label}`);
      await command('workbench.action.acceptSelectedQuickOpenItem');
    };
    await expectBranch(initial);
    await assertOwners();
    await open(); await command('workbench.action.closeQuickOpen');
    assert.equal(await git('branch', '--show-current'), initial); checks.push('status-click-cancel');
    await open();
    // Keep the first query empty: use keyboard navigation to select Create from,
    // so VS Code asks for the new name after the source picker.
    await command('workbench.action.quickOpenSelectNext');
    await command('workbench.action.acceptSelectedQuickOpenItem');
    await until(() => ui.workbench("document.querySelector('.quick-input-widget input')?.getAttribute('placeholder')?.includes(" + JSON.stringify(ru ? 'откуда' : 'create') + ")"), 'create from source picker');
    await pick('tag-source');
    await until(() => ui.workbench("Boolean(document.querySelector('.quick-input-widget .quick-input-message'))"), 'branch name input');
    await ui.insertText('from-tag'); await command('workbench.action.acceptSelectedQuickOpenItem');
    await until(async () => await git('branch', '--show-current') === 'from-tag', 'created tag branch checkout');
    await expectBranch('from-tag'); checks.push('create-from-tag-name-then-checkout');
    await open(); await pick('local-source');
    await until(async () => await git('branch', '--show-current') === 'local-source', 'local checkout');
    await expectBranch('local-source'); checks.push('local-checkout');
    await open(); await pick('origin/remote-source');
    await until(async () => await git('branch', '--show-current') === 'remote-source', 'remote checkout');
    assert.equal(await git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/remote-source');
    await expectBranch('remote-source'); checks.push('remote-tracking-checkout');
    // Exercise the real status indicator with colliding literal/task names and
    // separate index/worktree images. Reading durable metadata proves a shelf,
    // rather than a checkout that happened to retain dirty files.
    const relativeModule = path.relative(fixture.root, fixture.module).split(path.sep).join('/');
    const base = await fs.readFile(fixture.module);
    const staged = Buffer.concat([base, Buffer.from('\r\n// staged shelf bytes\r\n')]);
    const worktree = Buffer.concat([staged, Buffer.from('// saved worktree bytes: точность\r\n')]);
    const untracked = path.join(fixture.root, 'shelf-untracked.bsl');
    const untrackedBytes = Buffer.from('\ufeff// untracked shelf bytes\r\n');
    await fs.writeFile(fixture.module, staged); await git('add', '--', relativeModule);
    await fs.writeFile(fixture.module, worktree); await fs.writeFile(untracked, untrackedBytes);
    await open(); await pick('develop');
    await until(async () => await git('branch', '--show-current') === 'develop', 'literal develop checkout, not task/develop');
    await expectBranch('develop');
    assert.equal(await git('status', '--porcelain'), '', 'target branch has clean index and worktree');
    assert.deepEqual(await fs.readFile(fixture.module), base);
    await assert.rejects(fs.stat(untracked), { code: 'ENOENT' });
    const shelfRoot = path.join(fixture.root, '.git', 'eska-shelves');
    const shelves = [];
    for (const id of await fs.readdir(shelfRoot)) {
      try { shelves.push(JSON.parse(await fs.readFile(path.join(shelfRoot, id, 'metadata.json'), 'utf8')).shelf); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const shelf = shelves.find(item => Buffer.from(item.branch).toString() === 'refs/heads/remote-source');
    assert.ok(shelf, 'durable shelf belongs to the actual source branch');
    assert.ok(shelf.files.some(item => Buffer.from(item.path).toString() === relativeModule));
    assert.ok(await git('rev-parse', '--verify', `refs/eska/shelves/${shelf.id}`), 'shelf protects real Git objects');
    checks.push('literal-develop-clean-with-source-shelf');
    await open(); await pick('remote-source');
    await until(async () => await git('branch', '--show-current') === 'remote-source', 'return through branch status UI');
    await expectBranch('remote-source');
    const indexBytes = (await execFile('git', ['-C', fixture.root, 'show', `:${relativeModule}`], { env: gitEnv, encoding: 'buffer' })).stdout;
    assert.deepEqual(indexBytes, staged, 'staged blob restored byte for byte');
    assert.deepEqual(await fs.readFile(fixture.module), worktree, 'saved worktree restored byte for byte');
    assert.deepEqual(await fs.readFile(untracked), untrackedBytes, 'untracked BSL restored byte for byte');
    assert.ok((await git('status', '--porcelain', '-z')).split('\0').includes(`MM ${relativeModule}`), 'partial staging remains separate');
    checks.push('status-ui-return-restores-staged-worktree-untracked-bytes');
    await assertOwners(); checks.push('single-monitor-single-indicator-no-native-duplicate');
    const config = vscode.workspace.getConfiguration('eska.explorer', vscode.Uri.file(fixture.root));
    const oldMode = config.inspect('scm.mode')?.workspaceFolderValue;
    try {
      await config.update('scm.mode', 'both', vscode.ConfigurationTarget.WorkspaceFolder);
      await until(() => native.repositories.filter(repo => repo.rootUri.fsPath === fixture.root).length === 1, 'both opens one native Git owner');
      await until(async () => (await branchItems()).length === 1, 'both has only one status indicator');
      if (process.platform === 'linux') await until(async () => (await monitors()).length === 1, 'both retains one ESKA monitor');
      checks.push('both-one-native-owner-one-status-one-eska-monitor');
      await config.update('scm.mode', 'eska', vscode.ConfigurationTarget.WorkspaceFolder);
      await until(() => native.repositories.every(repo => repo.rootUri.fsPath !== fixture.root), 'eska releases native owner');
      await expectBranch('remote-source');
      await assertOwners(); checks.push('eska-reclaims-single-owner');
    } finally { await config.update('scm.mode', oldMode, vscode.ConfigurationTarget.WorkspaceFolder); }
    await fs.writeFile(output, JSON.stringify({ passed: true, vscode: vscode.version, checks, branchItems: await branchItems() }));
  } catch (error) {
    await fs.writeFile(output, JSON.stringify({ passed: false, error: String(error.stack ?? error), checks, workbench: await ui?.workbench('document.body.innerText').catch(() => undefined) })); throw error;
  } finally { ui?.close(); }
};
