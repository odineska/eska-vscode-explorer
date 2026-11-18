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

/** Exercise trusted workbench input and built-in Git in the runner's owned project. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const git = async (...args) => (await execFile('git', args, { cwd: fixture.root })).stdout.trim();
  const command = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const russian = vscode.env.language.startsWith('ru');
  const stageTitle = russian ? 'Индексировать изменения' : 'Stage Changes';
  const semanticLabel = russian ? 'Справочник.Товары.МодульОбъекта' : 'Catalog.Товары.ObjectModule';

  await fs.writeFile(path.join(fixture.root, '.gitignore'), '.eska/\n.vscode/\nhost-result.json\n');
  await git('init');
  await git('config', 'user.name', 'ESKA SCM Test');
  await git('config', 'user.email', 'scm@example.invalid');
  await git('add', '.');
  await git('commit', '-m', 'SCM fixture');
  const gitApi = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
  const repo = await gitApi.openRepository(vscode.Uri.file(fixture.root));
  assert.ok(repo);
  const explorer = await vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer').activate();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(fixture.module)));
  await until(() => explorer.tree?.connection.state.kind === 'ready', 'ESKA project connected');
  await fs.appendFile(fixture.module, '// SCM test worktree\n');
  await repo.status();
  await command('workbench.view.scm');
  await command('eska.explorer.scm.focus');
  await command('workbench.action.closeAuxiliaryBar');

  const ui = await attachScm();
  const query = (selector, property) => ui.webview(`document.querySelector(${JSON.stringify(selector)})?.${property}`);
  const revision = async () => JSON.parse(await query('.scm-repository', 'dataset.vscodeContext')).eskaScmRevision;
  // Git/configuration events can invalidate the host before a refreshed view is painted.
  async function settleSnapshots() {
    let last = await revision(), stableSince = Date.now();
    await until(async () => {
      const current = await revision();
      if (current !== last) { last = current; stableSince = Date.now(); }
      return Date.now() - stableSince >= 300;
    }, 'stable SCM snapshot');
  }
  try {
    await until(async () => (await query('.scm-row .scm-label', 'textContent')) === semanticLabel, 'semantic worktree row');
    assert.equal(await query('.scm-commit', 'disabled'), false, 'empty commit is available');

    // Place the ESKA pane in the visible viewport without disabling built-in Git.
    await ui.workbench(`(async () => {
      for (const header of document.querySelectorAll('.part.sidebar .pane-header')) {
        const title = header.querySelector('h3')?.textContent;
        if (title && !title.startsWith('ESKA:') && header.getAttribute('aria-expanded') === 'true') header.click();
        await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
      }
    })()`);
    await command('eska.explorer.scm.focus');
    await settleSnapshots();

    await ui.pointer('.scm-row-target', 'right');
    const menuStage = `document.activeElement?.textContent.trim() === ${JSON.stringify(stageTitle)}`;
    await until(() => ui.workbench(`[...document.querySelectorAll('.context-view .action-label')].some(node => node.textContent.trim() === ${JSON.stringify(stageTitle)})`), 'VS Code context menu offers Stage Changes');
    for (let step = 0; step < 10 && !(await ui.workbench(menuStage)); step++) await ui.key('ArrowDown', 40);
    assert.equal(await ui.workbench(menuStage), true);
    await ui.key('Enter', 13);
    await until(() => repo.state.indexChanges.some(change => change.uri.fsPath === fixture.module), 'stage through VS Code context menu');

    await ui.pointer('textarea', 'left');
    await ui.insertText('native SCM commit');
    await until(() => repo.inputBox.value === 'native SCM commit', 'ESKA edits reach the native Git input box');
    const previousRevision = await revision();
    await repo.status();
    await until(async () => await revision() > previousRevision, 'status snapshot published');
    assert.equal(await query('textarea', 'value'), 'native SCM commit');
    assert.equal(await ui.webview("document.hasFocus() && document.activeElement.matches('textarea')"), true);
    await settleSnapshots();
    await ui.key('Enter', 13, process.platform === 'darwin' ? 4 : 2);
    await until(async () => await git('log', '-1', '--format=%s') === 'native SCM commit', 'keyboard shortcut commits through Git');
    await until(async () => await query('textarea', 'value') === '' && !(await query('textarea', 'disabled')), 'commit acknowledged and input cleared');

    const note = path.join(fixture.root, 'Заметка #1.txt');
    await fs.writeFile(note, 'untracked\n');
    await repo.status();
    await until(async () => (await query('.scm-row .scm-label', 'textContent')) === path.basename(note), 'literal untracked filename');
    await settleSnapshots();
    await ui.pointer('.scm-row-target');
    await ui.pointer(`.scm-row .scm-icon-button[title=${JSON.stringify(stageTitle)}]`, 'left');
    await until(() => repo.state.indexChanges.some(change => change.uri.fsPath === note), 'stage through inline button');
    await vscode.workspace.getConfiguration('git').update('useEditorAsCommitInput', true, vscode.ConfigurationTarget.Workspace);
    await until(async () => JSON.parse(await query('.scm-row', 'dataset.vscodeContext')).eskaScmGroup === 'index', 'staged snapshot published');
    await settleSnapshots();

    await ui.pointer('.scm-commit', 'left');
    await until(() => path.basename(vscode.window.activeTextEditor?.document.uri.fsPath ?? '') === 'COMMIT_EDITMSG', 'empty commit opens the native Git editor');
    assert.equal(await query('textarea', 'disabled'), true);
    const editor = vscode.window.activeTextEditor;
    await editor.edit(builder => builder.insert(new vscode.Position(0, 0), 'native editor commit\n'));
    await editor.document.save();
    await command('workbench.action.closeActiveEditor');
    await until(async () => await git('log', '-1', '--format=%s') === 'native editor commit', 'Git commits the editor message');
    await until(async () => !(await query('textarea', 'disabled')), 'native editor commit acknowledged');

    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
      passed: true, vscode: vscode.version, semanticLabel: true, contextStage: true, inlineStage: true,
      nativeInput: true, focusPreserved: true, keyboardCommit: true, emptyCommitEditor: true,
    }));
  } finally {
    ui.close();
  }
};
