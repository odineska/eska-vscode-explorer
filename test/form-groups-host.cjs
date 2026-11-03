const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

// Configurator 8.3.27.2342 Linux: outer frame includes design-time borders.
const nativeFrames = {
  GroupDefault:[249,130], GroupNone:[249,126], GroupStrong:[259,130], GroupWeak:[249,130],
  GroupBackColor:[259,140], GroupTitleFont:[249,134], GroupHidden:[34,52], GroupCollapsible:[259,132],
  PagesTop:[271,152], PagesBottom:[271,152], PagesNone:[249,107], CommandBar:[291,79],
  ButtonGroup:[34,52], Popup:[34,52], BarWithButtonGroup:[291,79], BarWithPopup:[142,79],
  StyleReferences:[291,113], Decorations:[94,118],
};

async function replaceText(document, from, to) {
  const text=document.getText();assert.ok(text.includes(from));
  const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(text.length)),text.replaceAll(from,to));
  assert.equal(await vscode.workspace.applyEdit(edit),true);
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate(); await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results = [], mismatches = [];
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview:false, viewColumn:vscode.ViewColumn.One });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service = explorer.formPreview;
    await until(() => [...service.views.values()].some(view => view.path === form.path && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => view.path === form.path), panel = view.frames.get('main');
    const ui = await frame({state:{title:panel.panel.title}});
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-form-frame')"), `render ${form.kind}`);
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    if(process.platform==='linux')await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-form-content .taxi-button,.taxi-tabs > button')].every(button=>button.style.width||button.classList.contains('taxi-button--help')||button.classList.contains('taxi-button--picture'))"),'native captions allocated');
    await ui.evaluate("globalThis.__formTestErrors=[];window.addEventListener('error',event=>globalThis.__formTestErrors.push(event.message));window.addEventListener('unhandledrejection',event=>globalThis.__formTestErrors.push(String(event.reason)))");
    const geometry = await ui.evaluate(`(() => {
      const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const style=node=>{if(!node)return null;const s=getComputedStyle(node);return {fontSize:s.fontSize,fontWeight:s.fontWeight,fontStyle:s.fontStyle,color:s.color,background:s.backgroundColor}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),elements:document.querySelectorAll('.taxi-element').length,
        inputs:[...document.querySelectorAll('.taxi-input')].map(node=>({...rect(node),...style(node)})),
        group:style(document.querySelector('.taxi-group')),title:style(document.querySelector('.taxi-group-title')),
        buttons:[...document.querySelectorAll('.taxi-form-content .taxi-button')].map(node=>({label:node.textContent,...rect(node)})),
        tabs:document.querySelectorAll('.taxi-tabs [role=tab]').length,menu:!!document.querySelector('.taxi-menu')};
    })()`);
    if (process.platform === 'linux') {
      const expected = nativeFrames[form.kind];
      // Text advances can land between CSS pixels; retain the exact measured result.
      for (const [index, dimension] of ['width','height'].entries()) if (Math.abs(geometry.frame[dimension]-expected[index])>1)
        mismatches.push(`${form.kind} ${dimension}: ${geometry.frame[dimension]} vs ${expected[index]}`);
    }
    const hidden = ['GroupHidden','ButtonGroup','Popup'].includes(form.kind);
    if(hidden) assert.equal(geometry.elements,0,form.kind);
    if(form.kind.startsWith('Group')&&!hidden) {
      assert.equal(geometry.inputs.length,2,form.kind);
      assert.deepEqual(geometry.inputs.map(input=>[input.width,input.height]),[[161,23],[121,23]],form.kind);
      if(form.kind==='GroupBackColor'){assert.equal(geometry.group.background,'rgb(255, 255, 224)');assert.equal(geometry.title.color,'rgb(0, 0, 255)');}
      if(form.kind==='GroupTitleFont')assert.equal(geometry.title.fontWeight,'700');
    }
    if(form.kind==='GroupCollapsible') {
      assert.equal(await ui.evaluate("document.querySelector('.taxi-group-title button').getAttribute('aria-expanded')"),'true');
      await ui.evaluate("document.querySelector('.taxi-group-title button').click()");
      assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-input').length"),0);
      await ui.evaluate("document.querySelector('.taxi-group-title button').click()");
    }
    if(form.kind.startsWith('Pages')) {
      assert.equal(geometry.tabs,form.kind==='PagesNone'?0:2);
      if(geometry.tabs){await ui.evaluate("document.querySelectorAll('.taxi-tabs [role=tab]')[1].click()");assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-input').length"),1);await ui.evaluate("document.querySelectorAll('.taxi-tabs [role=tab]')[0].click()");}
    }
    if(['CommandBar','BarWithButtonGroup'].includes(form.kind))assert.deepEqual(geometry.buttons.map(button=>button.label),['First command','Second command']);
    if(process.platform==='linux'&&['CommandBar','BarWithButtonGroup'].includes(form.kind))assert.deepEqual(geometry.buttons.map(button=>button.width),[115,133]);
    if(form.kind==='BarWithPopup') {
      assert.equal(geometry.buttons.length,1);assert.equal(geometry.menu,false);
      if(process.platform==='linux')assert.equal(geometry.buttons[0].width,76);
      await ui.evaluate("document.querySelector('.taxi-popup > button').click()");
      assert.deepEqual(await ui.evaluate("[...document.querySelectorAll('.taxi-menu [role=menuitem]')].map(node=>node.textContent)"),['First command','Second command']);
      assert.deepEqual(await ui.evaluate("(() => {const menu=document.querySelector('.taxi-menu'),item=menu.firstElementChild;return [menu.getBoundingClientRect().width,item.getBoundingClientRect().height,getComputedStyle(item).backgroundColor]})()"),[210,30,'rgb(250, 204, 31)']);
      await ui.screenshot(`group-menu-open-${vscode.env.language}.png`);
      await ui.evaluate("document.querySelector('.taxi-popup').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
      assert.equal(await ui.evaluate('document.activeElement.textContent'),'Second command');
      await ui.evaluate("document.querySelector('.taxi-popup').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await ui.evaluate("!!document.querySelector('.taxi-menu')"),false);
      await ui.evaluate("document.querySelector('.taxi-popup > button').click();document.querySelector('.taxi-form-title').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
      assert.equal(await ui.evaluate("!!document.querySelector('.taxi-menu')"),false);
      await ui.evaluate("document.querySelector('.taxi-popup > button').click();document.querySelectorAll('.taxi-menu [role=menuitem]')[1].click()");
      await until(()=>view.selected?.key?.value==='20','select menu command');
      assert.equal(await ui.evaluate("!!document.querySelector('.taxi-menu')"),false);
    }
    if(form.kind==='StyleReferences') {
      assert.deepEqual(geometry.inputs.map(input=>[input.width,input.height]),[[199,29],[121,23]]);
      assert.equal(geometry.inputs[0].fontWeight,'700');assert.equal(geometry.inputs[0].fontStyle,'italic');assert.equal(geometry.inputs[0].color,'rgb(255, 140, 0)');
    }
    await ui.screenshot(`group-${form.kind}-${vscode.env.language}.png`);
    if(form.kind==='CommandBar') {
      await replaceText(document,'First command','Second command');
      await until(async()=>await ui.evaluate("document.querySelector('.taxi-command-bar .taxi-button')?.textContent==='Second command'"),'dirty command caption');
      if(process.platform==='linux')await until(async()=>await ui.evaluate("document.querySelector('.taxi-command-bar .taxi-button')?.getBoundingClientRect().width===133"),'dirty native caption width');
    }
    if(form.kind==='BarWithPopup') {
      await replaceText(document,'Actions','Actions updated');
      await until(async()=>await ui.evaluate("document.querySelector('.taxi-popup > button')?.textContent.includes('Actions updated')"),'dirty popup title');
      await ui.evaluate("(() => {const scale=document.querySelector('.form-zoom select');scale.value='200';scale.dispatchEvent(new Event('change',{bubbles:true}))})()");
      await replaceText(document,'Actions updated','Actions');
      await until(async()=>await ui.evaluate("document.querySelector('.taxi-popup > button')?.textContent==='Actions▾'"),'restore popup title at 200%');
      // Chromium reports local CSS units for zoomed descendants.
      await until(async()=>await ui.evaluate(`document.querySelector('.taxi-preview').style.zoom==='2'&&parseFloat(document.querySelector('.taxi-popup > button')?.style.width)===${geometry.buttons[0].width}`),'caption allocation stays independent of zoom');
      await ui.evaluate("(() => {const scale=document.querySelector('.form-zoom select');scale.value='100';scale.dispatchEvent(new Event('change',{bubbles:true}))})()");
    }
    assert.deepEqual(await ui.evaluate('globalThis.__formTestErrors'),[],form.kind);
    assert.deepEqual(await fs.readFile(form.path),before);results.push({kind:form.kind,...geometry});panel.panel.dispose();
    await until(()=>service.views.size===0,'release group form');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:!mismatches.length,formGroups:true,locale:vscode.env.language,sourceWritesDuringViewing:false,results,mismatches}));
  assert.deepEqual(mismatches,[]);
};
