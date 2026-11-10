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
  const view = [...service.views.values()][0], main = view.frames.get('main'), ui = await frame({fixedFormArea:true,state:{title:main.panel.title}});
  await until(async () => await ui.evaluate("!!document.querySelector('.taxi-input')"), 'field rendered');
  await ui.evaluate("document.querySelector('.taxi-input').click()");
  const field = view.snapshot.model.root.children.find(node => node.name === 'Group').children.find(node => node.name === 'Name');
  await until(() => view.selected?.key.value === field.identity.key.value && (!view.client.limits.propertyPalette
    || view.palette?.revision === view.snapshot.revision && view.palette.identity.key.value === field.identity.key.value), 'input palette request completed');
  const catalogued = view.palette?.rows?.some(row => row.id === 'platform:Visible') === true;
  const visibleRow = catalogued ? '[data-palette-id="platform:Visible"]' : '[data-property-name=Visible]';
  await until(() => ui.evaluate(`!!document.querySelector(${JSON.stringify('.form-properties '+visibleRow)})`), 'input properties selected');
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
      font:row('Font').querySelector('td').textContent,fontFlags:[...row('Font').querySelectorAll('input[type=checkbox]')].map(input=>[input.checked,input.disabled]),events:events.textContent,
      types:document.querySelector('.form-definitions tbody tr td:nth-child(2)').textContent};})()`);
  assert.equal(shown.visibleTitle, ru ? 'Видимость' : catalogued ? 'Visible' : 'Visibility');
  assert.equal(shown.checked, true); assert.equal(shown.disabled, true);
  assert.equal(shown.literal, 'true'); assert.equal(shown.literalCheckbox, false);
  assert.equal(shown.foreignTitle, 'Width'); assert.equal(shown.foreign, 'false'); assert.equal(shown.foreignCheckbox, false);
  assert.match(shown.font, ru ? /ГарнитураLiberation Sans/ : /TypefaceLiberation Sans/);
  assert.match(shown.font, ru ? /Размер шрифта12/ : /Font size12/);
  assert.deepEqual(shown.fontFlags, [[false,true]]);
  assert.match(shown.events, /NameChanged/); assert.match(shown.events, /NameChangedAfter/); assert.ok(shown.events.includes(ru ? 'Тип вызоваПосле' : 'Call typeAfter'));
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
  const localized=items=>'<Title>'+items.map(([language,content])=>`<v8:item><v8:lang>${language}</v8:lang><v8:content>${content}</v8:content></v8:item>`).join('')+'</Title>';
  const cases=[
    {name:'single-ru',xml:localized([['ru','Один вариант']]),plain:'Один вариант'},
    {name:'single-other-language',xml:localized([['en','Only English']]),plain:'Only English'},
    {name:'multiple',xml:localized([['ru','Русский текст'],['en','English text']]),items:[['ru','Русский текст'],['en','English text']]},
    {name:'single-return',xml:localized([['ru','Вернулся один']]),plain:'Вернулся один'},
    {name:'empty-single',xml:localized([['en','']]),plain:''},
    {name:'zero',xml:'<Title/>',plain:''},
    {name:'outer-annotation',xml:localized([['ru','Annotated']]).replace('<Title>','<Title xmlns:test="urn:test" test:note="retained">'),plain:'Annotated',annotation:'retained'},
    {name:'inner-annotation',xml:localized([['ru','Inner']]).replace('<v8:item>','<v8:item xmlns:test="urn:test" test:note="retained">'),generic:true,marker:'Inner',annotation:'retained'},
    {name:'extra-field',xml:localized([['ru','Extra']]).replace('</Title>','<test:extra xmlns:test="urn:test">kept</test:extra></Title>'),generic:true,marker:'Extra',annotation:'kept'},
    {name:'single-final',xml:localized([['en','Plain localized text']]),plain:'Plain localized text'},
  ];
  const localizationCases=[];let previousTitle='<Title>true</Title>';
  for(const entry of cases){
    const text=document.getText(),offset=text.indexOf(previousTitle),revision=view.snapshot.revision;assert.ok(offset>=0,entry.name);
    const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(offset),document.positionAt(offset+previousTitle.length)),entry.xml);
    assert.equal(await vscode.workspace.applyEdit(edit),true);previousTitle=entry.xml;
    await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'localized property snapshot '+entry.name);
    const value=()=>ui.evaluate(`(() => {const row=document.querySelector('.form-properties [data-property-name=Title]'),value=row.querySelector('td > .form-property-value');return {plain:value.querySelector(':scope > span')?.textContent??null,localized:!!value.querySelector(':scope > .form-property-localized'),generic:!!value.querySelector(':scope > .form-property-record:not(.form-property-localized)'),text:value.textContent};})()`);
    await until(async()=>{const shown=await value();return entry.items?shown.localized:entry.generic?shown.generic&&shown.text.includes(entry.marker):shown.plain===entry.plain;},'localized property rendered '+entry.name);
    if(entry.items||entry.generic){
      await ui.evaluate("(() => {const details=document.querySelector('.form-properties [data-property-name=Title] td > .form-property-value > details');if(!details.open)details.querySelector('summary').click();return true})()");
      await until(()=>ui.evaluate("!!document.querySelector('.form-properties [data-property-name=Title] td > .form-property-value > details[open] > dl')"),'localized details expanded '+entry.name);
    }
    const shown=await value();
    if(entry.items){
      const items=await ui.evaluate("[...document.querySelectorAll('.form-properties [data-property-name=Title] .form-property-localized > dl > div')].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent])");assert.deepEqual(items,entry.items);
    }else if(!entry.generic){assert.equal(shown.plain,entry.plain);assert.equal(shown.generic,false);assert.equal(shown.localized,false);}
    if(entry.annotation)assert.ok(shown.text.includes(entry.annotation),entry.name+' retains annotation');
    assert.equal(await ui.evaluate("globalThis.__inspectorEvents===document.querySelector('.form-properties [data-property-name=Events] details')&&globalThis.__inspectorEvents.open"),true,'unrelated property details stay open');
    localizationCases.push({name:entry.name,plain:shown.plain,multipleLanguages:shown.localized,genericStructure:shown.generic,annotationRetained:!entry.annotation||shown.text.includes(entry.annotation)});
  }
  await ui.evaluate("document.querySelector('.form-properties [data-property-name=Title]').scrollIntoView({block:'center'})");
  await ui.screenshot(`form-single-localization-${vscode.env.language}.png`);
  assert.deepEqual(await fs.readFile(file), before);
  await ui.evaluate("document.querySelector('.form-properties [data-property-name=Events]').scrollIntoView({block:'center'})");
  await ui.screenshot(`form-inspectors-records-${vscode.env.language}.png`);ui.close();
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formInspectors:true,locale:vscode.env.language,
    captions:true,typedBooleans:true,literalAndForeignValuesPreserved:true,nestedRecordsAndQualifiers:true,propertyKeyboardNavigation:true,
    dirtyProperties:true,recordDomRetained:true,singleLocalizationPlain:true,localizationCases,sourceWritesDuringViewing:false}));
};
