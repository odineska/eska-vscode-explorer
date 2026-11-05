const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

const measure=`(() => {
  const rect=node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
  return {frame:rect(document.querySelector('.taxi-form-frame')),tabs:[...document.querySelectorAll('.taxi-tabs > button')].map(node=>{
    const c=node.querySelector('canvas'),s=getComputedStyle(node);
    return {rect:rect(node),font:s.fontSize,weight:s.fontWeight,color:s.color,canvas:rect(c),width:c.width,height:c.height,
      rgba:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)};})};})()`;
function compare(actual,expected) {
  assert.deepEqual(actual.frame.slice(2),expected.frame,expected.name+' form');
  for(const [i,tab]of actual.tabs.entries()) {
    const reference=expected.captions[i],relative=rect=>[rect[0]-actual.frame[0],rect[1]-actual.frame[1],...rect.slice(2)];
    assert.deepEqual(relative(tab.rect),reference.tab,expected.name+' tab');
    assert.deepEqual(relative(tab.canvas),reference.region,expected.name+' caption position');
    const rgb=Buffer.alloc(tab.width*tab.height*3);
    for(let p=0;p<tab.width*tab.height;p++)for(let c=0;c<3;c++)rgb[p*3+c]=tab.rgba[p*4+c];
    assert.equal(crypto.createHash('sha256').update(rgb).digest('hex'),reference.rgbSha256,expected.name+' caption pixels');
  }
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),results=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  for(const form of fixture.formGallery) {
    const before=await fs.readFile(form.path),document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'tab form ready');
    const view=[...explorer.formPreview.views.values()].find(view=>view.path===form.path),panel=view.frames.get('main');
    const ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    const ready=()=>ui.evaluate("document.querySelectorAll('.taxi-tabs [data-native-label=ready]').length===2&&[...document.querySelectorAll('.taxi-tabs > button')].every(button=>button.style.width)&&!document.querySelector('[data-native-label=pending]')");
    if(process.platform==='linux')await until(ready,'packaged native tab captions');
    else await until(()=>ui.evaluate("document.querySelectorAll('.taxi-tabs > button').length===2"),'tab DOM');
    const actual=await ui.evaluate(measure);
    if(process.platform==='linux')compare(actual,form.expected);
    await ui.screenshot(`tab-title-${form.kind}-${vscode.env.language}.png`);
    results.push({name:form.kind,frame:actual.frame,tabs:actual.tabs.map(({rgba,...tab})=>tab)});
    if(form.kind==='PagesFont16'&&process.platform==='linux') {
      await ui.evaluate("globalThis.__nativeTab=document.querySelector('.taxi-tabs > button')");
      const original=document.getText();
      for(const points of [12,16]) {
        const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();
        edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),original.replaceAll('height="16"',`height="${points}"`));
        assert.equal(await vscode.workspace.applyEdit(edit),true);
        await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty title font revision');
        await until(ready,'dirty title raster');
        const expected=fixture.formGallery.find(item=>item.kind===`PagesFont${points}`).expected;
        await until(async()=>{try{compare(await ui.evaluate(measure),expected);return true;}catch{return false;}},'dirty title matches native alternate size');
        assert.equal(await ui.evaluate("globalThis.__nativeTab===document.querySelector('.taxi-tabs > button')"),true);
      }
    }
    assert.deepEqual(await fs.readFile(form.path),before);
    ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'tab view released');
    await Promise.all([...explorer.formPreview.closing]);
  }
  const report={passed:true,locale:vscode.env.language,linuxPixelsVerified:process.platform==='linux',dirtyTitleFont:true,sourceWritesDuringViewing:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`tab-title-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
