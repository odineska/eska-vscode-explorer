const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');
// The search rectangle can be visible even when the bottom of the form is clipped.
// Find its straight edges and internal separator in the native workbench screenshot.
async function readSearchField(ui, label, detached) {
  const selector = '.taxi-table-search[data-native-search-field=ready]:has(> [data-native-label=ready])';
  await until(() => ui.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), 'table search raster ready');
  await ui.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const geometry = await ui.evaluate(`(()=>{
    const field=document.querySelector(${JSON.stringify(selector)}), r=field.getBoundingClientRect(), css=getComputedStyle(field);
    return {width:r.width,height:r.height,border:css.borderTopColor.match(/\\d+/g).map(Number),font:css.fontSize};
  })()`);
  const target = detached ? await ui.nativeWindow({detached:true}) : undefined;
  await ui.parkPointer(target?.targetId);
  const filename = `table-search-${label}.png`;
  const png = target ? await ui.captureTarget(target.targetId, filename, true) : await ui.screenshot(filename, true);
  return ui.evaluate(`(async()=>{
    if(devicePixelRatio!==1)throw new Error('table-search-reference-dpi');
    const geometry=${JSON.stringify(geometry)}, {width,height,border}=geometry;
    if(!Number.isInteger(width)||height!==23)throw new Error('table-search-geometry '+JSON.stringify(geometry));
    const blob=new Blob([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],{type:'image/png'});
    const image=await createImageBitmap(blob), canvas=new OffscreenCanvas(image.width,image.height);
    const context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
    const data=context.getImageData(0,0,canvas.width,canvas.height).data, regions=[];
    const stroke=(x,y)=>{
      const p=(y*canvas.width+x)*4;
      return data[p]===border[0]&&data[p+1]===border[1]&&data[p+2]===border[2];
    };
    for(let y=0;y<=canvas.height-height;y++)for(let x=1;x<=canvas.width-width;x++){
      if(stroke(x+2,y)||!stroke(x+3,y)||!stroke(x+width-4,y)||stroke(x+width-3,y))continue;
      let edges=true;
      for(let i=3;i<width-3;i++)if(!stroke(x+i,y)||!stroke(x+i,y+height-1)){edges=false;break;}
      if(!edges)continue;
      for(let i=3;i<height-3;i++)if(!stroke(x,y+i)||!stroke(x+width-1,y+i)||!stroke(x+width-22,y+i)){edges=false;break;}
      if(edges)regions.push([x,y,width,height]);
    }
    if(regions.length!==1)throw new Error('table-search-crop '+JSON.stringify({geometry,regions}));
    const [x,y]=regions[0], rgb=new Uint8Array(width*height*3);let index=0;
    for(let i=0;i<height;i++)for(let j=0;j<width;j++){
      const p=((y+i)*canvas.width+x+j)*4;for(let c=0;c<3;c++)rgb[index++]=data[p+c];
    }
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',rgb));
    return {region:regions[0],pixels:width*height,rgbSha256:[...hash].map(v=>v.toString(16).padStart(2,'0')).join(''),...geometry};
  })()`);
}
async function replace(document,text){const edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);}
exports.run=async()=>{
 const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),forms=fixture.formGallery,before=await Promise.all(forms.map(f=>fs.readFile(f.path))),results=[],failures=[];
 const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();await vscode.commands.executeCommand('workbench.action.toggleFullScreen');await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 const locale=vscode.env.language.startsWith('ru')?'ru':'en',reference=form=>form.expectedTablePixels[locale];
 const wideSearchForm=forms.find(form=>form.kind==='MetadataTable');
 const wideSearch=wideSearchForm&&reference(wideSearchForm).searchReflow;
 for(const form of forms){
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),original=document.getText();await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});await until(()=>vscode.window.activeTextEditor?.document===document,'table pixel XML active');await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>[...service.views.values()].some(v=>v.path===form.path&&v.phase==='ready'),'table pixel model');const view=[...service.views.values()].find(v=>v.path===form.path),main=view.frames.get('main');
  const mainTab={state:{title:main.panel.title}},hasReflowReference=!!reference(form).searchReflow;
  // The live workbench opens in its wide allocation. Compare it with the measured 260px widget.
  const reflow=hasReflowReference?wideSearch:undefined;
  if(hasReflowReference)assert.equal(reflow?.initial.nativeRegion[2],260);
  let ui=await frame(mainTab);
  async function sampleSearch(label, expected, detached=false) {
    const measured=await readSearchField(ui, label+'-'+locale, detached);
    const geometryMatches=measured.width===expected.nativeRegion[2]&&measured.height===expected.nativeRegion[3];
    const passed=geometryMatches&&measured.rgbSha256===expected.rgbSha256;
    const result={label,passed,geometryMatches,...measured,expectedRgbSha256:expected.rgbSha256,
      expectedFontPixels:expected.fontPixels,referenceForm:wideSearchForm.kind,searchReflow:true,detached};
    results.push(result);if(!passed)failures.push(result);
    return result;
  }
  if(reflow){
    await sampleSearch(form.kind+'-search-first',reflow.initial);
    if(form.kind==='Default'){
      const initialHeight=await ui.evaluate(`(()=>{
        const input=document.querySelector('.taxi-table-search input');globalThis.__searchControl=input.parentElement;input.click();
        return document.querySelector('.preview-scroll').offsetHeight;
      })()`);
      await until(()=>view.selected?.key.value==='8','initial search remains selectable');
      await sampleSearch('Default-search-selected',reflow.initial);
      const move=key=>ui.evaluate(`document.querySelector('.form-splitter[aria-orientation=horizontal]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
      const extent=()=>ui.evaluate("document.querySelector('.preview-scroll').offsetHeight");
      await move('ArrowUp');
      await until(async()=>await extent()>initialHeight,'preview viewport grew after splitter key');
      await until(()=>ui.evaluate("!globalThis.__searchControl.classList.contains('taxi-table-search--compact')"),'table search repainted after viewport resize');
      await sampleSearch('Default-search-resized',reflow.settled);
      await move('ArrowDown');
      await until(async()=>await extent()===initialHeight,'initial preview viewport restored');
      const restored=await sampleSearch('Default-search-restored',reflow.settled);
      assert.equal(await ui.evaluate("globalThis.__searchControl===document.querySelector('.taxi-table-search')"),true);
      assert.equal(view.selected?.key.value,'8');restored.sameControl=true;
    }
  }
  mainTab.fixedFormArea=true;
  async function sample(expected,label,detached=false){
   await until(()=>ui.evaluate("!!document.querySelector('.taxi-table-scroll')&&!document.querySelector('[data-native-label=pending]')&&!document.querySelector('[data-native-caption=pending]')"),'table pixel rasters');const restore=view.selected?.key.value==='1';await ui.evaluate("document.querySelector('.taxi-form-title').click()");await until(()=>view.selected?.key.kind==='root','table pixel root selected');await ui.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
   const actual=await ui.evaluate(`(()=>{
    const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
    const control=rect(document.querySelector('.taxi-table-scroll'));
    const relative=selector=>{
      const node=document.querySelector(selector);
      if(!node)return null;
      const r=rect(node);return [r.x-control.x,r.y-control.y,r.width,r.height];
    };
    return {frame:rect(document.querySelector('.taxi-form-frame')),control,
      tableBands:{header:relative('.taxi-table-head'),footer:relative('.taxi-table-footer')},
      headers:[...document.querySelectorAll('.taxi-table-header-cell')].map(n=>({text:n.textContent,height:n.getBoundingClientRect().height,color:getComputedStyle(n).color,font:getComputedStyle(n).fontSize,status:n.querySelector('[data-native-label]')?.dataset.nativeLabel}))};
   })()`);
   const geometryMatches=actual.control.width===expected.nativeRegion[2]&&actual.control.height===expected.nativeRegion[3]-(expected.extraBottom??0)
     && (!expected.tableBands || Object.keys(expected.tableBands).every(band=>actual.tableBands[band]?.every((value,index)=>value===expected.tableBands[band][index])));
   assert.deepEqual(view.snapshot.model.diagnostics.appearance,[]);assert.deepEqual(view.snapshot.model.diagnostics.composition,[]);
   const target=detached?await ui.nativeWindow({detached:true}):undefined;if(target)assert.equal(target.url,'about:blank');await ui.parkPointer(target?.targetId);let pixels,captureAttempts=0;const filename='table-pixels-'+label+'-'+locale+'.png';
   await until(async()=>{captureAttempts++;const png=target?await ui.captureTarget(target.targetId,filename,true):await ui.screenshot(filename,true);pixels=await ui.evaluate(`(async()=>{
    if(devicePixelRatio!==1)throw new Error('table-pixel-reference-dpi');const image=await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();const data=context.getImageData(0,0,canvas.width,canvas.height).data,blue=new Set(),frames=[];
    for(let p=0;p<canvas.width*canvas.height;p++)if(data[p*4]===30&&data[p*4+1]===144&&data[p*4+2]===255)blue.add(p);
    while(blue.size){const seed=blue.values().next().value,stack=[seed];blue.delete(seed);let left=canvas.width,top=canvas.height,right=0,bottom=0;while(stack.length){const p=stack.pop(),x=p%canvas.width,y=Math.floor(p/canvas.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);for(const next of[x?p-1:-1,x+1<canvas.width?p+1:-1,y?p-canvas.width:-1,y+1<canvas.height?p+canvas.width:-1])if(blue.delete(next))stack.push(next)}if(right-left+1===${actual.frame.width}-2&&bottom-top+1===${actual.frame.height}-2)frames.push({x:left-1,y:top-1})}
    if(frames.length!==1)return{waitingForFrame:true,frames};const origin=frames[0],region=[origin.x+${actual.control.x-actual.frame.x},origin.y+${actual.control.y-actual.frame.y},${actual.control.width},${actual.control.height+(expected.extraBottom??0)}];if(region.some(v=>!Number.isInteger(v)))throw new Error('table-pixel-grid-not-aligned '+JSON.stringify(region));async function capture(region){const[x,y,w,h]=region,rgb=new Uint8Array(w*h*3);if(x<0||y<0||x+w>canvas.width||y+h>canvas.height)throw new Error('table-region-outside-capture');let n=0;for(let b=0;b<h;b++)for(let a=0;a<w;a++){const p=((y+b)*canvas.width+x+a)*4;for(let c=0;c<3;c++)rgb[n++]=data[p+c]}const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',rgb));return{region,rgbSha256:[...hash].map(v=>v.toString(16).padStart(2,'0')).join(''),pixels:w*h}}const additionalRegions=[];for(const expected of ${JSON.stringify(expected.additionalRegions??[])}){const region=[origin.x+${actual.control.x-actual.frame.x}+expected.offset[0],origin.y+${actual.control.y-actual.frame.y}+expected.offset[1],expected.width,expected.height],measured=await capture(region);additionalRegions.push({name:expected.name,...measured,expectedRgbSha256:expected.rgbSha256,passed:measured.rgbSha256===expected.rgbSha256})}return{origin,...await capture(region),additionalRegions}
   })()`);return !pixels.waitingForFrame},'complete table grid captured');
   const pixelMatches=pixels.rgbSha256===expected.rgbSha256&&pixels.additionalRegions.every(region=>region.passed);
   const comparison=expected.comparison??'pixels';
   const passed=geometryMatches&&(comparison==='geometry'||pixelMatches),result={label,passed,geometryMatches,pixelMatches,comparison,detached,...actual,...pixels,expectedRgbSha256:expected.rgbSha256,captureAttempts,wholeGridControlCompared:true,extraBottom:expected.extraBottom??0};results.push(result);if(!passed)failures.push(result);
   if(restore){await ui.evaluate("document.querySelector('.taxi-table-empty').click()");await until(()=>view.selected?.key.value==='1','table identity restored after capture');}return passed;
  }
  const passed=await sample(reference(form),form.kind);
  const baseline=reference(form),movedToolbar=baseline.movedToolbar;
  const completeToolbar = toolbar => ({...baseline,additionalRegions:[...baseline.additionalRegions,toolbar]});
  const toolbarPoses = [
   ['native-toolbar-pose',baseline.wholeToolbar],
   ['moved-toolbar-pose',movedToolbar],
  ];
  for(const [label,toolbar] of toolbarPoses){
   if(!passed||!toolbar)continue;
   if(form.kind==='DynamicList'){
    const captured=results.at(-1).additionalRegions.find(region=>region.name==='toolbar');
    assert.equal(captured.rgbSha256,toolbar.rgbSha256,'complete DynamicList toolbar remains exact');
    results.at(-1).wholeToolbarPixelParity=true;
   }else{
    const beforePose=await ui.evaluate(`(()=>{
     const bar=document.querySelector('.taxi-table-command-bar'),viewport=bar.closest('.preview-scroll');
     const inspectors=document.querySelector('.form-inspectors'),button=bar.querySelector(':scope > .taxi-button');
     const rect=bar.getBoundingClientRect(), [targetX,targetY]=${JSON.stringify(toolbar.nativeRegion)};
     globalThis.__tableToolbarPose={bar,button,inspectors,viewport,height:inspectors.style.height,margin:viewport.style.marginLeft};
     inspectors.style.height=(inspectors.getBoundingClientRect().height+targetY-rect.y)+'px';
     viewport.style.marginLeft=(targetX-rect.x)+'px';
     return {position:[rect.x,rect.y],bottom:getComputedStyle(button).borderBottomColor};
    })()`);
    try{
     const [x,y]=toolbar.nativeRegion,expectedBorder=`rgb(${(toolbar.lowerEdgeRgb??[156,156,156]).join(', ')})`;
     await until(()=>ui.evaluate(`(()=>{
      const {bar,button}=globalThis.__tableToolbarPose,r=bar.getBoundingClientRect();
      return bar===document.querySelector('.taxi-table-command-bar')&&r.x===${x}&&r.y===${y}
       &&getComputedStyle(button).borderBottomColor===${JSON.stringify(expectedBorder)};
     })()`),'whole toolbar uses the measured raster pose');
     await sample({...reference(form),additionalRegions:[toolbar]},form.kind+'-'+label);
     const result=results.at(-1);
     result.nativeToolbarPose=[x,y];
     result.wholeToolbarPixelParity=result.additionalRegions[0].passed;
     result.lowerEdgeRgb=toolbar.lowerEdgeRgb??[156,156,156];
     result.beforeToolbarPose=beforePose;
    }finally{
     await ui.evaluate(`(()=>{
      const {inspectors,viewport,height,margin}=globalThis.__tableToolbarPose;
      inspectors.style.height=height;
      viewport.style.marginLeft=margin;
     })()`);
    }
    await until(()=>ui.evaluate(`(()=>{
     const {bar,button}=globalThis.__tableToolbarPose,r=bar.getBoundingClientRect();
     return button===bar.querySelector(':scope > .taxi-button')&&r.x===${beforePose.position[0]}&&r.y===${beforePose.position[1]}
      &&getComputedStyle(button).borderBottomColor===${JSON.stringify(beforePose.bottom)};
    })()`),'toolbar position and border restored on the same node');
    results.at(-1).toolbarPositionRestored=true;
   }
  }
  if(passed&&form.kind==='Default'){
   await until(()=>ui.evaluate("document.querySelector('[data-native-table-movement]')?.dataset.nativeTableMovement==='ready'"),'native movement ready');await ui.evaluate("(()=>{globalThis.__movementCanvas=document.querySelector('[data-native-table-movement]');const select=document.querySelector('.form-zoom select');select.value='200';select.dispatchEvent(new Event('change',{bubbles:true}))})()");await until(()=>ui.evaluate("document.querySelector('[data-native-table-movement]')?.dataset.nativeTableMovement==='browser'"),'unmeasured movement zoom uses fallback');assert.match(await ui.evaluate("document.querySelector('.form-status').textContent"),locale==='ru'?/Часть элементов формы/:/Some form elements/);await ui.evaluate("(()=>{const select=document.querySelector('.form-zoom select');select.value='100';select.dispatchEvent(new Event('change',{bubbles:true}))})()");await until(()=>ui.evaluate("document.querySelector('[data-native-table-movement]')?.dataset.nativeTableMovement==='ready'"),'movement profile restored');assert.equal(await ui.evaluate("globalThis.__movementCanvas===document.querySelector('[data-native-table-movement]')"),true);results.at(-1).movementZoomFallbackVerified=true;
   const hit=await ui.evaluate("(()=>{const n=document.querySelector('.taxi-table-search input'),r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+10,r.y+r.height/2);return n===hit})()");assert.equal(hit,true,'LCD placeholder leaves the input hit-testable');
   await ui.evaluate("document.querySelector('.taxi-table-search input').click()");await until(()=>view.selected?.key.value==='8','search control selects its source identity');assert.equal(await ui.evaluate("document.querySelector('.taxi-table-search input').value"),'');results.at(-1).searchPlaceholderHitTestable=true;
  }
  if(passed&&['Default','DynamicList','BandsDirect'].includes(form.kind)){
   const dynamic=form.kind==='DynamicList',bands=form.kind==='BandsDirect';
   const label=value=>dynamic?'dynamic-'+value:bands?'styled-'+value:value;
   const other=forms.find(f=>f.kind===(dynamic?'MetadataTable':bands?'BandsLarge':'GridFooter')),grid=await fs.readFile(other.path,'utf8');await ui.evaluate("document.querySelector('.taxi-table-empty').click();globalThis.__tableGrid=document.querySelector('.taxi-table-scroll')");await until(()=>view.selected?.key.value==='1','table selected before dirty XML');const identity=view.selected;
   const change=async text=>{await replace(document,text);await until(()=>view.phase==='ready'&&!view.running&&!view.timer&&view.snapshot.dependencies.some(d=>d.role==='form'&&d.version===String(document.version)),'dirty table revision');assert.deepEqual(view.selected,identity);assert.equal(await ui.evaluate("globalThis.__tableGrid===document.querySelector('.taxi-table-scroll')"),true);};
   await change(grid);
   await sample(reference(other),label('dirty-footer'));
   await change(original);
   await sample(reference(form),label('restored-default'));
   await ui.focusWorkbench();
   ui.close();
   await service.receive(view,main,{type:'detach'});
   await until(()=>view.frames.get('preview')?.ready,'table pixel view detached');
   const floating=view.frames.get('preview');
   const floatingTab={detached:true,state:{title:floating.panel.title}};
   ui=await frame(floatingTab);
   if(!dynamic&&reflow)await sampleSearch('floating-search-first',reflow.initial,true);
   floatingTab.fixedFormArea=true;
   await until(()=>ui.evaluate("!!document.querySelector('.taxi-table-scroll')"),'floating table DOM');
   await ui.evaluate("globalThis.__tableGrid=document.querySelector('.taxi-table-scroll')");
   await sample(movedToolbar?completeToolbar(movedToolbar):reference(form),label('floating-default'),true);
   if(movedToolbar){
    const result=results.at(-1);
    result.wholeToolbarPixelParity=result.additionalRegions.find(region=>region.name==='toolbar').passed;
    result.detachedToolbar=true;
   }
   await change(grid);
   await sample(reference(other),label('floating-dirty-footer'),true);
   await change(original);
   await sample(reference(form),label('floating-restored'),true);
   ui.close();
   floating.panel.dispose();
   await until(()=>!view.frames.has('preview'),'table pixel view reattached');
   ui=await frame({fixedFormArea:true,state:{title:main.panel.title}});
   await sample(reference(form),label('reattached-default'));
   assert.equal(document.isDirty,true);
  }
  if(passed&&form.kind==='InCell'){
   assert.equal(await ui.evaluate("[...document.querySelectorAll('.taxi-table-header-cell span[data-column]')].length"),2);for(const [index,id]of [[0,'3'],[1,'4']]){const hit=await ui.evaluate(`(()=>{const n=document.querySelectorAll('.taxi-table-header-cell span[data-column]')[${index}],r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n===hit||n.contains(hit)})()`);assert.equal(hit,true,'native caption leaves each logical column hit-testable');await ui.evaluate(`document.querySelectorAll('.taxi-table-header-cell span[data-column]')[${index}].click()`);await until(()=>view.selected?.key.value===id,'composite header selects its logical column');}results.at(-1).logicalColumnsSelectable=true;
  }
  await ui.focusWorkbench();ui.close();main.panel.dispose();await until(()=>service.views.size===0,'table pixel session closed');await Promise.all([...service.closing]);
 }
 assert.deepEqual(await Promise.all(forms.map(f=>fs.readFile(f.path))),before);await explorer.shutdown();if(failures.length){await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR??fixture.root,'table-pixel-failures-'+locale+'.json'),JSON.stringify(failures,null,2));assert.deepEqual(failures.map(({label,geometryMatches,rgbSha256,expectedRgbSha256})=>({label,geometryMatches,rgbSha256,expectedRgbSha256})),[],'complete native table grid pixels');}
 await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,forms:forms.length,results,dirtyFooter:true,stableTableDom:true,selectedIdentityPreserved:true,logicalColumnSelection:true,detachedUpdates:true,sourceWritesDuringViewing:false,wholeGridControlPixelParity:results.filter(result=>result.wholeGridControlCompared).every(result=>result.pixelMatches),wholeFormVisualParity:false}));
};
