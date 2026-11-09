const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

async function replace(document, from, to) {
  const text = document.getText(), offset = text.indexOf(from); assert.ok(offset >= 0, from);
  const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, new vscode.Range(document.positionAt(offset), document.positionAt(offset + from.length)), to);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}
/** Resize only this isolated test webview's CSS container. */
async function shellResize(ui, service, view) {
  const snapshot=view.snapshot, session=view.client.current.formSessionId, views=service.views.size;
  const messages=[], receive=service.receive, samples=[];
  service.receive=function(...args){ messages.push(args[2]?.type); return receive.apply(this,args); };
  await ui.evaluate(`globalThis.__shellResize={style:document.querySelector('#root').style.cssText,
    nodes:[...document.querySelectorAll('.taxi-form-frame,.taxi-element')],
    preferred:document.querySelector('.form-inspectors').getBoundingClientRect().height};true`);
  try {
    for(const [width,height] of [[420,360],[420,180],[980,500]]) {
      await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
      await until(async()=>await ui.evaluate(`(() => {
        const shell=document.querySelector('.form-shell'), inspector=document.querySelector('.form-inspectors');
        const h=selector=>document.querySelector(selector).getBoundingClientRect().height;
        const available=Math.max(84,shell.clientHeight-h('.form-toolbar')-h('.form-status')-5-96);
        return Math.abs(inspector.getBoundingClientRect().height-Math.max(84,Math.min(__shellResize.preferred,available)))<1;
      })()`),'inspector follows the CSS allocation');
      const sample=await ui.evaluate(`(() => {
        const rect=selector=>document.querySelector(selector).getBoundingClientRect(), shell=document.querySelector('.form-shell'), inspector=document.querySelector('.form-inspectors');
        return {width:shell.getBoundingClientRect().width,height:shell.getBoundingClientRect().height,contentWidth:shell.clientWidth,inspector:rect('.form-inspectors').height,
          preview:rect('.preview-scroll').height,toolbar:rect('.form-toolbar').height,
          tracks:getComputedStyle(inspector).gridTemplateColumns.split(' ').map(parseFloat),
          shellScrollable:shell.scrollHeight>shell.clientHeight,inspectorScrollable:inspector.scrollWidth>inspector.clientWidth,
          sameNodes:__shellResize.nodes.every(node=>node.isConnected),
          controls:[...document.querySelectorAll('.form-toolbar button,.form-zoom')].every(node=>rect('.form-toolbar').bottom>=node.getBoundingClientRect().bottom)};
      })()`);
      assert.equal(sample.width,width); assert.equal(sample.height,height); assert.ok(sample.preview>=96);
      assert.ok(sample.tracks[0]>=120&&sample.tracks[2]>=120&&sample.tracks[4]>=180);
      assert.equal(sample.sameNodes,true); assert.equal(sample.controls,true);
      if(width<428)assert.equal(sample.inspectorScrollable,true);
      if(height===180)assert.equal(sample.shellScrollable,true);
      samples.push(sample); await ui.screenshot(`form-shell-${width}-${height}-${vscode.env.language}.png`);
    }
  } finally {
    await ui.evaluate(`document.querySelector('#root').style.cssText=__shellResize.style;true`);
    await until(async()=>await ui.evaluate(`Math.abs(document.querySelector('.form-inspectors').getBoundingClientRect().height-__shellResize.preferred)<1`),'original inspector size restored');
    service.receive=receive;
  }
  assert.equal(view.snapshot,snapshot); assert.equal(view.client.current.formSessionId,session); assert.equal(service.views.size,views);
  assert.deepEqual(messages,[],'resizing publishes no webview action'); return samples;
}
async function checkCaptionThemes(ui, service, view, main) {
  if (process.platform !== 'win32') return [];
  const config = vscode.workspace.getConfiguration('workbench');
  const original = config.get('colorTheme'), results = [];
  const field = [...view.nodes.values()].find(node => node.kind === 'InputField');
  assert.ok(field);
  const style = `(() => { const title=document.querySelector('.taxi-form-title'),css=getComputedStyle(title);return {text:title.textContent,color:css.color,background:css.backgroundColor}; })()`;
  try {
    for (const [theme, kind] of [['Default Dark Modern','dark'],['Default Light Modern','light']]) {
      await config.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
      await until(() => ui.evaluate(`document.body.classList.contains('vscode-${kind}')`), 'native webview theme applied');
      await service.receive(view, main, {type:'select',identity:field.identity});
      await until(() => ui.evaluate("!document.querySelector('.taxi-form-frame').classList.contains('taxi-selected')"), 'field selected for caption baseline');
      const normal = await ui.evaluate(style);
      await service.receive(view, main, {type:'select',identity:view.snapshot.model.root.identity});
      await until(() => ui.evaluate("document.querySelector('.taxi-form-frame').classList.contains('taxi-selected')"), 'form root selected for caption contrast');
      const selected = await ui.evaluate(style);
      assert.ok(normal.text.length > 0);
      assert.notEqual(normal.color, 'rgb(255, 255, 255)', 'form caption is readable on its light background');
      assert.deepEqual(selected, normal, 'root selection preserves the readable form caption');
      results.push({theme,...selected});
      await ui.screenshot(`form-caption-${kind}-${vscode.env.language}.png`);
    }
  } finally { await config.update('colorTheme', original, vscode.ConfigurationTarget.Global); }
  if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,'caption-themes-'+vscode.env.language+'.json'),JSON.stringify(results,null,2));
  return results;
}
async function run() {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), form = fixture.form;
  assert.ok(form);
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer'); assert.ok(extension);
  const explorer = await extension.activate(); await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)); await vscode.window.showTextDocument(document, { preview: false });
  const before = await fs.readFile(form.path);
  await Promise.all([vscode.commands.executeCommand('eska.explorer.previewForm'), vscode.commands.executeCommand('eska.explorer.previewForm')]);
  const service = explorer.formPreview;
  await until(() => service.views.size === 1 && [...service.views.values()][0].phase === 'ready', 'form session opened');
  const view = [...service.views.values()][0], main = view.frames.get('main'); assert.ok(main);
  let ui = await frame({ state: { title: main.panel.title } });
  await until(async () => (await ui.evaluate("document.querySelectorAll('.taxi-input').length")) === 1, 'form DOM ready');
  await checkCaptionThemes(ui, service, view, main);
  const geometry = await ui.evaluate(`(() => { const frame=document.querySelector('.taxi-form-frame').getBoundingClientRect(), input=document.querySelector('.taxi-input').getBoundingClientRect(); return {frame:{width:frame.width,height:frame.height},input:{width:input.width,height:input.height},controlWidth:document.querySelector('.taxi-field-control').getBoundingClientRect().width,script:!!document.querySelector('script[src*="form-preview"]')}; })()`);
  assert.ok(geometry.frame.width > 400);
  const inputMaximum = process.platform === 'linux' ? 410 : Infinity;
  assert.equal(geometry.input.width,Math.min(inputMaximum,geometry.controlWidth),'automatic string respects its native allocation limit');
  assert.ok(geometry.input.width>211,'automatic string grows beyond its preferred width');
  assert.equal(geometry.script,true);
  const shellGeometry = await shellResize(ui, service, view);
  const oldRoot = await ui.evaluate("globalThis.__formRoot=document.querySelector('.taxi-form-frame');true"); assert.equal(oldRoot, true);
  assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-input--incomplete').length"), 1);
  await replace(document, '<AutoMarkIncomplete>true</AutoMarkIncomplete>', '<AutoMarkIncomplete>false</AutoMarkIncomplete>');
  await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-input--incomplete').length===0"), 'dirty XML disables the incomplete mark');
  await replace(document, '<AutoMarkIncomplete>false</AutoMarkIncomplete>', '<AutoMarkIncomplete>true</AutoMarkIncomplete>');
  await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-input--incomplete').length===1"), 'dirty XML restores the incomplete mark');
  const initialLabel = await ui.evaluate("document.querySelector('.taxi-field-label').textContent.replace(/:$/, '')");
  await replace(document, `<v8:content>${initialLabel}</v8:content>`, '<v8:content>Изменение без сохранения</v8:content>');
  await until(() => view.phase === 'ready' && JSON.stringify(view.snapshot.model).includes('Изменение без сохранения'), 'dirty model');
  await until(async () => (await ui.evaluate("document.querySelector('.taxi-field-label')?.textContent.includes('Изменение без сохранения')")), 'dirty text rendered');
  assert.equal(await ui.evaluate("globalThis.__formRoot===document.querySelector('.taxi-form-frame')"), true, 'updates preserve the Solid DOM');
  assert.deepEqual(await fs.readFile(form.path), before, 'dirty viewing writes no source');
  const first = view.snapshot.model.root.children[0].children[0];
  await ui.evaluate("document.querySelector('.taxi-input').click()");
  await until(()=>view.selected?.key?.value===first.identity.key.value,'click selection reaches the extension host');
  assert.equal(view.selected.key.value, first.identity.key.value);
  await Promise.all([service.receive(view, main, { type: 'detach' }),service.receive(view, main, { type: 'detach' })]);
  await until(() => view.frames.has('preview') && view.frames.get('preview').ready, 'detached panel ready');
  const detached = view.frames.get('preview');
  const detachedUi = await frame({detached:true, state:{title: detached.panel.title }});
  await until(async () => await detachedUi.evaluate("document.querySelectorAll('.taxi-input').length===1"), 'detached DOM ready');
  const targets = await detachedUi.targets();
  const floating=await detachedUi.nativeWindow({detached:true});assert.equal(floating.url,'about:blank','native floating workbench exists');
  await detachedUi.captureTarget(floating.targetId,`form-detached-${vscode.env.language}.png`);
  await detachedUi.evaluate("globalThis.__repeatPreviewRoot=document.querySelector('.taxi-form-frame')");
  const floatingIds=targets.filter(target=>target.type==='page'&&target.url==='about:blank').map(target=>target.targetId).sort();
  assert.equal(floatingIds.length,1,'concurrent requests open one native preview window');
  main.panel.reveal(undefined,false);await ui.focusWorkbench();
  await service.receive(view,main,{type:'detach'});
  assert.equal(view.frames.get('preview'),detached,'repeat keeps the preview panel');
  assert.deepEqual((await detachedUi.targets()).filter(target=>target.type==='page'&&target.url==='about:blank').map(target=>target.targetId).sort(),floatingIds,'repeat keeps the native window');
  assert.equal(await detachedUi.evaluate("globalThis.__repeatPreviewRoot===document.querySelector('.taxi-form-frame')"),true,'repeat keeps the rendered preview');

  await replace(document, 'Изменение без сохранения', 'Оба окна');
  await until(async () => await detachedUi.evaluate("document.querySelector('.taxi-field-label')?.textContent.includes('Оба окна')"), 'dirty update in detached window');
  const revision = view.snapshot.revision;
  const editing = await vscode.window.showTextDocument(document, { preview:false, viewColumn:vscode.ViewColumn.One });
  await ui.focusWorkbench();
  const closingAt = document.getText().indexOf('</Form>');
  assert.equal(await editing.edit(edit => edit.delete(new vscode.Range(document.positionAt(closingAt),document.positionAt(closingAt+7))),{undoStopBefore:true,undoStopAfter:true}), true);
  await until(() => view.phase === 'stale', 'invalid XML marked stale');
  assert.equal(view.snapshot.revision, revision);
  assert.equal(await detachedUi.evaluate("document.querySelector('.taxi-field-label')?.textContent.includes('Оба окна')"), true);
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
  await ui.focusWorkbench();
  if(process.env.ESKA_HOST_FOCUS_HELPER){const size=await ui.workbench('({width:window.outerWidth,height:window.outerHeight})');require('node:child_process').execFileSync('python3',[process.env.ESKA_HOST_FOCUS_HELPER,process.env.VSCODE_PID,String(size.width),String(size.height)]);}
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await ui.clickWorkbench('.monaco-editor .margin');

  await vscode.commands.executeCommand('undo');
  await until(() => view.phase === 'ready', 'XML undo restores preview');
  const versionAfterUndo=document.version;
  await vscode.commands.executeCommand('redo');await until(()=>view.phase==='stale','XML redo updates stale preview');
  await vscode.commands.executeCommand('undo');await until(()=>view.phase==='ready'&&document.version>versionAfterUndo,'second undo restores preview');
  await service.receive(view, detached, { type: 'dock' });
  await until(() => !view.frames.has('preview'), 'preview returned');
  main.panel.reveal(); ui = await frame({ state: { title: main.panel.title } });
  await ui.screenshot(`form-preview-${vscode.env.language}.png`);
  const changedSource = document.getText();
  await document.save();
  await until(() => view.phase === 'ready' && view.client.current.dependencies[0].version === null, 'save switches back to file input');
  await fs.writeFile(form.path, changedSource.replace('Оба окна', 'Внешний файл'));
  await until(() => view.phase === 'ready' && JSON.stringify(view.snapshot.model).includes('Внешний файл'), 'external change');
  await service.receive(view, main, { type: 'locate', target: { kind: 'element', identity: first.identity } });
  assert.ok(vscode.window.activeTextEditor?.document.uri.fsPath === form.path);
  assert.ok(vscode.window.activeTextEditor.selection.end.isAfter(vscode.window.activeTextEditor.selection.start));
  // The first disk snapshot can be malformed before a session has any dependencies.
  const secondText = await fs.readFile(form.second, 'utf8');
  await fs.writeFile(form.second, secondText.replace('</Form>', ''));
  const secondDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(form.second));
  await vscode.window.showTextDocument(secondDocument, { preview: false, viewColumn: vscode.ViewColumn.One });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(() => service.views.size === 2, 'independent second form');
  const second = [...service.views.values()].find(item => sameSourcePath(item.path,form.second));
  await until(() => second.watchers.length > 0 && !second.client && !second.running, 'initial invalid file is watched');
  await fs.writeFile(form.second, secondText);
  await until(() => second.phase === 'ready', 'initial invalid disk snapshot recovers automatically');
  const secondSession = second.client.current.formSessionId;
  await service.receive(second, second.frames.get('main'), { type: 'detach' });
  await until(() => second.frames.get('preview')?.ready, 'second preview detached');
  second.frames.get('main').panel.dispose();
  await until(() => second.frames.size === 1, 'preview survives closing its owner');
  await service.receive(second, second.frames.get('preview'), { type: 'dock' });
  await until(() => second.frames.get('main')?.ready && !second.frames.has('preview'), 'dock recreates the owner');
  assert.equal(second.client.current.formSessionId, secondSession, 'docking keeps the same session');
  assert.equal(second.frames.get('main').panel.viewColumn, vscode.ViewColumn.One);
  assert.equal(view.selected.key.value, first.identity.key.value, 'second form does not change first selection');
  second.frames.get('main').panel.dispose();
  await until(() => service.views.size === 1, 'second session closed independently');
  const sessionId=view.client.current.formSessionId;
  main.panel.dispose(); await until(() => service.views.size === 0, 'last consumer releases session');
  await Promise.all([...service.closing]);
  await assert.rejects(()=>explorer.connection.request(view.tree.session.sessionId,'form/get',{projectId:view.entry.project.info.projectId,generation:view.entry.project.info.generation,formSessionId:sessionId}), error=>error.details?.reason==='unknown_form_session');
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, formPreview: true, locale: vscode.env.language, geometry, shellGeometry, dirty: true, incompleteMarkDirtyXml: true, detached: true, repeatedDetachFocus: true, invalidXml: true, undo: true, external: true, navigation: true, initialInvalidRecovery: true, ownerClosedBeforeDock: true, independentForms: true, sourceWritesDuringViewing: false }));
}

exports.run = async function () {
  try { await run(); }
  catch (error) {
    const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, error: String(error?.stack ?? error?.message ?? error), code: error?.code ?? null }));
    throw error;
  }
};
