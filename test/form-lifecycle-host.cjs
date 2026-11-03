const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), file = fixture.form.path;
  const before = await fs.readFile(file);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const service = explorer.formPreview, connection = explorer.connection, request = connection.request.bind(connection);
  const active = new Set(), tracked = new WeakSet(), watch = service.watch.bind(service);
  function track(view) {
    for (const disposable of view.watchers) {
      if (tracked.has(disposable)) continue;
      tracked.add(disposable); active.add(disposable);
      const dispose = disposable.dispose.bind(disposable);
      const wrapped = () => { active.delete(disposable); dispose(); };
      disposable.dispose = wrapped;
      assert.equal(disposable.dispose, wrapped, 'native test can observe disposal of its own watchers');
    }
  }
  service.watch = async (view, inputs) => { await watch(view, inputs); track(view); };
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file)), results = [];
  for (const stage of ['prepare', 'open', 'update']) {
    let release, held;
    const gate = new Promise(resolve => { release = resolve; });
    connection.request = async (...args) => {
      const result = await request(...args);
      if (!held && args[1] === `form/${stage}`) {
        held = { result, params: args[2] };
        await gate;
      }
      return result;
    };
    await vscode.window.showTextDocument(document, { preview:false, viewColumn:vscode.ViewColumn.One });
    await until(() => vscode.window.activeTextEditor?.document === document, 'source editor active');
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => service.views.size === 1, 'one pending view');
    const view = [...service.views.values()][0];
    if (stage === 'update') {
      await until(() => view.phase === 'ready', 'update view ready');
      await service.receive(view, view.frames.get('main'), {type:'detach'});
      await until(() => view.frames.get('preview')?.ready, 'last consumer is a native detached preview');
      view.frames.get('main').panel.dispose();
      const edit = new vscode.WorkspaceEdit(), text = document.getText();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), text.replace('First page', 'Pending update'));
      assert.equal(await vscode.workspace.applyEdit(edit), true);
    }
    await until(() => held !== undefined, `${stage} response allocated and held`);
    track(view);
    const session = stage === 'prepare' ? undefined : stage === 'open' ? held.result.formSessionId : view.client.current.formSessionId;
    for (const frame of [...view.frames.values()]) frame.panel.dispose();
    await until(() => view.closed && service.views.size === 0, 'last consumer closed before acknowledgement');
    release();
    await Promise.all([...service.closing]);
    assert.equal(active.size, 0, `${stage}: all real file watcher subscriptions disposed`);
    if (session) await assert.rejects(request(view.tree.session.sessionId, 'form/get', {
      projectId:view.entry.project.info.projectId, generation:view.entry.project.info.generation, formSessionId:session,
    }), error => error.details?.reason === 'unknown_form_session');
    assert.equal(view.frames.size, 0);
    assert.equal(service.views.size, 0);
    results.push({stage,watchersReleased:true,sessionReleased:!!session,detached:stage==='update'});
    connection.request = request;
  }
  service.watch = watch;
  assert.deepEqual(await fs.readFile(file), before);
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formLifecycle:true,locale:vscode.env.language,sourceWritesDuringViewing:false,results}));
};
