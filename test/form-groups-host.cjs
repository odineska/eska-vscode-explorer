const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, editFormSource, sameSourcePath } = require('./webview-host.cjs');

// Configurator 8.3.27.2342 Linux: outer frame includes design-time borders.
const nativeFrames = {
  GroupDefault:[249,130], GroupNone:[249,126], GroupStrong:[259,130], GroupWeak:[249,130],
  GroupBackColor:[259,140], GroupTitleFont:[249,134], GroupHidden:[34,52], GroupCollapsible:[259,132],
  PagesTop:[271,152], PagesBottom:[271,152], PagesNone:[249,107], CommandBar:[291,79],
  PagesAuto:[271,152], PagesLeft:[362,127], PagesRight:[362,127], PagesSwipe:[271,152],
  ButtonGroup:[34,52], Popup:[34,52], BarWithButtonGroup:[291,79],
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
    await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
    let ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-form-frame')"), `render ${form.kind}`);
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    if(process.platform==='linux')await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-form-content .taxi-button,.taxi-tabs > button')].every(button=>button.style.width||button.classList.contains('taxi-button--help')||button.classList.contains('taxi-button--picture'))"),'native captions allocated');
    if(process.platform==='linux')await until(async()=>await ui.evaluate("!document.querySelector('[data-native-label=pending]')"),'native field captions settled');
    await ui.evaluate("globalThis.__formTestErrors=[];window.addEventListener('error',event=>globalThis.__formTestErrors.push(event.message));window.addEventListener('unhandledrejection',event=>globalThis.__formTestErrors.push(String(event.reason)))");
    const measureGeometry = `(() => {
      const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const style=node=>{if(!node)return null;const s=getComputedStyle(node);return {fontSize:s.fontSize,fontWeight:s.fontWeight,fontStyle:s.fontStyle,color:s.color,background:s.backgroundColor}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),elements:document.querySelectorAll('.taxi-element').length,
        inputs:[...document.querySelectorAll('.taxi-input')].filter(node=>getComputedStyle(node).visibility!=='hidden').map(node=>({...rect(node),...style(node)})),
        labels:[...document.querySelectorAll('.taxi-field-label')].filter(node=>getComputedStyle(node).visibility!=='hidden').map(node=>({...rect(node),...style(node),caption:node.textContent,lineHeight:getComputedStyle(node).lineHeight,raster:node.querySelector('[data-native-label]')?.dataset.nativeLabel})),
        group:style(document.querySelector('.taxi-group')),title:style(document.querySelector('.taxi-group-title')),
        buttons:[...document.querySelectorAll('.taxi-form-content .taxi-button')].map(node=>({label:node.textContent,...rect(node)})),
        tabs:document.querySelectorAll('.taxi-tabs [role=tab]').length,
        tabButtons:[...document.querySelectorAll('.taxi-tabs [role=tab]')].map(node=>({label:node.textContent,overflow:(node.querySelector('[data-native-label]')?.getClientRects().length??1)>1,...rect(node)})),menu:!!document.querySelector('.taxi-menu')};
    })()`;
    let geometry, previousGeometry, stableFrames=0;
    await until(async()=>{
      geometry=await ui.evaluate(measureGeometry);const value=JSON.stringify(geometry);
      stableFrames=value===previousGeometry?stableFrames+1:0;previousGeometry=value;
      return stableFrames>=3;
    },'stable native group geometry');
    if (['GroupDefault','GroupHidden'].includes(form.kind) && process.env.ESKA_SCREENSHOT_DIR) {
      const chrome=await ui.evaluate(`(() => {const v=document.querySelector('.preview-scroll'),r=document.querySelector('.taxi-form-frame');return {viewport:{width:v.clientWidth,height:v.clientHeight,scrollWidth:v.scrollWidth,scrollHeight:v.scrollHeight,style:v.style.cssText},elements:[...r.querySelectorAll('.taxi-element')].map(e=>({kind:e.dataset.kind,style:e.style.cssText,box:e.getBoundingClientRect().toJSON()})),root:r.style.cssText,mode:r.closest('.taxi-preview').dataset.formLayout,content:document.querySelector('.taxi-form-content').getBoundingClientRect().toJSON()}})()`);
      await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`group-allocation-${form.kind}.json`),JSON.stringify({geometry,chrome}));
    }
    if (process.platform === 'linux') {
      const locale=vscode.env.language.startsWith('ru')?'ru':'en';
      const expected = form.nativeFrameLocales?.[locale]?.frame ?? nativeFrames[form.kind];
      if(form.nativeFrameLocales)assert.deepEqual([geometry.frame.width,geometry.frame.height],expected,form.kind+' exact locale frame');
      // Text advances can land between CSS pixels; retain the exact measured result.
      for (const [index, dimension] of ['width','height'].entries()) if (Math.abs(geometry.frame[dimension]-expected[index])>1)
        mismatches.push(`${form.kind} ${dimension}: ${geometry.frame[dimension]} vs ${expected[index]}`);
      if (['PagesAuto','PagesSwipe'].includes(form.kind)) {
        assert.equal(geometry.frame.width,271,'native auto frame allocation');
        assert.deepEqual(geometry.inputs.map(input=>[input.x-geometry.frame.x,input.y-geometry.frame.y]),[[78,74],[78,106]],'native field positions after title allocation');
        assert.deepEqual(geometry.labels.map(label=>label.raster),['ready','ready'],'packaged LCD field captions');
      }
    }
    const hidden = ['GroupHidden','ButtonGroup','Popup'].includes(form.kind);
    if(hidden) assert.equal(geometry.elements,0,form.kind);
    if(form.kind.startsWith('Group')&&!hidden) {
      assert.equal(geometry.inputs.length,2,form.kind);
      assert.deepEqual(geometry.inputs.map(input=>[input.width,input.height]),[[161,23],[121,23]],form.kind);
      if(form.kind==='GroupBackColor'){assert.equal(geometry.group.background,'rgb(255, 255, 224)');assert.equal(geometry.title.color,'rgb(0, 0, 255)');}
      if(form.kind==='GroupTitleFont')assert.equal(geometry.title.fontWeight,'700');
    }
    if (form.kind === 'GroupNone') {
      const original = document.getText(), start = '<UsualGroup name="Group" id="1">';
      const placeholder = '<UsualGroup name="Settings" id="80"><Behavior>Usual</Behavior><ShowTitle>false</ShowTitle></UsualGroup>';
      const inserted = original.replace(start, placeholder + start);
      assert.notEqual(inserted, original);
      const first = "document.querySelector('.taxi-input')";
      const geometryOfFirst = () => ui.evaluate(`(() => {
        const input = ${first}.getBoundingClientRect(), form = document.querySelector('.taxi-form-frame').getBoundingClientRect();
        return [form.width, form.height, input.x-form.x, input.y-form.y];
      })()`);
      const initial = await geometryOfFirst();
      await ui.evaluate(`globalThis.__groupInput = ${first}; true`);
      try {
        await editFormSource(document, view, inserted);
        assert.ok([...view.nodes.values()].some(node => node.name === 'Settings'));
        assert.deepEqual(await geometryOfFirst(), initial);
        assert.equal(await ui.evaluate(`__groupInput === ${first}`), true);
      } finally {
        await editFormSource(document, view, original);
      }
    }
    if(form.kind==='GroupCollapsible') {
      assert.equal(await ui.evaluate("document.querySelector('.taxi-group-title button').getAttribute('aria-expanded')"),'true');
      await ui.evaluate("document.querySelector('.taxi-group-title button').click()");
      assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-input').length"),0);
      await until(()=>Object.values(view.previewNavigation?.collapsed??{}).includes(true),'collapsed navigation acknowledged');
      await service.receive(view,panel,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'collapsed group detached');
      const floating=await frame({detached:true,fixedFormArea:true,state:{title:view.frames.get('preview').panel.title}});
      await until(()=>floating.evaluate("document.querySelectorAll('.taxi-input').length===0&&document.querySelector('.taxi-group-title button')?.getAttribute('aria-expanded')==='false'"),'new floating window retains collapsed state');
      await ui.evaluate("globalThis.__sharedGroupNavigation=undefined;window.addEventListener('message',event=>{if(event.data.type==='previewNavigation')globalThis.__sharedGroupNavigation=event.data.previewNavigation})");
      await floating.evaluate("document.querySelector('.taxi-group-title button').click()");
      await until(()=>ui.evaluate("Object.values(globalThis.__sharedGroupNavigation?.collapsed??{}).includes(false)"),'floating expansion reaches the owner');
      floating.close();await service.receive(view,view.frames.get('preview'),{type:'dock'});ui.close();ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
      await until(()=>ui.evaluate("document.querySelectorAll('.taxi-input').length===2"),'docked group stays expanded');
    }
    if(form.kind==='PagesAuto') {
      await ui.evaluate("document.querySelector('.taxi-form-title').click()");
      await until(()=>view.selected?.key?.kind==='root','root design selection');
      await ui.screenshot(`group-design-root-${vscode.env.language}.png`);
      await ui.evaluate("document.querySelector('.taxi-input').click()");
      await until(()=>view.selected?.key?.value==='10','field design selection');
      await ui.screenshot(`group-design-field-${vscode.env.language}.png`);
    }
    if(form.kind.startsWith('Pages')) {
      assert.equal(geometry.tabs,form.kind==='PagesNone'?0:2);
      assert.equal(geometry.tabButtons.some(button=>button.overflow),false,'page captions stay on one line');
      if(geometry.tabs){await ui.evaluate("document.querySelectorAll('.taxi-tabs [role=tab]')[1].click()");assert.equal(await ui.evaluate("[...document.querySelectorAll('.taxi-input')].filter(node=>getComputedStyle(node).visibility!=='hidden').length"),1);
        const switched=await ui.evaluate("(()=>{const r=document.querySelector('.taxi-form-frame').getBoundingClientRect();return {width:r.width,height:r.height}})()");
        assert.deepEqual(switched,{width:geometry.frame.width,height:geometry.frame.height},'switching pages preserves the form allocation');
        await ui.screenshot(`group-${form.kind}-second-${vscode.env.language}.png`);
        await ui.evaluate("document.querySelectorAll('.taxi-tabs [role=tab]')[0].click()");}
    }
    if(form.kind==='PagesLeft') {
      const session=view.client.current.formSessionId;
      await ui.evaluate("document.querySelectorAll('.taxi-tabs>[role=tab]')[1].click();document.querySelector('.taxi-form-title').click()");
      await until(()=>view.selected?.key?.kind==='root'&&Object.values(view.previewNavigation?.pages??{}).some(page=>page.endsWith(':5')),'shared page retained with root selected');
      const navigation=JSON.stringify(view.previewNavigation);
      await service.receive(view,panel,{type:'previewNavigation',previewNavigation:{pages:{invalid:7},collapsed:{}}});assert.equal(JSON.stringify(view.previewNavigation),navigation,'malformed navigation rejected');
      await service.receive(view,{...panel},{type:'previewNavigation',previewNavigation:{pages:{},collapsed:{}}});assert.equal(JSON.stringify(view.previewNavigation),navigation,'disposed/replaced frame navigation rejected');
      await service.receive(view,panel,{type:'detach'});
      await until(()=>view.frames.get('preview')?.ready,'separate page preview ready');
      const detachedUi=await frame({detached:true,fixedFormArea:true,state:{title:view.frames.get('preview').panel.title}});
      await until(()=>detachedUi.evaluate("document.querySelector('.taxi-tabs>[aria-selected=true]')?.textContent==='Second page'"),'new floating window keeps page while root selected');
      const second=[...view.nodes.values()].find(node=>node.identity.key.value==='30');assert.ok(second);
      await ui.evaluate(`document.getElementById(${JSON.stringify('form-row-'+second.identity.source+':current:30')}).click()`);
      await until(async()=>await detachedUi.evaluate("document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent==='Second page'&&document.querySelector('.taxi-page[aria-hidden=false] .taxi-field-label')?.textContent==='Second:'"),'tree selection reveals its page in the separate window');
      await detachedUi.evaluate("document.querySelector('.taxi-tabs [role=tab]').click()");
      await until(()=>view.selected?.key.value==='3','page selection is shared with owner');
      detachedUi.close();
      await service.receive(view,view.frames.get('preview'),{type:'dock'});
      await until(async()=>await ui.evaluate("document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent==='First page'&&[...document.querySelectorAll('.taxi-tabs > button')].every(button=>button.style.width)"),'owner returns to the shared page');
      assert.equal(view.client.current.formSessionId,session);
      await replaceText(document,'<Page name="FirstPage" id="3">','<Page name="FirstPage" id="3"><Visible>false</Visible>');
      await until(async()=>view.phase==='ready'&&await ui.evaluate("document.querySelectorAll('.taxi-tabs [role=tab]').length===1&&document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent==='Second page'"),'hiding the selected page activates the first visible page');
      await replaceText(document,'<Page name="FirstPage" id="3"><Visible>false</Visible>','<Page name="FirstPage" id="3">');
      await until(async()=>view.phase==='ready'&&await ui.evaluate("document.querySelectorAll('.taxi-tabs [role=tab]').length===2&&document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent==='First page'&&[...document.querySelectorAll('.taxi-tabs > button')].every(button=>button.style.width)"),'returning the selected page restores its identity');
      const original=document.getText().match(/<Page name="FirstPage" id="3">[\s\S]*?<\/Page>/)[0];
      const title=value=>'<Title>'+['ru','en'].map(language=>`<v8:item><v8:lang>${language}</v8:lang><v8:content>${value}</v8:content></v8:item>`).join('')+'</Title>';
      const innerPage=(name,id,label)=>`<Page name="${name}" id="${id}">${title(name)}<ChildItems><LabelDecoration name="${name}Label" id="${id+1}">${title(label)}</LabelDecoration></ChildItems></Page>`;
      const nested='<Pages name="Nested" id="1000"><PagesRepresentation>TabsOnBottom</PagesRepresentation><ChildItems>'+innerPage('InnerFirst',1001,'Inner one')+innerPage('InnerSecond',1003,'Inner two')+'</ChildItems></Pages>';
      const changed=original.replace('</ChildItems>',nested+'</ChildItems>');
      await replaceText(document,original,changed);
      await until(async()=>view.phase==='ready'&&await ui.evaluate("!!document.querySelector('.taxi-pages[data-representation=TabsOnBottom]')"),'nested page group rendered');
      assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.taxi-pages[data-representation=TabsOnBottom] > .taxi-tabs')).flexDirection"),'row','outer side tabs do not restyle a nested bottom tab bar');
      await ui.evaluate("globalThis.__nestedSelection=undefined;window.addEventListener('message',event=>{if(event.data.type==='selection')globalThis.__nestedSelection=event.data.identity?.key.value});document.querySelectorAll('.taxi-pages[data-representation=TabsOnBottom] > .taxi-tabs > button')[1].click();document.querySelectorAll('.taxi-pages[data-representation=TabsOnLeftHorizontal] > .taxi-tabs > button')[1].click()");
      await until(async()=>await ui.evaluate("globalThis.__nestedSelection==='5'&&document.querySelector('.taxi-pages[data-representation=TabsOnLeftHorizontal] > .taxi-tabs > [aria-selected=true]').textContent==='Second page'"),'last outer-page selection acknowledged');
      assert.equal(await ui.evaluate("[...document.querySelectorAll('.taxi-pages[data-representation=TabsOnBottom] .taxi-label')].every(node=>getComputedStyle(node).visibility==='hidden')"),true,'nested active pages stay hidden inside an inactive outer page');
      await ui.evaluate(`(()=>{const row=document.getElementById(${JSON.stringify('form-row-'+second.identity.source+':current:1004')});row.scrollIntoView({block:'nearest'});row.click()})()`);
      await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-label')].some(node=>node.textContent==='Inner two'&&getComputedStyle(node).visibility==='visible')"),'tree selection opens both enclosing pages');
      await replaceText(document,changed,original);
      await until(async()=>view.phase==='ready'&&await ui.evaluate("!document.querySelector('.taxi-pages[data-representation=TabsOnBottom]')"),'nested probe removed from dirty buffer');
      await ui.evaluate("document.querySelector('.taxi-tabs > button').click()");
      await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-tabs > button')].every(button=>button.style.width)"),'native widths restored after nested probe');
    }
    if(['CommandBar','BarWithButtonGroup'].includes(form.kind))assert.deepEqual(geometry.buttons.map(button=>button.label),['First command','Second command']);
    if(process.platform==='linux'&&['CommandBar','BarWithButtonGroup'].includes(form.kind))assert.deepEqual(geometry.buttons.map(button=>button.width),[115,133]);
    if(form.kind==='BarWithPopup') {
      assert.equal(geometry.buttons.length,1);assert.equal(geometry.menu,false);
      if(process.platform==='linux')assert.equal(geometry.buttons[0].width,77);
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
    if(form.kind==='GroupBackColor' && process.platform==='linux') {
      await ui.evaluate("globalThis.__lcdLabel=document.querySelector('.taxi-field-label')");
      for(const [from,to,color] of [['LightYellow','LightBlue',[173,216,230]],['LightBlue','LightYellow',[255,255,224]]]) {
        await replaceText(document,`<BackColor>web:${from}</BackColor>`,`<BackColor>web:${to}</BackColor>`);
        await until(async()=>await ui.evaluate(`(() => {const c=document.querySelector('.taxi-field-label canvas');if(!c?.width)return false;
          const p=c.getContext('2d').getImageData(0,0,1,1).data;return p[0]===${color[0]}&&p[1]===${color[1]}&&p[2]===${color[2]};})()`),'LCD caption follows dirty ancestor background');
      }
      assert.equal(await ui.evaluate("globalThis.__lcdLabel===document.querySelector('.taxi-field-label')"),true);
      assert.equal(document.isDirty,true);
    }
    if(form.kind==='CommandBar') {
      await replaceText(document,'First command','Second command');
      await until(async()=>await ui.evaluate("document.querySelector('.taxi-command-bar .taxi-button')?.textContent==='Second command'"),'dirty command caption');
      if(process.platform==='linux')await until(async()=>await ui.evaluate("document.querySelector('.taxi-command-bar .taxi-button')?.getBoundingClientRect().width===133"),'dirty native caption width');

      const bar = "document.querySelector('.taxi-command-bar')";
      const inlineIds = `[...${bar}.querySelectorAll(':scope > [data-element]')].map(element => element.dataset.element.split(':').at(-1))`;
      const popup = `${bar}.querySelector(':scope > .taxi-popup')`;
      const first = '<CommandName>Form.Command.First</CommandName>';
      const second = '<CommandName>Form.Command.Second</CommandName>';
      const dual = '<LocationInCommandBar>InCommandBarAndInAdditionalSubmenu</LocationInCommandBar>';
      const overflow = '<LocationInCommandBar>InAdditionalSubmenu</LocationInCommandBar>';
      const inline = '<LocationInCommandBar>InCommandBar</LocationInCommandBar>';
      await replaceText(document, first, first + dual);
      await replaceText(document, second, second + overflow);
      await until(() => ui.evaluate(`JSON.stringify(${inlineIds})==='["10"]' && !!${popup}`), 'only the visible command stays on the bar');
      await ui.evaluate(`${popup}.querySelector('button').click()`);
      assert.equal(await ui.evaluate(`${popup}.querySelectorAll('[role=menuitem]').length`), 2);
      await ui.evaluate(`${popup}.querySelectorAll('[role=menuitem]')[1].click()`);
      await until(() => view.selected?.key?.value === '20', 'overflow item keeps its source identity');
      await replaceText(document, first + dual, first + overflow);
      await until(() => ui.evaluate(`${inlineIds}.length===0 && !!${popup}`), 'bar only shows More when both commands move');
      await replaceText(document, first + overflow, first + inline);
      await replaceText(document, second + overflow, second + dual);
      await until(() => ui.evaluate(`JSON.stringify(${inlineIds})==='["10","20"]' && !${popup}`), 'dual location alone keeps both commands on the bar');
    }
    if (form.kind === 'Decorations' && process.platform === 'linux') {
      const text = document.getText();
      const originalLabel = /(<LabelDecoration name="Label" id="1">)\s*<Title[^>]*>.*?<\/Title>/s.exec(text);
      assert.ok(originalLabel);
      await replaceText(document, originalLabel[0], originalLabel[1] + '<Width>2</Width>');
      const bar = '<AutoCommandBar name="FormCommandBar" id="-1"/>';
      await replaceText(document, bar, '<Group>AlwaysHorizontal</Group>' + bar);
      const measureSpacer = `(() => {
        const label = document.querySelector('.taxi-label'), bounds = label.getBoundingClientRect();
        const items = label.closest('.taxi-items');
        return { text: label.textContent, width: bounds.width, height: bounds.height,
          gap: getComputedStyle(items).columnGap, horizontal: items.classList.contains('taxi-items--horizontal') };
      })()`;
      const verifySpacer = width => until(async () => {
        const spacer = await ui.evaluate(measureSpacer);
        return spacer.text === '' && spacer.horizontal && spacer.width === width && spacer.height === 17 && spacer.gap === '10px';
      }, 'empty decoration keeps native dimensions');
      await verifySpacer(20);
      await replaceText(document, originalLabel[1] + '<Width>2</Width>', originalLabel[1] + '<Width>7</Width>');
      await verifySpacer(70);
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
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:!mismatches.length,formGroups:true,locale:vscode.env.language,sourceWritesDuringViewing:false,
    pagesKeepAllocation:true,detachedPageWithRootSelection:true,collapsedGroupHandoff:true,sharedGroupExpansion:true,pageTreeSelectionDetached:true,dirtySelectedPageVisibility:true,nestedPageIsolation:true,results,mismatches}));
  assert.deepEqual(mismatches,[]);
};
