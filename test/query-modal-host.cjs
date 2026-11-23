const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

/** Observe native tab and focus acknowledgements, not an assumed event order. */
async function until(action, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await action(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(label);
}

/** All edits use native documents and their real undo history. */
async function replace(document, before, after) {
  const offset = document.getText().indexOf(before); assert.ok(offset >= 0, before);
  const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri,
    new vscode.Range(document.positionAt(offset), document.positionAt(offset + before.length)), after);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

/** Include protected aliases and split views of the same source. */
function parentTabs(uri) {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText
    && ['file', 'eska-protected'].includes(tab.input.uri.scheme)
    && tab.input.uri.with({scheme:'file'}).toString() === uri.with({scheme:'file'}).toString());
}

/** Public contextual editing must leave exactly one child and no parent views. */
async function openQuery(uri) {
  const owner = await vscode.workspace.openTextDocument(uri), editor = await vscode.window.showTextDocument(owner, {preview:false});
  const at = owner.positionAt(owner.getText().indexOf('SELECT ') + 3); editor.selection = new vscode.Selection(at, at);
  await vscode.commands.executeCommand('eska.explorer.editBslQuery');
  const draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query'
    && parentTabs(uri).length === 0 && vscode.window.activeTextEditor.document, 'child focus and parent tabs closed');
  return draft;
}

/** The original resource must be restored after every operation that completes the child. */
async function returned(uri) {
  return until(() => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()
    && parentTabs(uri).length === 1 && vscode.window.activeTextEditor.document, 'returned to original parent and restored tab');
}

/** Close the actual tab, using the editor's explicit discard command when requested. */
async function closeQueryTabs(document, discard = false) {
  const queryTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString());
  assert.ok(queryTabs().length, 'query tab is open');
  if (discard && document.isDirty) {
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
  const remaining = queryTabs();
  if (remaining.length) assert.equal(await vscode.window.tabGroups.close(remaining), true);
}

/** Saving edits the source but leaves the query open until a separate close. */
async function saveAndCloseQuery(document) {
  assert.equal(await document.save(), true);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), document.uri.toString(), 'Save keeps focus in the query');
  await closeQueryTabs(document);
}

/** Include native and direct provider observations when the IDE rejects a query edit or save. */
async function queryWriteEvidence(explorer, draft, owner) {
  const session = [...explorer.queries.sessions.values()].find(value => value.record.id === draft.uri.path.split('/')[1]);
  if (!owner && session?.parent?.source) owner = await vscode.workspace.openTextDocument(session.parent.source);
  const queryTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === draft.uri.toString());
  const files = vscode.workspace.getConfiguration('files', owner?.uri);
  return {
    native: await vscode.workspace.fs.stat(draft.uri).catch(error => String(error)),
    provider: await explorer.queries.stat(draft.uri).catch(error => String(error)),
    writable: session?.record.writable, protection: session?.source?.header.protection,
    draftWritable: session?.source?.header.draftWritable,
    ownerDirty: owner?.isDirty, ownerVersion: owner?.version, draftDirty: draft.isDirty, draftVersion: draft.version,
    tabDirty: queryTabs.map(tab => tab.isDirty), vscode: vscode.version,
    readonlyInclude: files.get('readonlyInclude'),
  };
}

async function assertQuerySave(explorer, draft, owner) {
  if (!await draft.save()) assert.fail('Native query Save failed: ' + JSON.stringify(await queryWriteEvidence(explorer, draft, owner)));
}

/** Installed normal windows expose no controller. Observe the persisted draft in the test profile. */
async function waitForQueryCheckpoint(fixture, document) {
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  assert.ok(extension);
  const id = document.uri.path.split('/')[1];
  const checkpoint = path.join(path.dirname(fixture.root), 'profile', 'User', 'globalStorage',
    extension.id, 'query-drafts-v1', id + '.json');
  const draft = document.getText();
  await until(async () => {
    const record = await fs.readFile(checkpoint, 'utf8').then(JSON.parse).catch(() => undefined);
    return !!record && Buffer.from(record.draft, 'base64').toString('utf8') === draft;
  }, 'dirty query text is in recovery storage');
}

