const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
let vscode;
const { until } = require('./webview-host.cjs');

/** Input goes through the workbench viewport. A sidebar webview can move when other panes fold. */
async function attachHistory() {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.ESKA_HOST_DEBUG_PORT}/json/list`)).json();
  const workbench = targets.find(target => target.type === 'page' && target.url.startsWith('vscode-file:'));
  assert.ok(workbench, 'real VS Code workbench');
  const socket = new WebSocket(workbench.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  const contexts = [];
  let serial = 0;
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.method === 'Runtime.executionContextCreated') {
      contexts.push({ contextId: response.params.context.id, sessionId: response.sessionId });
    }
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`VS Code debug command timed out: ${method}`));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async function evaluate(expression, context = {}) {
    const result = await send('Runtime.evaluate', {
      expression, contextId: context.contextId, awaitPromise: true, returnByValue: true,
    }, context.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  try {
    const attached = new Set();
    let scm;
    await until(async () => {
      await vscode.commands.executeCommand('eska.explorer.scmHistory.focus');
      const { targetInfos } = await send('Target.getTargets');
      for (const target of targetInfos) {
        if (target.type !== 'iframe' || !target.url.startsWith('vscode-webview:') || attached.has(target.targetId)) continue;
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        attached.add(target.targetId);
        await send('Runtime.enable', {}, sessionId);
      }
      for (const context of contexts) {
        try {
          if (await evaluate("Boolean(document.querySelector('.history-root'))", context)) {
            scm = context;
            return true;
          }
        } catch { /* A replaced iframe can invalidate a candidate execution context. */ }
      }
      return false;
    }, 'ESKA history webview');
    return {
      workbench: evaluate,
      webview: expression => evaluate(expression, scm),
      close: () => socket.close(),
    };
  } catch (error) {
    error.message += '\nWorkbench: ' + await evaluate('document.body.innerText').catch(String);
    error.message += '\nTargets: ' + JSON.stringify(await send('Target.getTargets').catch(String));
    socket.close();
    throw error;
  }
}

/** Construct the real repository before workspaceContains can activate the extension. */
exports.prepare = async function (fixture) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)));
  const git = async (...args) => (await execFile('git', args, { cwd: fixture.root, env })).stdout.trim();
  await fs.writeFile(path.join(fixture.root, '.gitignore'), '.eska/\n.vscode/\nhost-result.json\n');
  await git('init', '-b', 'history-main');
  await git('config', 'user.name', 'ESKA History Test');
  await git('config', 'user.email', 'history@example.invalid');
  await git('config', 'commit.gpgSign', 'false');
  await git('add', '.');
  await git('commit', '-m', 'History baseline');
  const base = await git('rev-parse', 'HEAD');
  const imported = execFile('git', ['fast-import', '--quiet'], { cwd: fixture.root, env });
  const commits = Array.from({ length: 105 }, (_, index) => {
    const message = `History prelude ${index}`;
    return `commit refs/heads/history-main\nmark :${index + 1}\ncommitter ESKA History Test <history@example.invalid> ${1700000000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nfrom ${index ? ':' + index : base}\n\n`;
  }).join('');
  imported.child.stdin.end(commits + 'done\n');
  await imported;
  await git('checkout', '-b', 'history-feature');
  await fs.writeFile(path.join(fixture.root, 'feature.txt'), 'feature branch\n');
  await git('add', 'feature.txt');
  await git('commit', '-m', 'History feature branch');
  const feature = await git('rev-parse', 'HEAD');
  await git('checkout', 'history-main');
  await fs.appendFile(fixture.module, '// main branch history\n');
  await git('add', '.');
  await git('commit', '-m', 'History main branch');
  const main = await git('rev-parse', 'HEAD');
  await git('merge', '--no-ff', 'history-feature', '-m', 'History actual merge');
  const merge = await git('rev-parse', 'HEAD');
  assert.deepEqual((await git('show', '-s', '--format=%P', merge)).split(' '), [main, feature]);
  fixture.history = { base, main, feature, merge };
};

/** Real merge topology and mode visibility in an isolated native VS Code window. */
exports.run = async function () {
  vscode = require('vscode');
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const config = vscode.workspace.getConfiguration('eska.explorer');
  const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const checks = [];
  let ui;
  try {
    await vscode.workspace.getConfiguration('git').update('enabled', false, vscode.ConfigurationTarget.Workspace);
    await config.update('scm.mode', 'eska', vscode.ConfigurationTarget.Workspace);
    const { base, main, feature, merge } = fixture.history;
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture.module));
    await vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer').activate();
    await command('eska.explorer.connect');
    await command('workbench.view.scm');
    await command('eska.explorer.scmHistory.focus');
    ui = await attachHistory();
    const removeViews = (await vscode.commands.getCommands(true)).filter(id => /scm/i.test(id) && id.endsWith('.removeView') && !id.includes('scmHistory'));
    assert.ok(removeViews.includes('eska.explorer.scm.removeView'), 'native hide view command available');
    for (const id of removeViews) await command(id);
    await command('eska.explorer.scmHistory.focus');
    ui.close();
    ui = await attachHistory();
    await until(() => ui.webview('innerHeight > 150'), 'expanded graph has a usable viewport');
    await until(() => ui.webview(`['History actual merge', 'History main branch', 'History feature branch'].every(value => document.body.innerText.includes(value))`), 'both branches and merge rendered');
    assert.equal(await ui.workbench(`[...document.querySelectorAll('.pane-header')].some(node => node.innerText.toLowerCase().includes(${JSON.stringify(vscode.env.language.startsWith('ru') ? 'eska: граф коммитов' : 'eska: commit graph')}) && node.parentElement.getBoundingClientRect().height > 0)`), true, 'history panel visible in workbench');
    const text = await ui.webview('document.body.innerText');
    assert.ok(text.includes('history-main'), 'current branch rendered');
    assert.ok(text.includes('history-feature'), 'second branch rendered');
    const mergeRow = await ui.webview(`(() => { const row = document.querySelector('[data-id="${merge}"]'); return row && { subject: row.querySelector('.history-subject')?.textContent, parents: [...row.querySelectorAll('.history-graph path[data-parent-id]')].map(edge => edge.dataset.parentId) }; })()`);
    assert.ok(mergeRow, 'merge row uses real commit ID');
    assert.ok(mergeRow.subject.includes('History actual merge'));
    assert.deepEqual(mergeRow.parents, [main, feature], 'merge graph draws both real parent edges');
    await ui.webview(`document.querySelector('[data-id="${merge}"]').click()`);
    await until(() => ui.webview(`(() => { const text = document.querySelector('.history-details')?.textContent ?? ''; return ${JSON.stringify([merge, main, feature])}.every(id => text.includes(id)); })()`), 'selected merge details show SHA and both parents');
    checks.push('real-merge-both-branches-rendered', 'merge-details-sha-parents');
    const firstPage = await ui.webview(`[...document.querySelectorAll('.history-row')].map(row => row.dataset.id)`);
    assert.equal(firstPage.length, 100, 'first history page has 100 commits');
    assert.equal(firstPage[0], merge);
    await ui.webview(`document.querySelector('.history-row').dataset.retained = 'first-page'`);
    await ui.webview(`document.querySelector('.history-more').click()`);
    await until(() => ui.webview(`document.querySelectorAll('.history-row').length === 109 && document.body.innerText.includes('History baseline')`), 'load more appends the second history page');
    assert.deepEqual(await ui.webview(`[...document.querySelectorAll('.history-row')].slice(0, 100).map(row => row.dataset.id)`), firstPage, 'first page order retained');
    assert.equal(await ui.webview(`document.querySelector('.history-row')?.dataset.retained`), 'first-page', 'first commit DOM retained');
    assert.equal(await ui.webview(`document.querySelector('.history-row')?.getAttribute('aria-pressed')`), 'true', 'selected merge retained');
    await until(() => ui.webview(`(() => { const node = document.querySelector('.history-details'); const rect = node?.getBoundingClientRect(); return !!rect && rect.height > 0 && rect.top >= -1 && rect.bottom <= innerHeight + 1 && ${JSON.stringify([merge, main, feature])}.every(id => node.textContent.includes(id)); })()`), 'selected details remain visible after second page');
    checks.push('load-more-retains-first-page-and-visible-details');
    // Exercise the real Solid DOM lifecycle, including fresh option identities on
    // every backend snapshot, unchanged selected IDs, and selector remounts.
    const selectionState = async (repositories, repository) => {
      await ui.webview(`window.postMessage(${JSON.stringify({ type: 'state', labels: {}, repositories, repository, busy: false })}, '*')`);
      await until(() => ui.webview(`document.querySelector('#history-repository')?.value === ${JSON.stringify(repository)}`), 'repository label follows graph selection after options commit');
      assert.equal(await ui.webview(`document.querySelector('#history-repository').selectedOptions[0]?.textContent`), repositories.find(item => item.id === repository).label);
    };
    const repositories = [{ id: 'first', label: 'First repository' }, { id: 'second', label: 'Second repository' }];
    await selectionState(repositories, 'first');
    await ui.webview(`document.querySelector('#history-repository').value = 'second'`);
    await selectionState(repositories, 'second');
    await selectionState(repositories, 'second');
    await selectionState([{ id: 'third', label: 'Third repository' }, repositories[1]], 'second');
    await selectionState([repositories[1], { id: 'third', label: 'Third repository' }], 'third');
    await ui.webview(`window.postMessage({ type: 'state', labels: {}, repositories: [{ id: 'third', label: 'Third repository' }], repository: 'third', busy: false }, '*')`);
    await until(() => ui.webview(`!document.querySelector('#history-repository')`), 'single repository removes selector');
    await selectionState(repositories, 'second');
    checks.push('repository-selection-after-option-replacement-and-remount');
    assert.equal(vscode.workspace.getConfiguration('git').get('enabled'), false);
    checks.push('native-git-disabled');
    await vscode.workspace.getConfiguration('git').update('enabled', true, vscode.ConfigurationTarget.Workspace);
    const gitExtension = await vscode.extensions.getExtension('vscode.git').activate();
    let nativeGit;
    await until(() => { try { nativeGit = gitExtension.getAPI(1); return true; } catch { return false; } }, 'native Git model initializes');
    await nativeGit.openRepository(vscode.Uri.file(fixture.root));
    await until(() => gitExtension.enabled && nativeGit.repositories.some(repo => repo.rootUri.fsPath === fixture.root), 'native Git enabled and repository open');
    checks.push('native-git-enabled');
    for (const mode of ['both', 'vscode']) {
      await config.update('scm.mode', mode, vscode.ConfigurationTarget.Workspace);
      await until(() => ui.workbench(`![...document.querySelectorAll('.pane-header')].some(node => node.innerText.toLowerCase().includes(${JSON.stringify(vscode.env.language.startsWith('ru') ? 'eska: граф коммитов' : 'eska: commit graph')}) && node.parentElement.getBoundingClientRect().height > 0)`), `history hidden in ${mode}`);
      checks.push(`hidden-${mode}`);
    }
    await config.update('scm.mode', 'eska', vscode.ConfigurationTarget.Workspace);
    await command('eska.explorer.scmHistory.focus');
    await until(() => ui.workbench(`[...document.querySelectorAll('.pane-header')].some(node => node.innerText.toLowerCase().includes(${JSON.stringify(vscode.env.language.startsWith('ru') ? 'eska: граф коммитов' : 'eska: commit graph')}) && node.parentElement.getBoundingClientRect().height > 0)`), 'history restored in eska mode');
    checks.push('restored-eska');
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, checks, version: vscode.version, topology: { base, main, feature, merge, parents: [main, feature] } }));
  } catch (error) {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, checks, error: String(error.stack ?? error), dom: ui ? await ui.workbench(`({text:document.body.innerText,headers:[...document.querySelectorAll('.pane-header')].map(header=>({html:header.outerHTML,parent:header.parentElement.className,rect:header.getBoundingClientRect().toJSON()}))})`).catch(String) : undefined }));
    throw error;
  } finally { ui?.close(); }
};
