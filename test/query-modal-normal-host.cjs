const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,replace,parentTabs,returned,dialogButton,closeQueryTabs}=require('./query-modal-host.cjs');

/** Real normal windows show native save prompts; a test/development host cannot validate those decisions. */
exports.run=async function(){
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),accepted=[];
  try{
    assert.equal(await vscode.extensions.all.find(value=>value.packageJSON.name==='eska-explorer').activate(),undefined);
    await vscode.commands.executeCommand('eska.explorer.restart');
    await vscode.workspace.getConfiguration('window').update('dialogStyle','custom',vscode.ConfigurationTarget.Global);
    const uri=vscode.Uri.file(fixture.module),disk=await fs.readFile(fixture.module);
    let owner=await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(owner,{preview:false});await replace(owner,'Other = 42','Other = 43');
    const baseline=owner.getText();
    const openDirty=async()=>{
      const editor=await vscode.window.showTextDocument(owner,{preview:false});
      const at=owner.positionAt(owner.getText().indexOf('SELECT ')+3);editor.selection=new vscode.Selection(at,at);
      await vscode.commands.executeCommand('eska.explorer.editBslQuery');
      return until(()=>vscode.window.activeTextEditor?.document.uri.scheme==='eska-query'&&vscode.window.activeTextEditor.document,'dirty owner opens native query without a prompt');
    };
    let draft=await openDirty();
    assert.equal(owner.isDirty,true);assert.equal(parentTabs(uri).length,1);
    assert.equal(owner.getText(),baseline);assert.deepEqual(await fs.readFile(fixture.module),disk);
    accepted.push('opening_query_preserves_dirty_parent_without_a_prompt');
    await replace(draft,'SELECT 1','SELECT 2');
    assert.equal(draft.isDirty,true,'editing the writable query must mark its native tab dirty');
    const closeWith=async label=>{
      const tab=vscode.window.tabGroups.all.flatMap(group=>group.tabs).find(tab=>tab.input instanceof vscode.TabInputText&&tab.input.uri.toString()===draft.uri.toString());
      assert.ok(tab);
      const closed=vscode.window.tabGroups.close(tab);
      await dialogButton(label);
      return closed;
    };
    assert.equal(await closeWith('^Cancel$|^Отмена$'),false);
    assert.equal(vscode.window.activeTextEditor?.document,draft);assert.equal(draft.isDirty,true);
    assert.equal(owner.getText(),baseline);
    accepted.push('native_close_cancel_retains_dirty_query');
    assert.equal(await closeWith("^Don't Save$|^Не сохранять$"),true);
    owner=await returned(uri);assert.equal(owner.getText(),baseline);
    assert.deepEqual(await fs.readFile(fixture.module),disk);
    accepted.push('native_close_discard_preserves_dirty_owner');
    draft=await openDirty();await replace(draft,'SELECT 1','SELECT 3');
    assert.equal(await closeWith('^Save$|^Сохранить$'),true);
    owner=await returned(uri);
    assert.equal(owner.getText(),baseline.replace('SELECT 1','SELECT 3'));
    assert.equal(owner.isDirty,true);assert.deepEqual(await fs.readFile(fixture.module),disk);
    assert.equal(await owner.save(),true);
    assert.ok((await fs.readFile(fixture.module,'utf8')).includes('Other = 43'));
    accepted.push('native_close_save_updates_dirty_owner_only_until_its_own_save');
    const files = vscode.workspace.getConfiguration('files', uri);
    await files.update('readonlyInclude', { '**/ObjectModule.bsl': true }, vscode.ConfigurationTarget.Workspace);
    try {
      draft = await openDirty();
      assert.notEqual((await vscode.workspace.fs.stat(draft.uri)).permissions, vscode.FilePermission.Readonly);
      const beforeDraft = draft.getText();
      await vscode.commands.executeCommand('type', { text: 'x' });
      await until(()=>draft.getText()!==beforeDraft,'native query input acknowledged');
      await vscode.commands.executeCommand('undo');
      await until(()=>draft.getText()===beforeDraft,'native query undo acknowledged');
      await closeQueryTabs(draft);
      owner = await returned(uri);
    } finally {
      await files.update('readonlyInclude', undefined, vscode.ConfigurationTarget.Workspace);
    }
    accepted.push('query_remains_editable_with_configured_readonly_source');

    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
    draft = await openDirty();
    await closeQueryTabs(draft);
    owner = await returned(uri);
    const before = owner.getText();
    await vscode.commands.executeCommand('type', { text: 'must not alter parent' });
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(owner.getText(), before);
    await vscode.commands.executeCommand('workbench.action.files.resetActiveEditorReadonlyInSession');
    accepted.push('native_readonly_override_survives_query_roundtrip');
    await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,suite:'query-modal-normal',locale:vscode.env.language,accepted}));
  }catch(error){
    const logs=[];
    try{
      const root=path.join(path.dirname(fixture.root),'profile','logs');
      for(const file of (await fs.readdir(root,{recursive:true})).filter(file=>file.endsWith('ESKA Explorer.log'))){
        logs.push((await fs.readFile(path.join(root,file),'utf8')).slice(-7000));
      }
    }catch{}
    const editor=vscode.window.activeTextEditor;
    await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:false,suite:'query-modal-normal',error:String(error.stack??error),accepted,
      active:editor&&{uri:editor.document.uri.toString(),dirty:editor.document.isDirty,version:editor.document.version,text:editor.document.getText().slice(0,500)},logs}));throw error;
  }
};
