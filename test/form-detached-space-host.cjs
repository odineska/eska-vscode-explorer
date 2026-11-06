const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');

const measure=`(() => {
  const shell=document.querySelector('.form-shell'),area=document.querySelector('.form-inspectors');
  const height=node=>node.getBoundingClientRect().height;
  return {shell:shell.clientHeight,toolbar:height(document.querySelector('.form-toolbar')),status:height(document.querySelector('.form-status')),height:height(area),
    splitters:document.querySelectorAll('.form-shell > .form-splitter').length,preview:document.querySelectorAll('.preview-scroll').length,placeholder:document.querySelectorAll('.form-detached-placeholder').length,
    sameOwners:!globalThis.__detachedOwners||__detachedOwners.every(node=>node.isConnected),owners:globalThis.__detachedOwners?.map(node=>({tag:node.tagName,classes:node.className,connected:node.isConnected})),recordOpen:!!document.querySelector('.form-property-record[open]'),
    selected:document.querySelector('.form-tree-row.selected')?.id,zoom:document.querySelector('.form-zoom select').value,
    reveal:document.querySelectorAll('.form-toolbar > button')[2]?.textContent,errors:globalThis.__detachedErrors??[]};
})()`;
const navigation=`({page:document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent,collapsed:document.querySelector('.taxi-group-title button')?.getAttribute('aria-expanded')==='false'})`;
exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),file=fixture.form.path,before=await fs.readFile(file),results=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(file)),source=document.getText();
  async function replace(from,to){
    const text=document.getText(),offset=text.indexOf(from);assert.ok(offset>=0);
    const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(offset),document.positionAt(offset+from.length)),to);
    assert.equal(await vscode.workspace.applyEdit(edit),true);
  }
  await replace('<ShowTitle>true</ShowTitle>','<ShowTitle>true</ShowTitle><Behavior>Collapsible</Behavior>');
  await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service=explorer.formPreview;
  await until(()=>service.views.size===1&&[...service.views.values()][0].phase==='ready','form ready');
  const view=[...service.views.values()][0],main=view.frames.get('main'),ui=await frame({state:{title:main.panel.title}});
  await until(()=>ui.evaluate("!!document.querySelector('.taxi-group-title button')"),'collapsible group ready');
  await until(()=>view.phase==='ready'&&!view.running&&!view.timer,'initial snapshot settled');
  await ui.evaluate("globalThis.__detachedSelection=null;window.addEventListener('message',event=>{if(event.data?.type==='selection')globalThis.__detachedSelection=event.data.identity.key});document.querySelector('.taxi-input').click()");
  await until(()=>ui.evaluate("globalThis.__detachedSelection?.value==='2'"),'initial selection delivered');
  await ui.evaluate(`document.querySelector('.form-shell > .form-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    const zoom=document.querySelector('.form-zoom select');zoom.value='125';zoom.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelectorAll('.taxi-tabs button')[1].click();document.querySelector('.taxi-group-title button').click();document.querySelector('.taxi-form-frame').click();true`);
  // The raw XML row may be visible while inspection of the selected root is in flight.
  const titleRecord='.form-properties tr[data-property-name=Title]'+(view.client.limits.propertyPalette?'[data-palette-id]':'')+' details';
  await until(()=>ui.evaluate(`(() => {const details=document.querySelector(${JSON.stringify(titleRecord)});if(globalThis.__detachedSelection?.kind!=='root'||!document.querySelector('.form-tree-row.selected')?.id.endsWith(':root')||!details)return false;details.open=true;return true})()`),'final root selection delivered and property record opened');
  await until(()=>ui.evaluate(`!!document.querySelector(${JSON.stringify(titleRecord+'[open] dl')})`),'property record expanded');
  await ui.evaluate(`globalThis.__detachedOwners=[document.querySelector('.form-inspectors'),document.querySelector('.form-tree'),document.querySelector('.form-definitions'),document.querySelector('.form-properties'),document.querySelector(${JSON.stringify(titleRecord)})];
    globalThis.__detachedErrors=[];window.addEventListener('error',event=>__detachedErrors.push(event.message));true`);
  const baseline=await ui.evaluate(measure),nav=await ui.evaluate(navigation),session=view.client.current.formSessionId;
  assert.equal(baseline.height,240);assert.equal(baseline.zoom,'125');assert.equal(nav.page,'Other');assert.equal(nav.collapsed,true);
  const mainTarget=await ui.nativeWindow(),originalWindow=await ui.windowBounds(mainTarget.targetId);
  async function detach(){
    await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
    await until(()=>view.frames.get('preview')?.ready,'floating preview ready');
    const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
    await until(()=>floating.evaluate("!!document.querySelector('.taxi-form-frame')"),'floating form rendered');
    await until(async()=>{const value=await ui.evaluate(measure);return value.preview===0&&value.splitters===0&&Math.abs(value.height-Math.max(84,value.shell-value.toolbar-value.status))<1;},'main fills freed space');
    const target=await floating.nativeWindow({detached:true});assert.notEqual(target.targetId,mainTarget.targetId);
    return {preview,floating,target};
  }
  const first=await detach();
  await ui.screenshot('detached-space-filled-'+vscode.env.language+'.png');
  const model=view.snapshot,received=[],receive=service.receive;
  service.receive=async function(v,f,value){received.push(value.type);return receive.call(this,v,f,value);};
  try {
    for(const [width,height] of [[420,360],[1000,700],[420,180]]) {
      await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
      await until(async()=>{const value=await ui.evaluate(measure);return Math.abs(value.height-Math.max(84,value.shell-value.toolbar-value.status))<1;},'detached size settled');
      const value=await ui.evaluate(measure);assert.equal(value.placeholder,0);assert.equal(value.preview,0);assert.equal(value.splitters,0);assert.equal(value.sameOwners,true,JSON.stringify(value.owners));assert.equal(value.recordOpen,true);assert.equal(value.selected,baseline.selected);assert.equal(value.zoom,'125');assert.deepEqual(value.errors,[]);assert.equal(value.reveal,service.strings().revealPreview);results.push({label:`css-${width}-${height}`,...value});
    }
  } finally {service.receive=receive;}
  assert.deepEqual(received,[],'resize sends no action');assert.equal(view.snapshot,model);assert.equal(view.client.current.formSessionId,session);
  await ui.evaluate("document.querySelector('#root').style.cssText='';true");
  const floatingBounds=await first.floating.windowBounds(first.target.targetId);
  try {
    for(const [width,height] of [[900,600],[1280,800]]) {
      await ui.resizeWindow(mainTarget.targetId,{width,height});
      await until(async()=>{const value=await ui.windowBounds(mainTarget.targetId);return value.bounds.width===width&&value.bounds.height===height;},'main native resize applied');
      await until(async()=>{const value=await ui.evaluate(measure);return Math.abs(value.height-Math.max(84,value.shell-value.toolbar-value.status))<1;},'native detached fill settled');
      results.push({label:`native-${width}-${height}`,...await ui.evaluate(measure)});
      assert.deepEqual(await first.floating.windowBounds(first.target.targetId),floatingBounds,'main resizing does not resize the preview window');
    }
  } finally {
    await ui.resizeWindow(mainTarget.targetId,originalWindow.bounds);
    await until(async()=>{const value=await ui.windowBounds(mainTarget.targetId);return value.bounds.width===originalWindow.bounds.width&&value.bounds.height===originalWindow.bounds.height;},'main native size restored');
  }
  await replace('Other page','Live detached');
  await until(()=>first.floating.evaluate("document.querySelector('.taxi-page[aria-hidden=false] .taxi-label')?.textContent==='Live detached'"),'dirty XML reaches floating preview while main is filled');
  await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");await until(()=>first.preview.panel.active,'toolbar reveals floating preview');
  assert.equal((await first.floating.nativeWindow({detached:true})).targetId,first.target.targetId);assert.equal(view.frames.size,2);
  await ui.evaluate("Object.assign(document.querySelector('#root').style,{width:'420px',height:'320px'});true");
  await first.floating.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
  await until(()=>!view.frames.has('preview'),'dock closes preview');first.floating.close();
  await until(()=>ui.evaluate("!!document.querySelector('.preview-scroll')&&!!document.querySelector('.form-shell > .form-splitter')"),'dock restores preview and separator');
  await until(async()=>{const value=await ui.evaluate(measure);return value.height===Math.max(84,Math.min(240,value.shell-value.toolbar-value.status-5-96));},'dock allocation follows the wrapped toolbar after layout settles');
  const docked=await ui.evaluate(measure);assert.equal(docked.height,Math.max(84,Math.min(240,docked.shell-docked.toolbar-docked.status-5-96)));assert.equal(docked.sameOwners,true);assert.equal(docked.recordOpen,true);assert.equal(docked.zoom,'125');assert.deepEqual(await ui.evaluate(navigation),nav);results.push({label:'dock-small',...docked});
  await ui.evaluate("document.querySelector('#root').style.cssText='';true");await until(async()=>(await ui.evaluate(measure)).height===240,'original saved split returns after growing');
  const second=await detach();await second.floating.captureTarget(second.target.targetId,'detached-before-native-close-'+vscode.env.language+'.png');
  await vscode.commands.executeCommand('workbench.action.closeWindow');
  await until(()=>!view.frames.has('preview'),'native close docks the main view');second.floating.close();
  await until(async()=>{const value=await ui.evaluate(measure);return value.height===240&&value.preview===1&&value.splitters===1;},'native close restores saved split');
  assert.deepEqual(await ui.evaluate(navigation),nav);assert.equal((await ui.evaluate(measure)).recordOpen,true);assert.equal(view.client.current.formSessionId,session);
  assert.equal(document.isDirty,true);assert.notEqual(document.getText(),source);assert.deepEqual(await fs.readFile(file),before,'viewing and resizing never write XML');
  await ui.screenshot('detached-space-returned-'+vscode.env.language+'.png');
  ui.close();main.panel.dispose();await until(()=>service.views.size===0,'last consumer released');await Promise.all([...service.closing]);await explorer.shutdown();
  const report={passed:true,locale:vscode.env.language,sourceWritesDuringViewing:false,mainAndPreviewIndependent:true,savedSplitRetained:true,nativeClose:true,dirtyUpdates:true,inspectorOwnersRetained:true,propertyExpansionRetained:true,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,'detached-space-measured-'+vscode.env.language+'.json'),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
