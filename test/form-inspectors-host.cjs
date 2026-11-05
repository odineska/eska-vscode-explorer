const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), file = fixture.form.path;
  const before = await fs.readFile(file);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, {preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => service.views.size === 1 && [...service.views.values()][0].phase === 'ready', 'inspector form ready');
  const view = [...service.views.values()][0], main = view.frames.get('main'), ui = await frame({state:{title:main.panel.title}});
  await until(async () => await ui.evaluate("!!document.querySelector('.taxi-input')"), 'field rendered');
  await ui.evaluate("document.querySelector('.taxi-input').click()");
  await until(async () => await ui.evaluate("!!document.querySelector('.form-properties [data-property-name=Visible]')"), 'input properties selected');
  const ru = vscode.env.language.startsWith('ru');
  await ui.evaluate("document.querySelector('.form-properties [data-property-name=Events] summary').click()");
  await until(async () => await ui.evaluate("document.querySelectorAll('.form-properties [data-property-name=Events] details[open] .form-property-qualifiers').length===2"), 'nested event annotations expanded');
  const shown = await ui.evaluate(`(() => {
    const row=name=>document.querySelector('.form-properties [data-property-name='+name+']');
    const visible=row('Visible'), literal=row('Title'), foreign=document.querySelector('.form-properties [data-property-namespace="urn:vendor"]');
    const events=row('Events').querySelector('details');globalThis.__inspectorEvents=events;
    return {visibleTitle:visible.querySelector('th').textContent,checked:visible.querySelector('input').checked,disabled:visible.querySelector('input').disabled,
      literal:literal.querySelector('td').textContent,literalCheckbox:!!literal.querySelector('input'),
      foreignTitle:foreign.querySelector('th').textContent,foreign:foreign.querySelector('td').textContent,foreignCheckbox:!!foreign.querySelector('input'),
      font:row('Font').querySelector('td').textContent,events:events.textContent,
      types:document.querySelector('.form-definitions tbody tr td:nth-child(2)').textContent};})()`);
  assert.equal(shown.visibleTitle, ru ? 'Видимость' : 'Visibility');
  assert.equal(shown.checked, true); assert.equal(shown.disabled, true);
  assert.equal(shown.literal, 'true'); assert.equal(shown.literalCheckbox, false);
  assert.equal(shown.foreignTitle, 'Width'); assert.equal(shown.foreign, 'false'); assert.equal(shown.foreignCheckbox, false);
  assert.match(shown.font, /faceNameLiberation Sans/); assert.match(shown.font, /height12/); assert.match(shown.font, /boldfalse/);
  assert.match(shown.events, /NameChanged/); assert.match(shown.events, /NameChangedAfter/); assert.match(shown.events, /callTypeAfter/);
  assert.match(shown.types, ru ? /Строка/ : /String/);
  await ui.screenshot(`form-inspectors-${vscode.env.language}.png`);
  const received = [], failures = [], receive = service.receive.bind(service), failure = service.failure.bind(service);
  service.receive = async (...args) => { received.push(args[2]); return receive(...args); };
  service.failure = (...args) => { failures.push(String(args[1]?.stack ?? args[1])); return failure(...args); };
  await ui.evaluate("const row=document.querySelector('.form-properties [data-property-name=Visible]');row.focus();row.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))");
  try { await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file && !vscode.window.activeTextEditor.selection.isEmpty, 'property F12 reaches source'); }
  catch (error) {
    await fs.writeFile(path.join(fixture.root,'host-result.json'), JSON.stringify({passed:false,error:String(error.stack??error),received,failures,
      phase:view.phase,notice:view.notice,editor:vscode.window.activeTextEditor?.document.uri.toString(),selection:vscode.window.activeTextEditor?.selection}));
    throw error;
  }
  service.receive = receive; service.failure = failure;
  assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection), '<Visible>true</Visible>');
  main.panel.reveal();
  const text = document.getText(), edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), text.replace('<Visible>true</Visible>', '<Visible>false</Visible>'));
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await until(async () => view.phase === 'ready' && await ui.evaluate("document.querySelector('.form-properties [data-property-name=Visible] input')?.checked===false"), 'dirty boolean property updated');
  assert.equal(await ui.evaluate("globalThis.__inspectorEvents===document.querySelector('.form-properties [data-property-name=Events] details')&&globalThis.__inspectorEvents.open"), true);
  assert.deepEqual(await fs.readFile(file), before);
  await ui.evaluate("document.querySelector('.form-properties [data-property-name=Events]').scrollIntoView({block:'center'})");
  await ui.screenshot(`form-inspectors-records-${vscode.env.language}.png`);ui.close();
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formInspectors:true,locale:vscode.env.language,
    captions:true,typedBooleans:true,literalAndForeignValuesPreserved:true,nestedRecordsAndQualifiers:true,propertyKeyboardNavigation:true,
    dirtyProperties:true,recordDomRetained:true,sourceWritesDuringViewing:false}));
};