/** Query rows are resolved through the production tree, including the common metadata branch. */
async function firstXmlQuery(explorer, kind) {
  return until(async () => {
    const [root] = await explorer.getChildren();
    if (!root) return undefined;
    const roots = await explorer.getChildren(root);
    const common = roots.find(row => row.node?.id.collection?.kind === 'common');
    const groups = common ? [...roots, ...await explorer.getChildren(common)] : roots;
    const group = groups.find(row => row.node?.id.collection?.metadataKind === kind);
    if (!group) return undefined;
    const [owner] = await explorer.getChildren(group);
    if (!owner) return undefined;
    const branch = (await explorer.getChildren(owner)).find(row => row.queryKind === 'branch');
    if (!branch) return undefined;
    const [query] = await explorer.getChildren(branch);
    return query;
  }, kind + ' query row appears after metadata refresh');
}

/** Click the real custom native confirmation in this test window's explicitly enabled Chromium endpoint. */
async function dialogButton(label) {
  const port = Number(process.env.ESKA_HOST_DEBUG_PORT); assert.ok(port > 0);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(value => value.type === 'page' && value.url.includes('workbench'));
  assert.ok(target, 'native workbench target');
  const socket = new WebSocket(target.webSocketDebuggerUrl); let serial = 0; const pending = new Map();
  await new Promise((resolve, reject) => {socket.onopen=resolve; socket.onerror=reject;});
  socket.onmessage = event => {const value=JSON.parse(event.data); const done=pending.get(value.id); if(done){pending.delete(value.id); value.error?done.reject(new Error(JSON.stringify(value.error))):done.resolve(value.result);}};
  const evaluate = expression => new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
  try {
    await until(async () => {
      const result = await evaluate(`(()=>{const box=document.querySelector('.monaco-dialog-box');if(!box)return false;const button=[...box.querySelectorAll('button, .monaco-button')].find(value=>new RegExp(${JSON.stringify(label)},'i').test(value.textContent.replaceAll('&','').trim()));if(!button)return false;button.click();return true})()`);
      return result.result.value === true;
    }, 'native dirty confirmation: '+label);
  } finally {socket.close();}
}

