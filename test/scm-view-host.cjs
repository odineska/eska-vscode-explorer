const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');

/** Input goes through the workbench viewport. A sidebar webview can move when other panes fold. */
async function attachScm() {
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
      const { targetInfos } = await send('Target.getTargets');
      for (const target of targetInfos) {
        if (target.type !== 'iframe' || !target.url.startsWith('vscode-webview:') || attached.has(target.targetId)) continue;
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        attached.add(target.targetId);
        await send('Runtime.enable', {}, sessionId);
      }
      for (const context of contexts) {
        try {
          if (await evaluate("Boolean(document.querySelector('#root > .scm-repository textarea'))", context)) {
            scm = context;
            return true;
          }
        } catch { /* A replaced iframe can invalidate a candidate execution context. */ }
      }
      return false;
    }, 'ESKA SCM webview');
    return {
      workbench: evaluate,
      webview: expression => evaluate(expression, scm),
      async pointer(selector, button = 'none') {
        const point = await evaluate(`(() => {
          const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
          return rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`, scm);
        const offset = await evaluate(`(() => {
          const frame = [...document.querySelectorAll('iframe.webview.ready')].find(node => node.offsetWidth > 0 && node.offsetHeight > 0);
          const rect = frame?.getBoundingClientRect();
          return rect && { x: rect.x, y: rect.y };
        })()`);
        assert.ok(point && offset, `visible SCM control: ${selector}`);
        const x = point.x + offset.x, y = point.y + offset.y;
        assert.equal(await evaluate(`document.elementFromPoint(${x}, ${y})?.matches('iframe.webview.ready')`), true, selector);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
        if (button === 'none') return;
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
      },
      async key(key, windowsVirtualKeyCode, modifiers = 0) {
        const options = { key, code: key, windowsVirtualKeyCode, modifiers };
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...options });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...options });
      },
      insertText: text => send('Input.insertText', { text }),
      close: () => socket.close(),
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}

