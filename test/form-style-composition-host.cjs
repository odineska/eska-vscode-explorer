const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');
function named(node,name){return node.name===name?node:node.children.map(child=>named(child,name)).find(Boolean);}
async function replace(document,from,to){
  const text=document.getText();assert.ok(text.includes(from));const edit=new vscode.WorkspaceEdit();
  edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(text.length)),text.replaceAll(from,to));
  assert.equal(await vscode.workspace.applyEdit(edit),true);
}
exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),files=fixture.styleComposition;
  const before=await Promise.all(files.sources.map(file=>fs.readFile(file))),results=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();await vscode.commands.executeCommand('eska.explorer.connect');
  assert.equal(explorer.connection.state.kind,'ready',JSON.stringify(explorer.connection.state));await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');const service=explorer.formPreview;
  let view,main,ui,identity;
  const expected=id=>files.cases.find(row=>row.id===id).expected;
  const dependency=file=>view.snapshot.dependencies.find(input=>input.root.encoding==='utf-8'&&input.path.encoding==='utf-8'&&path.join(input.root.value,input.path.value)===file);
  const presentation=()=>named(view.snapshot.model.root,'Caption').presentation;
  const css=color=>color.kind==='web'?'rgb(255, 140, 0)':`rgb(${[1,3,5].map(offset=>parseInt(color.value.slice(offset,offset+2),16)).join(', ')})`;
  const matches=want=>{
    const actual=presentation();return JSON.stringify(actual.foreground)===JSON.stringify(want.color)&&['points','weight','italic','underline'].every(key=>actual.font[key]===want.font[key]);
  };
  async function check(want,label,document){
    await until(async()=>view.phase==='ready'&&!view.running&&!view.timer&&(!document||dependency(document.uri.fsPath)?.version===String(document.version))&&matches(want)&&await ui.evaluate("(()=>{const node=document.querySelector('.taxi-label');return node?getComputedStyle(node).color:null})()")===css(want.color),label);
    assert.deepEqual(named(view.snapshot.model.root,'Caption').identity,identity);
    if(view.selected)assert.deepEqual(view.selected,identity);
    results.push({label,color:presentation().foreground,font:Object.fromEntries(['points','weight','italic','underline'].map(key=>[key,presentation().font[key]]))});
  }
  async function open(file){
    const document=await vscode.workspace.openTextDocument(vscode.Uri.file(file));await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    await until(()=>vscode.window.activeTextEditor?.document.uri.fsPath===file,'style XML active');await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...service.views.values()].some(item=>item.path===file&&item.phase==='ready'),'style form ready');
    view=[...service.views.values()].find(item=>item.path===file);main=view.frames.get('main');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});identity=named(view.snapshot.model.root,'Caption').identity;
    await until(()=>ui.evaluate("!!document.querySelector('.taxi-label')"),'main style DOM');
    await ui.evaluate("globalThis.__styleCaption=document.querySelector('.taxi-label');document.querySelector('.taxi-label').click()");await until(()=>view.selected?.key.value===identity.key.value,'style caption selected');
  }
  async function detach(){
    await ui.focusWorkbench();ui.close();await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'style detached');
    const detached=view.frames.get('preview');ui=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});assert.equal((await ui.nativeWindow({detached:true})).url,'about:blank');
    await until(()=>ui.evaluate("!!document.querySelector('.taxi-label')"),'floating style DOM');await ui.evaluate("globalThis.__styleCaption=document.querySelector('.taxi-label')");return detached;
  }
  async function reattach(detached){
    assert.equal(await ui.evaluate("globalThis.__styleCaption===document.querySelector('.taxi-label')"),true);ui.close();detached.panel.dispose();await until(()=>!view.frames.has('preview'),'style reattached');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
  }
  await open(path.join(files.members.base.source,'CommonForms','ProbeStyleConsumer','Ext','Form.xml'));
  await check(expected('styles-active-base-items'),'initial-base-item-fallback');
  const ownStyle=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(files.members.first.source,'Styles','F_ReportStyle','Ext','Style.xml')));
  await replace(ownStyle,'#00FF00','#112233');await check(expected('styles-active-base-items'),'foreign-layer-style-value-ignored',ownStyle);
  const baseStyle=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(files.members.base.source,'Styles','ProbeStyleValues','Ext','Style.xml')));
  await replace(baseStyle,'#9800FF','#B02040');await replace(baseStyle,'height="18" bold="true" italic="false"','height="14" bold="false" italic="true"');
  await check(expected('styles-active-base-items'),'unselected-base-style-dirty',baseStyle);
  const configuration=await vscode.workspace.openTextDocument(vscode.Uri.file(files.members.first.configuration));
  await replace(configuration,'Style.F_ReportStyle','Style.ProbeStyleValues');await check(expected('styles-base-updated'),'selected-base-style-dirty',configuration);
  const borrowedStyle=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(files.members.first.source,'Styles','ProbeStyleValues','Ext','Style.xml')));
  await replace(borrowedStyle,'#008800','#EE4400');await check(expected('styles-base-updated'),'borrowed-alias-keeps-base-style-table',borrowedStyle);
  assert.equal(await ui.evaluate("globalThis.__styleCaption===document.querySelector('.taxi-label')"),true);
  let detached=await detach();await replace(baseStyle,'#B02040','#2040A0');const blue={...expected('styles-base-updated'),color:{kind:'rgb',value:'#2040a0'}};
  await check(blue,'detached-base-style-dirty',baseStyle);await reattach(detached);await check(blue,'reattached-base-style');
  await ui.focusWorkbench();ui.close();main.panel.dispose();await until(()=>service.views.size===0,'base style session released');await Promise.all([...service.closing]);
  await open(path.join(files.members.first.source,'CommonForms','F_StyleOwn','Ext','Form.xml'));await check(expected('styles-owned-items'),'own-item-default-value');
  await replace(configuration,'<DefaultStyle>Style.ProbeStyleValues</DefaultStyle>','');await check(expected('styles-owned-items'),'inherited-style-without-cfe-default',configuration);
  await replace(borrowedStyle,borrowedStyle.getText(),files.fullStyle);await check(expected('styles-inherited-own-items'),'inherited-own-style-override',borrowedStyle);
  detached=await detach();const ownedValue=await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(files.members.first.source,'StyleItems','F_ProbeColor.xml')));
  await replace(ownedValue,'#008800','#AA5500');await check(expected('styles-inherited-own-items'),'detached-default-value-shadowed',ownedValue);
  await replace(borrowedStyle,files.ownColorItem,'');const fallback={...expected('styles-inherited-own-items'),color:{kind:'rgb',value:'#aa5500'}};
  await check(fallback,'detached-own-item-default-restored',borrowedStyle);await ui.screenshot(`form-style-composition-${vscode.env.language}.png`);
  await reattach(detached);await check(fallback,'reattached-own-style');
  assert.ok([baseStyle,ownStyle,configuration,borrowedStyle,ownedValue].every(document=>document.isDirty));
  assert.deepEqual(await Promise.all(files.sources.map(file=>fs.readFile(file))),before);
  ui.close();await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,styleComposition:true,locale:vscode.env.language,results,sourceWritesDuringViewing:false,stableIdentity:true,stableDom:true,inheritedStyle:true,definingLayerPreserved:true,detachedUpdates:true}));
};
