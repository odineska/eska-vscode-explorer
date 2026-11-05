const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

/** Run from an installed startup probe: extension-test mode deliberately skips native editor restoration. */
exports.run = async () => {
  assert.ok(process.env.ESKA_HOST_RESTART && process.env.ESKA_TEST_VSIX);
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), file = fixture.form.path;
  const marker = path.join(fixture.root, 'form-restore-state.json');
  const resultFile = path.join(fixture.root, 'host-result.json');
  const title = `${vscode.env.language.startsWith('ru') ? 'Форма' : 'Form'}: Preview`;
  const previewTitle = `${title} — ${vscode.env.language.startsWith('ru') ? 'Предпросмотр формы' : 'Form preview'}`;
  let stage = 'source';
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    let checkpoint;
    try { checkpoint = JSON.parse(await fs.readFile(marker, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const first = checkpoint === undefined;
    if (first) {
      assert.equal(process.env.ESKA_HOST_RUN, '0');
      const before = await fs.readFile(file), text = document.getText();
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), text.replace('Other page', 'Unsaved restored page'));
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await vscode.window.showTextDocument(document, { preview:false });
      await vscode.commands.executeCommand('eska.explorer.previewForm');
      stage = 'initial-main';
      const main = await frame({state:{title}});
      await until(async () => await main.evaluate("!!document.querySelector('.taxi-input')"), 'initial form DOM');
      await main.evaluate(`document.querySelector('.form-splitter:not(.form-splitter--vertical)').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
        const zoom=document.querySelector('.form-zoom select');zoom.value='125';zoom.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelectorAll('.taxi-tabs button')[1].click();document.querySelector('.taxi-input').click();`);
      await until(async () => await main.evaluate("document.querySelector('.form-inspectors').style.height==='240px'&&document.querySelector('.form-zoom select').value==='125'&&document.querySelector('.taxi-page[aria-hidden=false] .taxi-label').textContent==='Unsaved restored page'"), 'main UI configured');
      await main.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
      stage = 'initial-preview';
      const preview = await frame({state:{title:previewTitle}});
      await until(async () => await preview.evaluate("!!document.querySelector('.taxi-input')"), 'detached form DOM');
      await preview.evaluate(`const zoom=document.querySelector('.form-zoom select');zoom.value='150';zoom.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelectorAll('.taxi-tabs button')[1].click();document.querySelector('.taxi-input').click();`);
      await until(async () => await preview.evaluate("document.querySelector('.form-zoom select').value==='150'&&document.querySelector('.taxi-page[aria-hidden=false] .taxi-label').textContent==='Unsaved restored page'"), 'preview UI configured');
      await preview.evaluate("document.querySelector('.taxi-input').click()");
      await until(async () => await main.evaluate("document.querySelector('.form-tree-row.selected').id.endsWith(':2')"), 'shared selection settled before closing');
      const selection = await main.evaluate("document.querySelector('.form-tree-row.selected').id");
      assert.ok((await preview.targets()).some(target => target.type === 'page' && target.url === 'about:blank'), 'native floating window exists');
      // Allow the renderer's next animation frame to persist its actual UI state.
      await preview.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await main.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await fs.writeFile(marker, JSON.stringify({pid:process.pid,disk:before.toString('hex'),text:document.getText(),selection,caption:'Unsaved restored page'}));
      assert.deepEqual(await fs.readFile(file), before);
      preview.close(); main.close();
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
      // The replacement startup probe owns assertions and final normal shutdown.
      await new Promise(() => {});
    } else {
      assert.notEqual(process.pid, checkpoint.pid, 'normal restart uses another extension host');
      await until(() => document.isDirty && document.getText() === checkpoint.text, 'native hot exit restores dirty XML');
      stage = 'restored-tabs';
      await until(() => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('eska.formViewer')).length === 2, 'both serialized form panels restored');
      const main = await frame({state:{title}}), preview = await frame({state:{title:previewTitle}});
      stage = 'restored-model';
      await until(async () => await preview.evaluate(`document.querySelector('.taxi-page[aria-hidden=false] .taxi-label')?.textContent===${JSON.stringify(checkpoint.caption)}`), 'restored form uses unsaved XML');
      assert.equal(await main.evaluate("document.querySelector('.form-inspectors').style.height"), '240px');
      assert.equal(await main.evaluate("document.querySelector('.form-zoom select').value"), '125');
      assert.equal(await preview.evaluate("document.querySelector('.form-zoom select').value"), '150');
      assert.equal(await main.evaluate("document.querySelector('.form-tree-row.selected').id"), checkpoint.selection, 'shared selection survives serialization');
      assert.equal(await preview.evaluate("document.querySelector('.taxi-tabs button[aria-selected=true]').textContent"), 'Other');
      assert.ok((await preview.targets()).some(target => target.type === 'page' && target.url === 'about:blank'), 'native floating workbench restored');
      stage = 'restored-live-update';
      const text = document.getText(), edit = new vscode.WorkspaceEdit();
      const caption = process.env.ESKA_HOST_RUN === '0' ? 'Live after reload' : 'Live after restart';
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), text.replace(checkpoint.caption, caption));
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await until(async () => await preview.evaluate(`document.querySelector('.taxi-page[aria-hidden=false] .taxi-label')?.textContent===${JSON.stringify(caption)}`), 'restored panels are live');
      assert.equal((await fs.readFile(file)).toString('hex'), checkpoint.disk);
      await fs.writeFile(marker, JSON.stringify({...checkpoint,pid:process.pid,text:document.getText(),caption}));
      await main.screenshot(`form-restored-${vscode.env.language}.png`);
      preview.close(); main.close();
    }
    await fs.writeFile(resultFile, JSON.stringify({passed:true,formRestore:true,run:process.env.ESKA_HOST_RUN,locale:vscode.env.language,
      installedNormalProcesses:true,dirtyPreserved:true,detached:true,restored:!first,
      mode:process.env.ESKA_HOST_RUN==='0'?'reloadWindow':'normalRestart',sourceWritesDuringViewing:false}));
  } catch (error) {
    await fs.writeFile(resultFile, JSON.stringify({passed:false,stage,error:String(error.stack??error),
      tabs:vscode.window.tabGroups.all.map(group=>group.tabs.map(tab=>({label:tab.label,input:tab.input,isActive:tab.isActive}))),
      documents:vscode.workspace.textDocuments.map(document=>({path:document.uri.fsPath,dirty:document.isDirty}))}));
  }
  // Close Window targets the active auxiliary window. Quit closes this isolated
  // profile's complete normal workbench and preserves its native window layout.
  await vscode.commands.executeCommand('workbench.action.quit');
};
