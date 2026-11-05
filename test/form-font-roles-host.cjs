const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), gallery = fixture.formFonts, results = [];
  const files = [gallery.style,gallery.definition,...gallery.forms.map(form=>form.path)];
  const before = await Promise.all(files.map(file=>fs.readFile(file)));
  const explorer = await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const style = await vscode.workspace.openTextDocument(vscode.Uri.file(gallery.style)), originalStyle = style.getText();
  const definition = await vscode.workspace.openTextDocument(vscode.Uri.file(gallery.definition)), originalDefinition = definition.getText();
  async function glyphs(ui) {
    const images = await ui.evaluate(`(() => {const buttons=[...document.querySelectorAll('.taxi-command-bar .taxi-button')];
      if(buttons.length!==3||buttons.some(button=>button.querySelector('[data-native-caption]')?.dataset.nativeCaption!=='ready'))return null;
      return buttons.map(button=>{const c=button.querySelector('canvas');return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data].filter((v,i)=>i%4!==3);});})()`);
    return images?.map(rgb=>createHash('sha256').update(Buffer.from(rgb)).digest('hex'));
  }
  async function matches(ui,expected) { return JSON.stringify(await glyphs(ui))===JSON.stringify(expected.buttons.map(button=>button.glyphRgbSha256)); }
  async function geometry(ui,expected) {
    const actual = await ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),buttons:[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(button=>({...rect(button),font:getComputedStyle(button).fontSize,weight:getComputedStyle(button).fontWeight}))};})()`);
    assert.deepEqual([actual.frame.width,actual.frame.height],expected.nativeFrame,expected.name+' frame');
    for(const [index,button] of actual.buttons.entries()){
      const target=expected.buttons[index];
      assert.deepEqual([button.x-actual.frame.x,button.y-actual.frame.y,button.width,button.height],[target.x,target.y,target.width,target.height],expected.name+' '+target.caption);
      assert.ok(Math.abs(parseFloat(button.font)-target.points*4/3)<.001);
      assert.equal(button.weight,target.weight==='bold'?'700':'400');
    }
    return actual;
  }
  for(const form of gallery.forms){
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),{preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'native font form');
    const view=[...explorer.formPreview.views.values()].find(view=>view.path===form.path),panel=view.frames.get('main');
    let ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    try { await until(()=>matches(ui,form.expected),'three native captions in a mixed font row'); }
    catch(error) {
      const debug=await ui.evaluate(`(() => ({buttons:[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(button=>({rect:button.getBoundingClientRect().toJSON(),style:button.getAttribute('style'),font:getComputedStyle(button).font,caption:button.querySelector('[data-native-caption]')?.dataset.nativeCaption,canvas:[button.querySelector('canvas')?.width,button.querySelector('canvas')?.height]})),status:document.querySelector('.form-status')?.textContent}))()`);
      if(process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`font-roles-failure-${vscode.env.language}.json`),JSON.stringify({name:form.kind,debug,glyphs:await glyphs(ui),expected:form.expected.buttons.map(button=>button.glyphRgbSha256)},null,2));
      await ui.screenshot(`font-roles-failure-${vscode.env.language}.png`);throw error;
    }
    results.push({name:form.kind,...await geometry(ui,form.expected)});
    await ui.screenshot(`font-roles-${form.kind}-${vscode.env.language}.png`);
    async function change(document,text,target,expected){
      const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();
      edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
      assert.equal(await vscode.workspace.applyEdit(edit),true);
      await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty font revision');
      await until(()=>matches(target,expected),'dirty native font pixels');
      await geometry(target,expected);
    }
    if(form.kind==='NormalTextFont'){
      await change(style,gallery.overrides,ui,form.expected);
      await change(style,originalStyle,ui,form.expected);
    }
    if(form.kind==='AliasTitle'){
      const small=gallery.forms.find(item=>item.kind==='AliasTitlePartial').expected;
      const changed=originalStyle.replace(/(<Item name="StyleItem\.TitleFont">[\s\S]*?height=")18(")/,(match,before,after)=>before+'10'+after);
      assert.notEqual(changed,originalStyle);
      await ui.evaluate("globalThis.__fontButton=document.querySelector('.taxi-command-bar .taxi-button')");
      await change(style,changed,ui,small);await change(style,originalStyle,ui,form.expected);
      assert.equal(await ui.evaluate("globalThis.__fontButton===document.querySelector('.taxi-command-bar .taxi-button')"),true);
      await explorer.formPreview.receive(view,panel,{type:'detach'});
      await until(()=>view.frames.get('preview')?.ready,'font preview detached');
      const detached=view.frames.get('preview'),floating=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
      await until(()=>matches(floating,form.expected),'native fonts in detached window');
      await floating.evaluate("globalThis.__fontButton=document.querySelector('.taxi-command-bar .taxi-button')");
      await change(style,changed,floating,small);await change(style,originalStyle,floating,form.expected);
      const fallback=originalStyle.replace(/<Item name="StyleItem\.TitleFont">[\s\S]*?<\/Item>/,'');
      assert.notEqual(fallback,originalStyle);
      const ten=originalDefinition.replace('height="12"','height="10"');assert.notEqual(ten,originalDefinition);
      // Both dirty inputs are delivered together; the definition supplies the fallback.
      const edit=new vscode.WorkspaceEdit();
      for(const [document,text] of [[style,fallback],[definition,ten]]) edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
      assert.equal(await vscode.workspace.applyEdit(edit),true);
      await until(()=>matches(floating,small),'dirty definition fallback pixels');
      await geometry(floating,small);
      const restore=new vscode.WorkspaceEdit();
      for(const [document,text] of [[style,originalStyle],[definition,originalDefinition]]) restore.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
      assert.equal(await vscode.workspace.applyEdit(restore),true);
      await until(()=>matches(floating,form.expected),'font inputs restored');
      await geometry(floating,form.expected);
      assert.equal(await floating.evaluate("globalThis.__fontButton===document.querySelector('.taxi-command-bar .taxi-button')"),true);
      floating.close();detached.panel.dispose();ui.close();
      // VS Code may recreate the main webview when the floating editor returns.
      ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
      await until(()=>matches(ui,form.expected),'font preview reattached');
    }
    ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'font session released');
    await Promise.all([...explorer.formPreview.closing]);
  }
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(file))),before);
  await explorer.shutdown();
  const report={passed:true,locale:vscode.env.language,predefinedFonts:true,namedTitleFont:true,partialFontOverride:true,
    mixedFontRow:true,dirtySelectedFont:true,dirtyDefinition:true,detachedFontUpdates:true,sourceWritesDuringViewing:false,wholeFormVisualParity:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`font-roles-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
