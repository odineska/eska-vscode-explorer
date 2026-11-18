const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

function handlerButton(name, click = false) {
  let button = [...document.querySelectorAll('.form-handler')].find(button => button.textContent === name);
  if (!button) {
    const input = [...document.querySelectorAll('.form-properties input')].find(input => input.value === name);
    const cell = input?.closest('td');
    button = cell?.querySelector('[data-edit-action="handler"]')
      ?? cell?.querySelector('.form-icon-button:not(.form-inline-reset)');
  }
  if (!button || button.disabled) return false;
  if (click) button.click();
  return true;
}
const hasHandler = (ui, name) => ui.evaluate('(' + handlerButton.toString() + ')(' + JSON.stringify(name) + ')');
const clickHandler = (ui, name) => ui.evaluate('(' + handlerButton.toString() + ')(' + JSON.stringify(name) + ', true)');

exports.run = async () => {
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE), form=fixture.form;
  const before=await fs.readFile(form.path), moduleBefore=await fs.readFile(form.module);
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service=explorer.formPreview;
  await until(()=>service.views.size===1&&[...service.views.values()][0].phase==='ready','handler form ready');
  const view=[...service.views.values()][0], main=view.frames.get('main'), ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
  await until(() => hasHandler(ui, 'ПриОткрытии'), 'root event action');
  assert.equal(view.client.limits.handlerAuthoring === true, process.env.ESKA_HOST_EXPECT_HANDLER_AUTHORING !== '0');
  const navigate=async(name,expected=name)=>{
    main.panel.reveal();
    await until(() => clickHandler(ui, name), `handler action ${name}`);
    await until(()=>vscode.window.activeTextEditor && sameSourcePath(vscode.window.activeTextEditor.document.uri.fsPath, form.module)&&vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection)===expected,'handler declaration selected');
    assert.equal(view.phase,'ready');
  };
  await navigate('ПриОткрытии','ПРИОТКРЫТИИ');
  main.panel.reveal();await ui.evaluate("document.querySelector('.taxi-input').click()");
  await until(async () => await hasHandler(ui, 'NameChanged') && await hasHandler(ui, 'NameChangedAfter'), 'both repeated input event actions');
  await navigate('NameChanged');await navigate('NameChangedAfter');
  main.panel.reveal();
  const client=view.client, locate=client.locateHandler.bind(client), run=service.handler.bind(service);
  const first=view.snapshot.model.handlers.findIndex(handler=>handler.name==='NameChanged');
  let release,held=false,pending=0,hold=true;const gate=new Promise(resolve=>release=resolve);
  client.locateHandler=async(...args)=>{const result=await locate(...args);if(hold&&args[0]===first){hold=false;held=true;await gate}return result};
  service.handler=async(...args)=>{pending++;try{return await run(...args)}finally{pending--}};
  assert.equal(await clickHandler(ui, 'NameChanged'), true);
  await until(()=>held,'actual first handler reply held');
  await navigate('NameChangedAfter');release();await until(()=>pending===0,'late handler request finished');
  assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection),'NameChangedAfter');
  client.locateHandler=locate;service.handler=run;
  const module=await vscode.workspace.openTextDocument(vscode.Uri.file(form.module));
  const replace=async(doc,from,to)=>{const text=doc.getText();assert.ok(text.includes(from));const edit=new vscode.WorkspaceEdit();edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(text.length)),text.replace(from,to));assert.equal(await vscode.workspace.applyEdit(edit),true)};
  await replace(module,'Procedure NameChanged(Element)','Procedure DirtyChanged(Element)');
  const upload=new vscode.WorkspaceEdit();upload.insert(module.uri,new vscode.Position(0,0),'// '+'x'.repeat(140000)+'\r\n');
  assert.equal(await vscode.workspace.applyEdit(upload),true);
  const request=client.request.bind(client), uploads=[];
  client.request=async(method,params,...rest)=>{if(method.startsWith('query/buffer')||method==='form/handlerLocate')uploads.push({method,input:params.input,bufferId:params.bufferId});return request(method,params,...rest)};
  const previous = view.snapshot;
  await replace(document,'<Event name="OnChange">NameChanged</Event>','<Event name="OnChange">DirtyChanged</Event>');
  main.panel.reveal();
  await until(async () => view.phase === 'ready' && await hasHandler(ui, 'DirtyChanged'), 'dirty XML handler reference');
  const snapshot = view.snapshot;
  assert.notEqual(snapshot.revision, previous.revision);
  assert.equal(snapshot.model.handlers[first].name, 'DirtyChanged', 'the old index now points at another handler');
  const navigation = view.navigation;
  await service.receive(view, main, { type: 'handler', index: first, revision: previous.revision, formSessionId: snapshot.formSessionId });
  await service.receive(view, main, { type: 'handler', index: first, revision: snapshot.revision, formSessionId: 'obsolete' });
  assert.equal(view.navigation, navigation, 'old links must not navigate or interrupt current navigation');
  await navigate('DirtyChanged');assert.equal(module.isDirty,true);
  const transferred=uploads.find(value=>value.method==='form/handlerLocate')?.input?.bufferId;
  assert.equal(typeof transferred,'string');assert.ok(uploads.some(value=>value.method==='query/bufferClose'&&value.bufferId===transferred));
  main.panel.reveal();
  await ui.evaluate(`([...document.querySelectorAll('.form-inspectors .form-tabs button')].find(button=>button.textContent===${JSON.stringify(vscode.env.language.startsWith('ru')?'Команды':'Commands')})).click()`);
  await ui.evaluate("document.querySelector('.form-data-row[data-form-data-path=Execute]').click()");
  await until(() => hasHandler(ui, 'ExecuteCommand'), 'selected command action link');
  await navigate('ExecuteCommand');
  main.panel.reveal();
  await ui.evaluate("[...document.querySelectorAll('.form-tree-row')].find(row=>row.id.endsWith(':2')).click()");
  await replace(document,'<Event name="OnChange" callType="After">NameChangedAfter</Event>','<Event name="OnChange" callType="After">MissingHandler</Event>');
  await until(async () => view.phase === 'ready' && await hasHandler(ui, 'MissingHandler'), 'missing handler link');
  assert.equal(await clickHandler(ui, 'MissingHandler'), true);
  await until(()=>view.notice=== (vscode.env.language.startsWith('ru')?'Обработчик не найден, неоднозначен или его модуль пока некорректен.':'The handler is missing, ambiguous, or its module is incomplete.'),'missing handler notice');
  assert.equal(view.phase,'ready');
  await ui.screenshot(`form-handlers-${vscode.env.language}.png`);
  assert.deepEqual(await fs.readFile(form.path),before);assert.deepEqual(await fs.readFile(form.module),moduleBefore);
  let releaseUpload,uploadHeld=false,buffer;const uploadGate=new Promise(resolve=>releaseUpload=resolve);
  const tracked=client.request.bind(client), order=[];
  client.request=async(method,params,...rest)=>{const result=await tracked(method,params,...rest);order.push({method,bufferId:params.bufferId});if(method==='query/bufferAppend'&&!uploadHeld){uploadHeld=true;buffer=params.bufferId;await uploadGate}return result};
  assert.equal(await clickHandler(ui, 'DirtyChanged'), true);
  await until(()=>uploadHeld,'actual module upload held');
  main.panel.dispose();await until(()=>view.closed&&service.closing.size>0,'last handler consumer closed');
  assert.equal(order.some(item=>item.method==='form/close'),false,'session stays alive until the upload is released');
  releaseUpload();await Promise.all([...service.closing]);
  assert.equal(service.views.size,0);
  const releasedAt=order.findIndex(item=>item.method==='query/bufferClose'&&item.bufferId===buffer),closedAt=order.findIndex(item=>item.method==='form/close');
  assert.ok(releasedAt>=0&&closedAt>releasedAt,'buffer release precedes session close');
  assert.equal((await tracked('query/bufferClose',{bufferId:buffer})).released,false,'uploaded buffer was released');
  ui.close();await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formHandlers:true,locale:vscode.env.language,
    handlerAuthoring:view.client.limits.handlerAuthoring === true, rootEvent:true,repeatedElementEvents:true,commandAction:true,dirtyXmlAndBsl:true,chunkedModuleUpload:true,uploadReleased:true,closeDuringUpload:true,cyrillicBomCrLf:true,literalAndCommentDecoys:true,lateNavigationDiscarded:true,missingHandlerKeepsReadyModel:true,sourceWritesDuringViewing:false}));
};