/** Exercise native saves and closes while keeping the constructor modal. */
exports.run = async function () {
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE), accepted=[], queryLogs=[];
  let explorer;
  try {
    explorer=await vscode.extensions.all.find(value=>value.packageJSON.name==='eska-explorer').activate();
    const log=explorer.queries.log.bind(explorer.queries);
    explorer.queries.log=message=>{ if(message.startsWith('query_')) queryLogs.push(message);log(message); };
    await until(()=>explorer.tree&&explorer.connection.state.kind==='ready'&&!explorer.support.loading,'backend ready');
    const uri=vscode.Uri.file(fixture.module), disk=await fs.readFile(fixture.module), original=(await vscode.workspace.openTextDocument(uri)).getText();
    await vscode.window.showTextDocument(uri,{preview:false}); await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    await vscode.window.showTextDocument(uri.with({scheme:'eska-protected'}),{preview:false});
    let draft=await openQuery(uri);
    accepted.push('one_query_replaces_file_protected_and_split_parents');
    await vscode.window.showTextDocument(uri,{preview:false});
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString(), 'the owner can be focused while the query is open');
    await vscode.window.showTextDocument(draft,{preview:false});
    await explorer.queryDesigner.show(draft.uri);
    const view=[...explorer.queryDesigner.views.values()][0];assert.ok(view);
    await vscode.window.showTextDocument(draft.uri,{preview:false});
    await until(()=>view.panel.active&&!vscode.window.tabGroups.all.some(group=>group.tabs.some(tab=>tab.input instanceof vscode.TabInputText&&tab.input.uri.toString()===draft.uri.toString())),'constructor retains modality');
    assert.equal(view.binding.current,true);view.panel.dispose();
    draft=await until(()=>vscode.window.activeTextEditor?.document.uri.toString()===draft.uri.toString()&&vscode.window.activeTextEditor.document,'constructor returns query');
    await until(()=>[...explorer.queries.sessions.values()].every(session=>!session.design),'constructor relinquishes the native query');
    accepted.push('nested_constructor_locks_and_returns_same_query');

    await replace(draft,'SELECT 1','SELECT 2');
    if (!draft.isDirty) assert.fail('Editing the reopened query did not make it dirty: ' + JSON.stringify(await queryWriteEvidence(explorer, draft)));
    await assertQuerySave(explorer,draft);
    assert.equal(vscode.window.activeTextEditor?.document,draft);
    assert.ok((await fs.readFile(fixture.module,'utf8')).includes('SELECT 2'));
    await replace(draft,'SELECT 2','SELECT 3');
    await assertQuerySave(explorer,draft);
    assert.equal(vscode.window.activeTextEditor?.document,draft);
    await closeQueryTabs(draft);
    let owner=await returned(uri);
    assert.equal(owner.getText(),original.replace('SELECT 1','SELECT 3'));
    assert.equal(owner.isDirty,false);
    await until(()=>explorer.queries.sessions.size===0,'query release lifecycle ends before native Undo');
    await vscode.commands.executeCommand('undo');
    assert.equal(owner.getText(),original.replace('SELECT 1','SELECT 2'));
    await vscode.commands.executeCommand('undo');
    assert.equal(owner.getText(),original);
    assert.equal(await owner.save(),true);
    assert.deepEqual(await fs.readFile(fixture.module),disk);
    accepted.push('two_native_saves_keep_query_open_and_parent_undo_history');
    draft=await openQuery(uri);await replace(draft,'SELECT 1','SELECT 9');
    await closeQueryTabs(draft,true);owner=await returned(uri);assert.equal(owner.getText(),original);
    assert.deepEqual(await fs.readFile(fixture.module),disk);
    accepted.push('native_discard_returns_unchanged_parent');
    draft=await openQuery(uri);await closeQueryTabs(draft);
    await returned(uri);accepted.push('unchanged_tab_close_returns_parent');

    for(const [kind,file] of [['common-template',fixture.query.schemaPath],['common-form',fixture.query.formPath]]){
      const xmlUri=vscode.Uri.file(file),before=await fs.readFile(file,'utf8');
      const files=vscode.workspace.getConfiguration('files',xmlUri);
      const rules={'**/*.xml':true,...(kind==='common-form'?{'**/*.sdbl':true}:{})};
      await files.update('readonlyInclude',rules,vscode.ConfigurationTarget.Global);
      const settingsBefore=JSON.stringify(files.inspect('readonlyInclude'));
      const source=await vscode.workspace.openTextDocument(xmlUri);
      await vscode.window.showTextDocument(source,{preview:false});
      await vscode.commands.executeCommand('type',{text:'must remain readonly'});
      await new Promise(resolve=>setTimeout(resolve,150));
      assert.equal(source.getText(),before.replace(/^\ufeff/,''),'XML source is natively readonly before query open');
      await vscode.commands.executeCommand('eska.explorer.openQuery',await firstXmlQuery(explorer,kind));
      draft=vscode.window.activeTextEditor.document;assert.equal(draft.uri.scheme,'eska-query');assert.equal(parentTabs(xmlUri).length,0);
      const editor=vscode.window.activeTextEditor,start=draft.getText().indexOf('SELECT 1');
      assert.ok(start>=0);
      editor.selection=new vscode.Selection(draft.positionAt(start),draft.positionAt(start+'SELECT 1'.length));
      await vscode.commands.executeCommand('type',{text:'SELECT 8'});
      await until(()=>draft.getText().includes('SELECT 8'),'native XML query input succeeds under readonly rules');
      if (!draft.isDirty) assert.fail(kind + ' query edit did not become dirty: ' + JSON.stringify(await queryWriteEvidence(explorer, draft)));
      await assertQuerySave(explorer, draft);
      assert.equal(vscode.window.activeTextEditor?.document,draft);
      await closeQueryTabs(draft);
      const xml=await returned(xmlUri);assert.equal(xml.isDirty,false);
      await until(()=>explorer.queries.sessions.size===0,'XML query release lifecycle ends');
      const after=await fs.readFile(file,'utf8');
      const expectedXml=before.replace('SELECT 1','SELECT 8');
      const serializedXml=kind==='common-template'?expectedXml.replace('<![CDATA[','').replace(']]>',''):expectedXml;
      assert.equal(after,serializedXml,'exact XML owner bytes follow selected query serialization only');
      await vscode.commands.executeCommand('type',{text:'must remain readonly'});
      await new Promise(resolve=>setTimeout(resolve,150));
      assert.equal(xml.getText(),after.replace(/^\ufeff/,''),'XML source remains natively readonly after query Save');
      assert.equal(JSON.stringify(files.inspect('readonlyInclude')),settingsBefore,'XML readonly settings remain unchanged');
      await files.update('readonlyInclude',undefined,vscode.ConfigurationTarget.Global);
      assert.ok(after.includes(kind==='common-template'?'SELECT 2':'<QueryText>SELECT 2</QueryText>'));
    }
    accepted.push('scd_and_dynamic_list_save_stays_open_then_close_returns_each_owner');
    const conflictUri=vscode.Uri.file(fixture.query.schemaPath);
    const conflictBefore=await fs.readFile(fixture.query.schemaPath,'utf8');
    await vscode.commands.executeCommand('eska.explorer.openQuery',await firstXmlQuery(explorer,'common-template'));
    draft=vscode.window.activeTextEditor.document;
    await replace(draft,'SELECT 8','SELECT 18');
    const conflicting=conflictBefore.replace('SELECT 8','SELECT 88');
    await fs.writeFile(fixture.query.schemaPath,conflicting);
    await until(async()=> (await vscode.workspace.openTextDocument(conflictUri)).getText()===conflicting.replace(/^\ufeff/,''),'external XML edit reaches native owner');
    assert.equal(await draft.save(),false,'external query conflict must reject Save');
    assert.ok(draft.getText().includes('SELECT 18'));
    assert.equal(draft.isDirty,true);
    assert.equal(await fs.readFile(fixture.query.schemaPath,'utf8'),conflicting);
    await closeQueryTabs(draft,true);await returned(conflictUri);
    accepted.push('external_xml_query_conflict_retains_native_draft_and_disk_change');

    draft=await openQuery(uri);await replace(draft,'SELECT 1','SELECT 6');
    const beforeReadonly=await fs.readFile(fixture.module),mode=(await fs.stat(fixture.module)).mode;
    try{
      if(process.platform!=='win32'){
        await fs.chmod(fixture.module,mode & ~0o222);
        assert.equal(await draft.save(),false,'filesystem read-only owner rejects query Save');
        assert.ok(draft.getText().includes('SELECT 6'));assert.equal(draft.isDirty,true);
        assert.deepEqual(await fs.readFile(fixture.module),beforeReadonly);
      }
    }finally{if(process.platform!=='win32')await fs.chmod(fixture.module,mode);}
    await assertQuerySave(explorer,draft);
    await closeQueryTabs(draft);await returned(uri);
    accepted.push(process.platform==='win32'?'filesystem_readonly_unix_permissions_skipped_on_windows':'filesystem_readonly_rejects_save_and_retry_after_permission_restore_succeeds');

    draft=await openQuery(uri);await replace(draft,'SELECT 6','SELECT 7');
    const beforeSupport=await fs.readFile(fixture.module);
    const rules=path.join(fixture.source,'Ext','ParentConfigurations.bin');
    const id='11111111-1111-1111-1111-111111111111',attribute='22222222-2222-2222-2222-222222222222';
    await fs.mkdir(path.dirname(rules),{recursive:true});
    await fs.writeFile(rules,`{6,0,1,${id},0,${id},"1","Vendor","Fixture",2,0,0,${id},${id},0,0,${attribute},${attribute},0,0,0,1,0,0,0,1,0,1,0,1,1,1,1}`);
    await vscode.workspace.getConfiguration('eska.explorer').update('supportPolicy',true,vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('eska.explorer.restart');
    await until(()=>explorer.connection.state.kind==='ready'&&!explorer.support.loading&&explorer.support.provideFileDecoration(uri)?.badge==='🔒','real backend locks owner through support policy');
    assert.equal(await draft.save(),false,'support policy rejects the pending native query save');
    assert.ok(draft.getText().includes('SELECT 7'));assert.equal(draft.isDirty,true);
    assert.deepEqual(await fs.readFile(fixture.module),beforeSupport);
    await closeQueryTabs(draft,true);
    accepted.push('backend_support_policy_rejects_save_without_losing_native_draft_or_source');

    await until(()=>explorer.queries.sessions.size===0,'closed sessions release source ownership');
    await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,suite:'query-modal',locale:vscode.env.language,accepted}));
  } catch(error) {await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:false,suite:'query-modal',error:String(error.stack??error),accepted,
    queryLogs,active:vscode.window.activeTextEditor?.document.uri.toString(),tabs:vscode.window.tabGroups.all.flatMap(group=>group.tabs).map(tab=>({label:tab.label,dirty:tab.isDirty,uri:tab.input?.uri?.toString()})),
    sessions:explorer&&[...explorer.queries.sessions.values()].map(session=>({parent:session.parent?.uri.toString(),active:session.parent?.active,guarding:!!session.guarding,ending:session.ending,closing:!!session.closing}))}));throw error;}
};

// The normal-window suite reuses the UI driver because extension-test windows deliberately bypass native save confirmations.
exports.until=until;exports.replace=replace;exports.parentTabs=parentTabs;exports.returned=returned;
exports.openQuery=openQuery;

exports.closeQueryTabs=closeQueryTabs;exports.saveAndCloseQuery=saveAndCloseQuery;exports.dialogButton=dialogButton;
exports.waitForQueryCheckpoint=waitForQueryCheckpoint;
exports.assertQuerySave=assertQuerySave;exports.queryWriteEvidence=queryWriteEvidence;
