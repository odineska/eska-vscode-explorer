const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');
const measurement=`(() => {
 const rect=node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]},title=document.querySelector('.taxi-form-title'),canvas=title.querySelector('canvas'),s=getComputedStyle(title);
 return {frame:rect(document.querySelector('.taxi-form-frame')),title:rect(title),canvas:rect(canvas),caption:title.getAttribute('aria-label'),background:s.backgroundColor,
 width:canvas.width,height:canvas.height,rgba:Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)};})()`;
function compare(actual,expected){
 assert.deepEqual(actual.frame.slice(2),expected.frame,expected.name+' frame');
 assert.deepEqual([actual.title[0]-actual.frame[0],actual.title[1]-actual.frame[1],...actual.title.slice(2)],expected.titleBounds);
 assert.equal(actual.caption,expected.caption);
 const [rx,ry,w,h]=expected.region,image=Buffer.alloc(w*h*3);for(let i=0;i<w*h;i++)image.set(expected.background,i*3);
 for(let y=0;y<actual.height;y++)for(let x=0;x<actual.width;x++){
  const tx=actual.canvas[0]-actual.frame[0]+x-rx,ty=actual.canvas[1]-actual.frame[1]+y-ry;
  assert.equal(Number.isInteger(tx)&&Number.isInteger(ty),true,'native title pixels are aligned');
  if(tx<0||tx>=w||ty<0||ty>=h)continue;
  for(let c=0;c<3;c++)image[(ty*w+tx)*3+c]=actual.rgba[(y*actual.width+x)*4+c];
 }
 assert.equal(crypto.createHash('sha256').update(image).digest('hex'),expected.rgbSha256,expected.name+' pixels');
}
exports.run=async()=>{
 const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),results=[];
 const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
 await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 for(const form of fixture.formGallery){
  const before=await fs.readFile(form.path),document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'window title ready');
  const view=[...explorer.formPreview.views.values()].find(view=>view.path===form.path),panel=view.frames.get('main'),ui=await frame({state:{title:panel.panel.title}});
  const ready=()=>ui.evaluate("!!document.querySelector('.taxi-form-title [data-native-label=ready]')&&!document.querySelector('[data-native-label=pending]')");
  if(process.platform==='linux')await until(ready,'native title raster ready');
  else await until(()=>ui.evaluate("!!document.querySelector('.taxi-form-title')"),'title DOM ready');
  if(process.platform==='linux'){
   const actual=await ui.evaluate(measurement);compare(actual,form.expected);results.push({name:form.kind,frame:actual.frame,title:actual.title,canvas:actual.canvas});
  }
  await ui.screenshot(`window-title-${form.kind}-${vscode.env.language}.png`);
  if(form.kind==='ASCII'&&process.platform==='linux'){
   await ui.evaluate("globalThis.__windowTitle=document.querySelector('.taxi-form-title')");
   const original=document.getText();
   for(const kind of ['Cyrillic','ASCII']){
    const expected=fixture.formGallery.find(item=>item.kind===kind).expected,revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();
    edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),original.replaceAll(form.expected.caption,expected.caption));
    assert.equal(await vscode.workspace.applyEdit(edit),true);
    await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty title model');await until(ready,'dirty title raster');
    await until(async()=>{try{compare(await ui.evaluate(measurement),expected);return true;}catch{return false;}},'dirty title matches native alternate');
    assert.equal(await ui.evaluate("globalThis.__windowTitle===document.querySelector('.taxi-form-title')"),true);
   }
  }
  assert.deepEqual(await fs.readFile(form.path),before);ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'title view released');await Promise.all([...explorer.formPreview.closing]);
 }
 const report={passed:true,locale:vscode.env.language,linuxPixelsVerified:process.platform==='linux',dirtyWindowTitle:true,sourceWritesDuringViewing:false,results};
 if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`window-title-measured-${vscode.env.language}.json`),JSON.stringify(report));
 await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
