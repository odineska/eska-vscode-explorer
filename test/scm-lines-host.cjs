const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');
const { attachScm } = require('./scm-view-host.cjs');

/** Real installed host: ESKA owns the diff, index and save while native Git is disabled. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const root = fixture.root;
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)));
  const git = async (...args) => (await execFile('git', args, { cwd: root, env, encoding: 'buffer' })).stdout;
  const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const lines = values => Buffer.from(values.join('\r\n') + '\r\n');
  const original = ['// baseline', '// adjacent A', '// adjacent B', '// separator', '// delete A', '// delete B', '// end'];
  const modified = ['// baseline', '// chosen A 😀', '// retained B Я', '// separator', '// delete B', '// end'];
  const staged = [original[0], modified[1], ...original.slice(2, 4), ...original.slice(5)];
  const untracked = path.join(root, 'selected-new.bsl');
  const checks = [];
  let ui;
  try {
    assert.equal(vscode.workspace.getConfiguration('git').get('enabled'), false);
    assert.equal(vscode.workspace.getConfiguration('eska.explorer').get('scm.mode'), 'eska');
    await fs.writeFile(path.join(root, '.gitignore'), '.eska/\n.vscode/\nhost-result.json\n');
    await vscode.workspace.getConfiguration('diffEditor').update('renderSideBySide', true, vscode.ConfigurationTarget.Workspace);
    await fs.writeFile(fixture.module, lines(original));
    await git('init');
    await git('config', 'core.autocrlf', 'false');
    await git('config', 'user.name', 'ESKA line selection');
    await git('config', 'user.email', 'scm@example.invalid');
    await git('config', 'commit.gpgSign', 'false');
    await git('add', '.');
    await git('commit', '-m', 'Line staging baseline');
    await fs.writeFile(fixture.module, lines(modified));
    await fs.writeFile(untracked, lines(['// new first', '// selected new 😀', '// new last']));
    await vscode.workspace.getConfiguration('files').update('readonlyInclude', { '**/*.bsl': true }, vscode.ConfigurationTarget.Workspace);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture.module));
    await vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer').activate();
    await command('eska.explorer.connect');
    await command('eska.explorer.scm.focus');
    ui = await attachScm();
    async function open(file) {
      let context;
      await until(async () => {
        context = await ui.webview(`[...document.querySelectorAll('.scm-row')].filter(row => row.querySelector('.scm-row-target')?.title.includes(${JSON.stringify(file)})).map(row => JSON.parse(row.dataset.vscodeContext)).find(value => value.eskaScmGroup !== 'index')`);
        return context;
      }, `working row ${relative(file)}`);
      await command('eska.explorer.scm.diff', { ...context, webview: 'eska.explorer.scm' });
      await until(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.isActive && tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.fsPath === file), 'ESKA native diff');
      const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.isActive && tab.input instanceof vscode.TabInputTextDiff);
      assert.equal(tab.input.original.scheme, 'eska-scm');
      assert.equal(tab.input.modified.scheme, 'file');
      const expected = await git('show', ':' + relative(file)).catch(() => Buffer.alloc(0));
      const normalize = text => text.replace(/\r\n/g, '\n');
      await until(() => vscode.workspace.textDocuments.some(doc => doc.uri.toString() === tab.input.original.toString() && normalize(doc.getText()) === normalize(expected.toString())), 'diff index model catches up with staged bytes');
      return tab.input;
    }
    async function select(input, side, line, menu = false) {
      const uri = side === 'original' ? input.original : input.modified;
      await command(side === 'original' ? 'workbench.action.compareEditor.focusSecondarySide' : 'workbench.action.compareEditor.focusPrimarySide');
      await until(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(), `focus ${side} diff pane`);
      const editor = vscode.window.activeTextEditor;
      editor.selection = new vscode.Selection(line, 0, line, editor.document.lineAt(line).text.length);
      editor.revealRange(editor.selection);
      if (menu && process.env.ESKA_HOST_LINES_DIRECT !== '1') {
        const label = vscode.env.language.startsWith('ru') ? 'Индексировать выбранные строки' : 'Stage Selected Lines';
        const selector = '.part.editor .monaco-action-bar [aria-label]';
        await until(() => ui.workbench(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(node => node.getAttribute('aria-label').startsWith(${JSON.stringify(label)}) && node.getBoundingClientRect().width > 0)`), 'Stage Selected Lines in editor title');
        assert.equal(await ui.workbench(`(() => { const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.getAttribute('aria-label').startsWith(${JSON.stringify(label)}) && node.getBoundingClientRect().width > 0); if (!item) return false; item.click(); return true; })()`), true);
      } else await command('eska.explorer.scm.stageLines');
    }
    const trackedDiff = await open(fixture.module);
    await select(trackedDiff, 'modified', 1, true);
    await until(async () => (await git('show', ':' + relative(fixture.module))).equals(lines([original[0], modified[1], ...original.slice(2)])), 'only selected adjacent replacement staged');
    checks.push('right-adjacent-selection-crlf-readonly');
    if (process.env.ESKA_HOST_LINES_DIRECT !== '1') checks.push('editor-title-stage-action');
    await select(await open(fixture.module), 'original', 4);
    await until(async () => (await git('show', ':' + relative(fixture.module))).equals(lines(staged)), 'only selected left deletion staged');
    checks.push('left-deletion');
    await select(await open(untracked), 'modified', 1);
    await until(async () => (await git('show', ':' + relative(untracked))).equals(lines(['// selected new 😀'])), 'only selected new-file line staged');
    checks.push('new-file-empty-original');
    assert.deepEqual(await fs.readFile(fixture.module), lines(modified));
    assert.deepEqual(await fs.readFile(untracked), lines(['// new first', '// selected new 😀', '// new last']));
    await command('eska.explorer.scm.focus');
    await ui.pointer('textarea', 'left');
    await ui.insertText('Only selected lines');
    await until(() => ui.webview("document.querySelector('textarea')?.value === 'Only selected lines' && !document.querySelector('.scm-commit')?.disabled"), 'commit draft acknowledged');
    let revision, stableSince = Date.now();
    await until(async () => { const next = await ui.webview("document.querySelector('.scm-repository')?.dataset.vscodeContext"); if (next !== revision) { revision = next; stableSince = Date.now(); } return Date.now() - stableSince > 350; }, 'stable SCM save snapshot');
    await ui.pointer('.scm-commit', 'left');
    await until(async () => (await git('log', '-1', '--format=%s')).toString().trim() === 'Only selected lines', 'ESKA saves selected index');
    assert.deepEqual(await git('show', 'HEAD:' + relative(fixture.module)), lines(staged));
    assert.deepEqual(await git('show', 'HEAD:' + relative(untracked)), lines(['// selected new 😀']));
    assert.deepEqual(await fs.readFile(fixture.module), lines(modified));
    assert.deepEqual(await fs.readFile(untracked), lines(['// new first', '// selected new 😀', '// new last']));
    assert.equal((await git('diff', '--cached', '--name-only')).length, 0);
    assert.deepEqual((await git('diff', '--name-only', '-z')).toString().split('\0').filter(Boolean).sort(), [relative(fixture.module), relative(untracked)].sort());
    checks.push('save-selected-bytes-retain-working-tree');
    await fs.writeFile(path.join(root, 'host-result.json'), JSON.stringify({ passed: true, checks, version: vscode.version, gitEnabled: false }));
  } catch (error) {
    await fs.writeFile(path.join(root, 'host-result.json'), JSON.stringify({ passed: false, checks, error: String(error.stack ?? error), gitStatus: (await git('status', '--porcelain').catch(() => Buffer.alloc(0))).toString(), indexText: (await git('show', ':' + relative(fixture.module)).catch(() => Buffer.alloc(0))).toString(), active: { uri: vscode.window.activeTextEditor?.document.uri.toString(), tab: vscode.window.tabGroups.activeTabGroup.activeTab?.input, documents: vscode.workspace.textDocuments.map(doc => ({ uri: doc.uri.toString(), dirty: doc.isDirty, text: doc.uri.fsPath === fixture.module ? doc.getText() : undefined })), contextCommands: (await vscode.commands.getCommands(true)).filter(id => /contextMenu|ContextMenu/.test(id)) }, dom: ui ? await ui.workbench(`({ menus: [...document.querySelectorAll('.monaco-menu, .context-view')].map(node => node.outerHTML).join('\\n'), title: document.querySelector('.part.editor')?.innerText, editorInputs: [...document.querySelectorAll('.part.editor textarea, .part.editor [role=textbox]')].map(node => ({ html: node.outerHTML, parent: node.parentElement.outerHTML.slice(0,500) })), notifications: [...document.querySelectorAll('.notification-toast')].map(node => node.innerText) })`).catch(String) : undefined }));
    throw error;
  } finally { ui?.close(); }
};
