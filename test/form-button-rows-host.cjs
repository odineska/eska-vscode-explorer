const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame, sameSourcePath } = require('./webview-host.cjs');
const {matchFormRasterOrigin}=require('./form-raster-origin.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function buttons(node){return [...(node.kind==='Button'?[node]:[]),...node.children.flatMap(buttons)];}
async function replace(document,text){const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);}
const measurement="(()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{frame:rect(document.querySelector('.taxi-form-frame')),buttons:[...document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button')].map(node=>({...rect(node),caption:node.getAttribute('aria-label')}))}})()";
function compare(actual,expected,label){assert.deepEqual([actual.frame.width,actual.frame.height],expected.nativeFrame,label+' frame');assert.deepEqual(actual.buttons.map(b=>[b.x-actual.frame.x,b.y-actual.frame.y,b.width,b.height]),expected.controls.map(c=>c.buttonRect),label+' native button boxes');assert.deepEqual(actual.buttons.map(b=>b.caption),expected.controls.map(c=>c.caption),label+' captions');}
async function inspect(ui,png,payload){return ui.evaluate(`(async()=>{
  if(devicePixelRatio!==1)throw new Error('button-row-reference-dpi');
  const settings=${JSON.stringify(payload)},image=await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();const data=context.getImageData(0,0,canvas.width,canvas.height).data;
  const blue=p=>data[p*4]===30&&data[p*4+1]===144&&data[p*4+2]===255;
  let origin=settings.origin;
  if(!origin){const pixels=new Set(),frames=[];for(let p=0;p<canvas.width*canvas.height;p++)if(blue(p))pixels.add(p);while(pixels.size){const seed=pixels.values().next().value,stack=[seed];pixels.delete(seed);let left=canvas.width,top=canvas.height,right=0,bottom=0;while(stack.length){const p=stack.pop(),x=p%canvas.width,y=Math.floor(p/canvas.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);for(const adjacent of[x?p-1:-1,x+1<canvas.width?p+1:-1,y?p-canvas.width:-1,y+1<canvas.height?p+canvas.width:-1])if(pixels.delete(adjacent))stack.push(adjacent)}if(right-left+1===settings.frame[0]-2&&bottom-top+1===settings.frame[1]-2)frames.push({x:left-1,y:top-1})}if(frames.length!==1)return{waitingForFrame:true,frames};origin=frames[0]}
  const captions=[];for(const row of settings.captions??[]){const [x,y,w,h]=row.region,rgb=new Uint8Array(w*h*3);let n=0;for(let b=0;b<h;b++)for(let a=0;a<w;a++){const p=((origin.y+y+b)*canvas.width+origin.x+x+a)*4;for(let c=0;c<3;c++)rgb[n++]=data[p+c]}const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',rgb));captions.push({name:row.name,pixels:w*h,rgbSha256:[...hash].map(v=>v.toString(16).padStart(2,'0')).join('')})}
  let left=settings.frame[0],top=settings.frame[1],right=-1,bottom=-1,count=0;
  if(settings.selection)for(let y=0;y<settings.frame[1];y++)for(let x=0;x<settings.frame[0];x++)if(blue((origin.y+y)*canvas.width+origin.x+x)){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);count++}
  return{origin,captions,selection:settings.selection?{bounds:[left,top,right-left+1,bottom-top+1],bluePixels:count}:undefined}
})()`);}
exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),files=fixture.buttonRows,before=await Promise.all(files.sources.map(file=>fs.readFile(file))),results=[],mismatches=[];
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  for(const sourceForm of files.cases){
    const locale=vscode.env.language.startsWith('ru')?'ru':'en';
    const form={...sourceForm,...sourceForm.locales?.[locale]};
    const document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),original=document.getText();await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});await until(()=>vscode.window.activeTextEditor?.document===document,'button row XML active');await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
    await until(()=>[...service.views.values()].some(v=>sameSourcePath(v.path,form.path)&&v.phase==='ready'),'native button row model');const view=[...service.views.values()].find(v=>sameSourcePath(v.path,form.path)),main=view.frames.get('main');let ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});const identities=buttons(view.snapshot.model.root).map(n=>n.identity);
    const ready=async(expected)=>{await until(()=>ui.evaluate(`document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button').length===${expected.controls.length}&&[...document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button')].every(n=>n.style.width)&&!document.querySelector('[data-native-label=pending]')&&!document.querySelector('[data-native-caption=pending]')`),'native button row widths and rasters');await ui.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');};
    await ready(form);const initial=await ui.evaluate(measurement);
    try{compare(initial,form,form.name);}catch(error){mismatches.push({name:form.name,expected:form,actual:initial,message:error.message});}
    async function sample(expected,label,selections,detached=false){
      const reference=expected.frameRaster;
      if(reference)await matchFormRasterOrigin(ui,reference.paintFrameOrigin);
      await ready(expected);await ui.evaluate("document.querySelector('.taxi-form-title').click()");await until(()=>view.selected?.key.kind==='root','button row frame selected');await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const actual=await ui.evaluate(measurement);compare(actual,expected,label);
      assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);assert.deepEqual(buttons(view.snapshot.model.root).map(n=>n.identity),identities);
      const target=detached?await ui.nativeWindow({detached:true}):undefined;if(target)assert.equal(target.url,'about:blank');const capture=name=>target?ui.captureTarget(target.targetId,name,true):ui.screenshot(name,true);
      const captions=expected.linkCaptions.map(row=>({...row,region:[row.region[0]-expected.nativeOrigin[0],row.region[1]-expected.nativeOrigin[1],...row.region.slice(2)]}));
      const whole=reference&&reference.nativeRegion.slice(2).every((size,index)=>size===expected.nativeFrame[index]+5)
        ? {name:'full-form-with-shadow',region:[0,0,...reference.nativeRegion.slice(2)],rgbSha256:reference.rgbSha256} : undefined;
      const regions=whole?[...captions,whole]:captions;
      let image,captureAttempts=0;
      await until(async()=>{
        captureAttempts++;
        image=await inspect(ui,await capture('button-row-'+label+'.png'),{frame:expected.nativeFrame,captions:regions});
        return !image.waitingForFrame;
      },'native button row frame painted');
      assert.deepEqual(image.captions.map(c=>c.rgbSha256),regions.map(c=>c.rgbSha256),label+' native-position RGB regions');
      const actualCaptions=image.captions.slice(0,captions.length);
      const selected=[];for(const name of selections){const index=expected.controls.findIndex(c=>c.name===name),control=expected.controls[index];assert.ok(index>=0);await ui.evaluate(`document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button')[${index}].click()`);await until(()=>JSON.stringify(view.selected)===JSON.stringify(identities[index]),'native button selection identity');await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const painted=await inspect(ui,await capture('button-row-'+label+'-'+name+'.png'),{frame:expected.nativeFrame,origin:image.origin,selection:true});assert.deepEqual(painted.selection.bounds,control.selectionBlueBounds,label+' '+name+' selection bounds');assert.equal(painted.selection.bluePixels,control.selectionBluePixels,label+' '+name+' complete blue outline');selected.push({name,...painted.selection});}
      return{label,frame:actual.frame,buttons:actual.buttons,captionPixelsCompared:actualCaptions.reduce((sum,c)=>sum+c.pixels,0),differentCaptionRgbPixels:0,captionRegions:actualCaptions,selectionGeometry:selected,captureAttempts,wholeWidgetAccepted:!!whole,wholeFrame:whole?image.captions.at(-1):undefined};
    }
    if(!mismatches.some(m=>m.name===form.name)){
      results.push(await sample(form,form.name,form.controls.map(c=>c.name)));
      if(form.name==='ProbeRows'){
        const width8=copy(form);width8.nativeFrame=[196,249];const last=width8.controls.find(c=>c.name==='FixedUsual2');last.buttonRect[2]=80;last.selectionBlueBounds[2]=86;last.selectionBluePixels=460;
        const change=async text=>{await replace(document,text);await until(()=>view.phase==='ready'&&!view.running&&!view.timer&&view.snapshot.dependencies.some(d=>d.role==='form'&&d.version===String(document.version)),'dirty native row revision');};
        const stable=()=>ui.evaluate("globalThis.__rowButtons.every((b,i)=>b===document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button')[i])");await ui.evaluate("globalThis.__rowButtons=[...document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button')]");
        assert.equal((original.match(/<Width>10<\/Width>/g)||[]).length,1);const text8=original.replace('<Width>10</Width>','<Width>8</Width>');await change(text8);results.push(await sample(width8,'dirty-explicit-width',['FixedUsual2']));assert.equal(await stable(),true);await change(original);results.push(await sample(form,'restored-explicit-width',['FixedUsual2']));assert.equal(await stable(),true);
        await ui.focusWorkbench();ui.close();await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'native button rows detached');const floating=view.frames.get('preview');ui=await frame({detached:true,fixedFormArea:true,state:{title:floating.panel.title}});await ui.evaluate("globalThis.__rowButtons=[...document.querySelectorAll('.taxi-element[data-kind=Button]>.taxi-button')]");results.push(await sample(form,'floating-native',['Forward2','Bar2','FixedUsual2'],true));await change(text8);results.push(await sample(width8,'floating-dirty-width',['FixedUsual2'],true));assert.equal(await stable(),true);await change(original);results.push(await sample(form,'floating-restored',[],true));
        ui.close();floating.panel.dispose();await until(()=>!view.frames.has('preview'),'native button rows reattached');ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});results.push(await sample(form,'reattached-native',['FixedUsual2']));assert.equal(document.isDirty,true);
      }
    }
    await ui.focusWorkbench();ui.close();main.panel.dispose();await until(()=>service.views.size===0,'button row session closed');await Promise.all([...service.closing]);
  }
  assert.deepEqual(await Promise.all(files.sources.map(file=>fs.readFile(file))),before);await explorer.shutdown();
  if(mismatches.length){await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR??fixture.root,'button-rows-failures-'+vscode.env.language+'.json'),JSON.stringify(mismatches,null,2));assert.deepEqual(mismatches.map(({name,actual})=>({name,actual})),[],'native button row geometry');}
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,forms:2,nativeButtons:21,results,dirtyWidth:true,stableIdentity:true,stableDom:true,detachedUpdates:true,sourceWritesDuringViewing:false,wholeWidgetAccepted:false,fullProfileAccepted:false}));
};
