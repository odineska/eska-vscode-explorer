const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { connect, connectWorkbench } = require('./query-constructor-dom.cjs');
async function until(check, label) {
  const end = Date.now() + 25000;
  while (Date.now() < end) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(label);
}
const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
const setting = (name, kind) => `${kind}[data-setting="${name}"], [data-setting="${name}"] ${kind}`;
async function click(ui, selector) { await ui.evaluate(`${element(selector)}.click()`); }
async function fill(ui, selector, value) {
  await ui.evaluate(`(() => { const input = ${element(selector)}; input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
exports.run = async function () {
  console.log('ESKA_SETTINGS_ACTIONS_START');
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const manifest = path.join(fixture.root, 'eska.toml'), local = path.join(fixture.root, '.eska/settings_local.toml');
  const original = await fs.readFile(manifest, 'utf8');
  const source = 'Процедура Пример()\nА=Сумма(1,2);\nКонецПроцедуры\n';
  await fs.writeFile(fixture.module, source);
  const shim = path.join(fixture.root, 'platform-list.cjs');
  const platforms = {schema_version:1,kind:'installed-platforms',platforms:[
    {version:'8.3.27.1001',ibcmd:'/fixture/host/ibcmd',source:{kind:'host'}},
    {version:'8.3.27.2002',ibcmd:'/fixture/box/ibcmd',source:{kind:'distrobox',container:'settings-box'}},
  ],sources:{host:'ready',distrobox:{status:'ready'}}};
  await fs.writeFile(shim, '#!/usr/bin/env node\nconsole.log('+JSON.stringify(JSON.stringify(platforms))+');\n', {mode:0o755});
  const config = vscode.workspace.getConfiguration('eska.explorer', vscode.Uri.file(fixture.root));
  await config.update('buildExecutable', shim, vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.getConfiguration('files').update('simpleDialog.enable',true,vscode.ConfigurationTarget.Workspace);
  const extension = vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  console.log('ESKA_SETTINGS_ACTIONS_ACTIVATED', explorer.connection.state.kind);
  await until(() => explorer.connection.state.kind === 'ready', 'project connected');
  const settings = await until(async () => {
    const roots = await explorer.getChildren();
    return [...roots,...(await Promise.all(roots.filter(value => value.node && !value.node.parent).map(value => explorer.getChildren(value)))).flat()]
      .find(value => value.fileKind === 'group' && value.kind === 'settings');
  }, 'settings node');
  await vscode.commands.executeCommand('eska.explorer.configureProject',settings);
  const ui = await connect(until,'.settings-page'), workbench = await connectWorkbench(until);
  try {
    await until(() => ui.evaluate("!!document.querySelector('[aria-labelledby=platform] .settings-import')"),'platform button');
    await click(ui,'input[name=enabled]');
    async function selectPlatform(version) {
      await workbench.focus();
      await until(()=>ui.evaluate("!document.querySelector('[aria-labelledby=platform] .settings-import').disabled"),'platform picker available');
      await click(ui,'[aria-labelledby=platform] .settings-import');
      const rows = '.quick-input-widget:not([style*="display: none"]) .quick-input-list .monaco-list-row';
      await until(()=>workbench.evaluate(`[...document.querySelectorAll(${JSON.stringify(rows)})].some(value=>value.textContent.includes(${JSON.stringify(version)}))`),'installed platform choice');
      await workbench.evaluate(`document.querySelector('.quick-input-widget:not([style*="display: none"]) input').focus()`);
      if(version==='8.3.27.2002') await workbench.key('ArrowDown','ArrowDown',40);
      await workbench.key('Enter','Enter',13);
      await until(() => ui.evaluate(`${element('input[name=version]')}.value === ${JSON.stringify(version)}`),'version imported into draft').catch(async error=>{throw new Error(error.message+JSON.stringify(await ui.evaluate("({responses:window.platformResponses,version:document.querySelector('input[name=version]').value,runner:document.querySelector('select[name=runner]').value})")))});
    }
    await ui.evaluate("window.platformResponses=[];window.addEventListener('message',event=>{if(event.data?.type==='platform')window.platformResponses.push(event.data)});");
    console.log('ESKA_SETTINGS_ACTIONS_PLATFORM');
    await selectPlatform('8.3.27.1001');
    assert.equal(await ui.evaluate(`${element('select[name=runner]')}.value`),'local');
    assert.equal(await ui.evaluate(`${element('input[name=ibcmd]')}.value`),'/fixture/host/ibcmd');
    await selectPlatform('8.3.27.2002');
    assert.equal(await ui.evaluate(`${element('select[name=runner]')}.value`),'distrobox');
    assert.equal(await ui.evaluate(`${element('input[name=container]')}.value`),'settings-box');
    assert.equal(await ui.evaluate(`${element('input[name=ibcmd]')}.value`),'/fixture/box/ibcmd');
    await assert.rejects(fs.access(local));
    await ui.evaluate("window.settingsActionResponses=[];window.settingsActionErrors=[];window.addEventListener('message',event=>window.settingsActionResponses.push({type:event.data?.type,id:event.data?.id,operation:event.data?.operation,error:event.data?.error}));window.addEventListener('error',event=>window.settingsActionErrors.push(event.message));");
    console.log('ESKA_SETTINGS_ACTIONS_FORMAT');
    await click(ui,'[data-settings-section=format]');
    const profile=setting('format.profile','select'), spacing=setting('format.bsl.space_around_operators','input');
    await until(() => ui.evaluate(`!!${element(profile)} && !!${element(spacing)}`),'format settings loaded').catch(async error => { throw new Error(error.message + ': ' + await ui.evaluate("document.body.innerText + JSON.stringify({responses:window.settingsActionResponses,errors:window.settingsActionErrors}) + ' reloadDisabled=' + document.querySelector('.settings-heading button').disabled + JSON.stringify([...document.querySelectorAll('[data-setting]')].map(value=>value.dataset.setting))")); });
    await fill(ui,profile,'1c');
    await ui.evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(value=>/Показать на примере|Show an example/.test(value.textContent));button.click();})()`);
    const dialog='.quick-input-widget:not([style*="display: none"]) input';
    await until(() => workbench.evaluate(`!!${element(dialog)}`),'simple file dialog');
    await workbench.evaluate(`(() => { const input=${element(dialog)}; input.focus();input.select(); })()`);
    await workbench.submitInput(fixture.module);
    await until(() => workbench.evaluate(`(() => {
      const row=[...document.querySelectorAll('.quick-input-widget .monaco-list-row')].find(value=>value.textContent.includes(${JSON.stringify(path.basename(fixture.module))}));
      if(!row)return false;row.click();return true;
    })()`),'BSL module visible in simple dialog');
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    const texts=()=>ui.evaluate("[...document.querySelectorAll('[data-format-preview] pre')].map(value=>value.textContent)");
    await until(async()=> (await texts()).length===2,'real formatting example');
    assert.equal((await texts())[0],source);
    const first=(await texts())[1];
    assert.notEqual(first,source);
    await click(ui,spacing);
    await until(async()=> (await texts())[1]!==first,'checkbox refresh without saving');
    const second=(await texts())[1];
    await fill(ui,profile,'eska');
    await until(async()=> (await texts())[1]!==second,'preset refresh without saving');
    const third=(await texts())[1];
    await click(ui,'[data-setting="format.bsl.space_around_operators"] button');
    await until(async()=> (await texts())[1]!==third,'cleared override restores inherited style');
    assert.ok((await texts())[1].includes('А ='));
    assert.equal((await texts())[0],source);
    assert.ok(second.includes('А='));
    assert.deepEqual(await ui.evaluate('window.settingsActionErrors'),[]);
    assert.equal(await fs.readFile(fixture.module,'utf8'),source);
    assert.equal(await fs.readFile(manifest,'utf8'),original);
    await assert.rejects(fs.access(local));
    await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,suite:'settings-actions',locale:vscode.env.language,
      vscode:vscode.version,platformHost:true,platformDistrobox:true,formatRealBackend:true,formatCheckboxRefresh:true,formatPresetRefresh:true,formatClearOverride:true,noWrites:true}));
  } finally { ui.close();workbench.close(); }
};