/** Native input proves save semantics independently of Git smart commit and auto-refresh. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  // run-host owns this unique playground directory; the project is deliberately nested.
  const repositoryRoot = path.dirname(fixture.root);
  const relative = file => path.relative(repositoryRoot, file).split(path.sep).join('/');
  // VS Code can remove injected config values while retaining GIT_CONFIG_COUNT.
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)));
  const git = async (...args) => (await execFile('git', args, { cwd: repositoryRoot, env: gitEnv })).stdout.trim();
  const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const russian = vscode.env.language.startsWith('ru');
  const semanticLabel = russian ? 'Справочник.Товары.МодульОбъекта' : 'Catalog.Товары.ObjectModule';
  const outside = path.join(repositoryRoot, 'outside-scope.txt');
  const note = path.join(fixture.root, 'Заметка #1.txt');
  const latencyMs = {};
  const commitFiles = {};
  await vscode.workspace.getConfiguration('git').update('enableSmartCommit', false, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('git').update('autorefresh', false, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration('git').get('enableSmartCommit'), false);
  assert.equal(vscode.workspace.getConfiguration('git').get('autorefresh'), false);
  await fs.writeFile(path.join(repositoryRoot, '.gitignore'), `/*\n!/${path.basename(fixture.root)}/\n!/outside-scope.txt\n`);
  await fs.writeFile(path.join(fixture.root, '.gitignore'), '.eska/\n.vscode/\nhost-result.json\n');
  await fs.writeFile(outside, 'baseline outside project\n');
  await git('init');
  await git('config', 'user.name', 'ESKA SCM Test');
  await git('config', 'user.email', 'scm@example.invalid');
  await git('add', path.basename(fixture.root), path.basename(outside));
  await git('commit', '-m', 'SCM fixture');
  await fs.appendFile(outside, 'staged outside project must survive\n');
  await git('add', path.basename(outside));
  const outsideIndex = await git('ls-files', '--stage', '--', path.basename(outside));
  const gitApi = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
  const repo = await gitApi.openRepository(vscode.Uri.file(repositoryRoot));
  assert.ok(repo);
  const explorer = await vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer').activate();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.module)));
  if (explorer) await until(() => explorer.tree?.connection.state.kind === 'ready', 'ESKA project connected');
  else await command('eska.explorer.connect'); // Installed production activation deliberately exposes no test internals.
  await command('workbench.view.scm');
  await command('eska.explorer.scm.focus');
  await command('workbench.action.closeAuxiliaryBar');
  const ui = await attachScm();
  const query = (selector, property) => ui.webview(`document.querySelector(${JSON.stringify(selector)})?.${property}`);
  const revision = async () => JSON.parse(await query('.scm-repository', 'dataset.vscodeContext')).eskaScmRevision;
  const hasLabel = label => ui.webview(`[...document.querySelectorAll('.scm-row .scm-label')].some(node => node.textContent === ${JSON.stringify(label)})`);
  async function settleSnapshots() {
    let last = await revision(), stableSince = Date.now();
    await until(async () => {
      const current = await revision();
      if (current !== last) { last = current; stableSince = Date.now(); }
      return Date.now() - stableSince >= 300;
    }, 'stable SCM snapshot');
  }
  async function measure(name, mutation, condition) {
    const started = performance.now();
    await mutation();
    await until(condition, `monitor publishes ${name} without repository.status`);
    latencyMs[name] = Math.round(performance.now() - started);
    assert.ok(latencyMs[name] < 5000, `${name} latency ${latencyMs[name]} ms`);
  }
  async function input(message) {
    await ui.pointer('textarea', 'left');
    await ui.insertText(message);
    await until(() => repo.inputBox.value === message, 'ESKA input reaches native Git draft');
    await settleSnapshots();
  }
  async function verifySave(message, files, receiptKey) {
    await until(async () => await git('log', '-1', '--format=%s') === message, `eska save commits ${receiptKey}`);
    await until(async () => await query('textarea', 'value') === '' && !(await query('textarea', 'disabled')), 'save acknowledged and draft cleared');
    commitFiles[receiptKey] = (await git('diff-tree', '--no-commit-id', '--name-only', '-z', '-r', 'HEAD')).split('\0').filter(Boolean).sort();
    assert.deepEqual(commitFiles[receiptKey], files.map(relative).sort());
    assert.equal(await git('ls-files', '--stage', '--', path.basename(outside)), outsideIndex, 'outside scope index blob survives eska save');
    assert.equal(await git('diff', '--cached', '--name-only'), path.basename(outside), 'only pre-existing outside scope stage remains');
  }
  try {
    // Close unrelated built-in SCM panes so actual mouse coordinates reach ESKA.
    await ui.workbench(`(async () => {
      for (const header of document.querySelectorAll('.part.sidebar .pane-header')) {
        const title = header.querySelector('h3')?.textContent;
        if (title && !title.startsWith('ESKA:') && header.getAttribute('aria-expanded') === 'true') header.click();
        await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
      }
    })()`);
    await command('eska.explorer.scm.focus');
    await settleSnapshots();
    await measure('modifiedSemanticModule', () => fs.appendFile(fixture.module, '// SCM keyboard save worktree\n'), () => hasLabel(semanticLabel));
    assert.equal(await git('diff', '--cached', '--name-only', '--', relative(fixture.module)), '', 'module is unstaged before keyboard save');
    await input('ESKA keyboard save');
    assert.equal(await ui.webview("document.hasFocus() && document.activeElement.matches('textarea')"), true);
    await ui.key('Enter', 13, process.platform === 'darwin' ? 4 : 2);
    await verifySave('ESKA keyboard save', [fixture.module], 'keyboard');
    await until(async () => !(await hasLabel(semanticLabel)), 'saved module row disappears');

    const moduleContents = await fs.readFile(fixture.module);
    await command('workbench.action.closeAllEditors');
    await measure('deletedSemanticModule', () => fs.unlink(fixture.module), () => hasLabel(semanticLabel));
    await fs.writeFile(fixture.module, moduleContents);
    await until(async () => !(await hasLabel(semanticLabel)), 'restored module is clean');
    await measure('createdFile', () => fs.writeFile(note, 'untracked button save\n'), () => hasLabel(path.basename(note)));
    await measure('modifiedSemanticModuleAgain', () => fs.appendFile(fixture.module, '// SCM button save worktree\n'), () => hasLabel(semanticLabel));
    assert.equal(await git('diff', '--cached', '--name-only', '--', relative(fixture.module), relative(note)), '', 'button save inputs are unstaged');
    await input('ESKA button save');
    await ui.pointer('.scm-commit', 'left');
    await verifySave('ESKA button save', [fixture.module, note], 'button');
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
      passed: true, vscode: vscode.version, locale: vscode.env.language, fixture: fixture.root,
      gitRoot: repositoryRoot, smartCommit: false, gitAutorefresh: false,
      keyboardSave: true, buttonSave: true, unstagedSave: true, outsideStagePreserved: true,
      monitorWithoutManualGitRefresh: true, semanticLabel, latencyMs, commitFiles,
      latencyMethod: 'performance.now before filesystem mutation until semantic/literal SCM DOM label; 50ms condition polling; no suite repo.status calls',
    }));
  } catch (error) {
    const dom = await ui.webview("document.body.innerText").catch(() => undefined);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
      passed: false, error: String(error.stack ?? error), fixture: fixture.root, gitRoot: repositoryRoot,
      latencyMs, commitFiles, dom, gitStatus: await git('status', '--porcelain=v1').catch(() => undefined),
    }));
    throw error;
  } finally { ui.close(); }
};
