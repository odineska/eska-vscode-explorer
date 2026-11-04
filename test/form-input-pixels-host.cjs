const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');

exports.runGallery=async(options)=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),gallery=fixture[options.fixtureKey],results=[],failures=[];
  const explorer=await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  async function ready(ui,expected){return ui.evaluate(`(() => {const inputs=[...document.querySelectorAll('.taxi-input')].filter(input=>getComputedStyle(input).visibility!=='hidden');return inputs.length===${expected.fields.length}&&inputs.every(input=>input.dataset.nativeBorder==='ready')&&${JSON.stringify(expected.fields.map(f=>f.type.kind))}.every((kind,index)=>kind!=='number'||inputs[index].querySelector('[data-native-value]')?.dataset.nativeValue==='ready');})()`);}
  async function appearance(ui,expected){return ui.evaluate(`(() => {const inputs=[...document.querySelectorAll('.taxi-input')].filter(input=>getComputedStyle(input).visibility!=='hidden');return inputs.length===${expected.fields.length}&&${JSON.stringify(expected.fields)}.every((field,index)=>{const css=getComputedStyle(inputs[index]);return css.borderTopColor==='rgb('+field.actualBorder.join(', ')+')'&&css.backgroundColor==='rgb('+field.actualBackground.join(', ')+')'&&inputs[index].dataset.nativeBackdrop===field.outside.join(',');});})()`);}
  async function sample(ui,expected,label,targetId){
    await until(async()=>await ready(ui,expected)&&await appearance(ui,expected),'native input paint ready');
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await until(()=>ui.evaluate("!document.querySelector('[data-native-label=pending]')"),'input labels settled');
    await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const geometry=await ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return {frame:rect(document.querySelector('.taxi-form-frame')),inputs:[...document.querySelectorAll('.taxi-input')].filter(input=>getComputedStyle(input).visibility!=='hidden').map(input=>({...rect(input),outset:Number(input.dataset.nativeOutset),buttons:input.querySelectorAll('.taxi-input-button').length}))};})()`);
    const regions=[],geometryIssues=[];
    if(options.verifyFrame&&(geometry.frame.width!==expected.frame[0]||geometry.frame.height!==expected.frame[1]))geometryIssues.push({frame:geometry.frame,expected:expected.frame});
    for(const [index,input] of geometry.inputs.entries()){
      const field=expected.fields[index],x=input.x-geometry.frame.x,y=input.y-geometry.frame.y,w=input.width+input.outset,h=input.height;
      if(JSON.stringify([x,y,w,h])!==JSON.stringify(field.rect)||input.buttons!==Number(field.choice))geometryIssues.push({name:field.name,actual:[x,y,w,h],expected:field.rect,buttons:input.buttons,expectedButtons:Number(field.choice)});
      for(const [corner,cx,cy] of [['topLeft',x,y],['topRight',x+w-3,y],['bottomLeft',x,y+h-3],['bottomRight',x+w-3,y+h-3]])regions.push({name:field.name+' '+corner,x:cx,y:cy,width:3,height:3,hex:field.cornersRgb[corner]});
      if(field.type.kind!=='date')regions.push({name:field.name+' whole',x,y,width:w,height:h,sha:field.wholeInputRgbSha256});
      if(field.button?.kind==='calculator'){const [bx,by,bw,bh]=field.button.rect;regions.push({name:field.name+' calculator',x:bx+x-field.rect[0],y:by+y-field.rect[1],width:bw,height:bh,sha:field.button.rgbSha256});}
    }
    if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`${options.prefix}-geometry-${label}-${vscode.env.language}.json`),JSON.stringify(geometry));
    const filename=`${options.prefix}-${label}-${vscode.env.language}.png`,png=targetId?await ui.captureTarget(targetId,filename,true):await ui.screenshot(filename,true);
    const pixels=await ui.evaluate(`(async()=>{
      if(devicePixelRatio!==1)throw new Error('input-reference-dpi');
      const image=await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png)}),value=>value.charCodeAt(0))],{type:'image/png'}));
      const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
      const data=context.getImageData(0,0,canvas.width,canvas.height).data,blue=new Set(),frames=[];
      for(let pixel=0;pixel<canvas.width*canvas.height;pixel++)if(data[pixel*4]===30&&data[pixel*4+1]===144&&data[pixel*4+2]===255)blue.add(pixel);
      while(blue.size){const seed=blue.values().next().value,stack=[seed];blue.delete(seed);let left=canvas.width,top=canvas.height,right=0,bottom=0;
        while(stack.length){const pixel=stack.pop(),x=pixel%canvas.width,y=Math.floor(pixel/canvas.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
          for(const next of [x?pixel-1:-1,x+1<canvas.width?pixel+1:-1,y?pixel-canvas.width:-1,y+1<canvas.height?pixel+canvas.width:-1])if(blue.delete(next))stack.push(next);}
        if(right-left+1===${geometry.frame.width}-2&&bottom-top+1===${geometry.frame.height}-2)frames.push({x:left-1,y:top-1});}
      if(frames.length!==1)throw new Error('input-reference-selection '+JSON.stringify({frames,expected:${JSON.stringify(geometry.frame)}}));const origin=frames[0],regions=${JSON.stringify(regions)},results=[];
      const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
      for(const r of regions){const rgb=new Uint8Array(r.width*r.height*3);let offset=0;
        for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const index=((origin.y+r.y+y)*canvas.width+origin.x+r.x+x)*4;rgb.set(data.slice(index,index+3),offset);offset+=3;}
        results.push({name:r.name,hex:r.hex?hex(rgb):undefined,sha:r.sha?hex(new Uint8Array(await crypto.subtle.digest('SHA-256',rgb))):undefined,pixels:r.width*r.height});}
      return {origin,results};
    })()`);
    const mismatches=[];
    for(const [index,actual] of pixels.results.entries()){const target=regions[index];if(target.hex?actual.hex!==target.hex:actual.sha!==target.sha)mismatches.push({actual,target});}
    if(mismatches.length||geometryIssues.length){failures.push({label,mismatches,geometryIssues});if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`${options.prefix}-failure-${vscode.env.language}.json`),JSON.stringify(failures,null,2));}
    return {name:label,geometry,cornerPixelsCompared:regions.filter(r=>r.hex).reduce((v,r)=>v+r.width*r.height,0),wholeWidgetPixelsCompared:regions.filter(r=>r.name.endsWith(' whole')).reduce((v,r)=>v+r.width*r.height,0),calculatorPixelsCompared:regions.filter(r=>r.name.endsWith(' calculator')).reduce((v,r)=>v+r.width*r.height,0),pixelsCompared:pixels.results.reduce((v,r)=>v+r.pixels,0)};
  }
  for(const form of gallery.forms){
    const before=await fs.readFile(form.path),document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));await vscode.window.showTextDocument(document,{preview:false});await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'input border form');
    const view=[...explorer.formPreview.views.values()].find(view=>view.path===form.path),panel=view.frames.get('main');let ui=await frame({state:{title:panel.panel.title}});
    results.push(await sample(ui,form.expected,form.kind));
    if(form.kind===options.dirtyFrom){
      const other=gallery.forms.find(item=>item.kind===options.dirtyTo),original=document.getText(),changed=await fs.readFile(other.path,'utf8');
      const change=async(text,target,expected)=>{const revision=view.snapshot.revision,edit=new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);await until(()=>view.phase==='ready'&&view.snapshot.revision!==revision&&!view.running&&!view.timer,'dirty input revision');await until(()=>appearance(target,expected),'dirty input palette');await until(()=>ready(target,expected),'dirty input values');};
      await ui.evaluate("globalThis.__borderInput=document.querySelector('.taxi-input');globalThis.__borderCorner=document.querySelector('.taxi-input-corner')");
      await change(changed,ui,other.expected);results.push(await sample(ui,other.expected,'dirty-'+other.kind));await change(original,ui,form.expected);
      assert.equal(await ui.evaluate("globalThis.__borderInput===document.querySelector('.taxi-input')&&globalThis.__borderCorner===document.querySelector('.taxi-input-corner')"),true);
      await explorer.formPreview.receive(view,panel,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'input border detached');const detached=view.frames.get('preview'),floating=await frame({state:{title:detached.panel.title}});
      await until(()=>ready(floating,form.expected),'floating input values');await floating.evaluate("globalThis.__borderInput=document.querySelector('.taxi-input');globalThis.__borderCorner=document.querySelector('.taxi-input-corner')");
      const target=(await floating.targets()).find(target=>target.type==='page'&&target.url==='about:blank');assert.ok(target,'native floating workbench');
      results.push(await sample(floating,form.expected,'floating-'+form.kind,target.targetId));
      await change(changed,floating,other.expected);results.push(await sample(floating,other.expected,'floating-dirty-'+other.kind,target.targetId));await change(original,floating,form.expected);
      assert.equal(await floating.evaluate("globalThis.__borderInput===document.querySelector('.taxi-input')&&globalThis.__borderCorner===document.querySelector('.taxi-input-corner')"),true);
      floating.close();detached.panel.dispose();
      // Docking may recreate the owner's webview; reconnect to its current CDP target.
      ui.close();ui=await frame({state:{title:panel.panel.title}});
      await until(()=>appearance(ui,form.expected),'input border reattached');results.push(await sample(ui,form.expected,'reattached-'+form.kind));
    }
    assert.deepEqual(await fs.readFile(form.path),before);ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'input session released');await Promise.all([...explorer.formPreview.closing]);
  }
  await explorer.shutdown();assert.deepEqual(failures.map(f=>({label:f.label,geometryIssues:f.geometryIssues,regions:f.mismatches.map(m=>m.actual.name)})),[],'native input geometry and pixels');const report={passed:true,locale:vscode.env.language,[options.reportKey]:true,forms:gallery.forms.length,fields:gallery.forms.reduce((count,form)=>count+form.expected.fields.length,0),[options.dirtyKey]:true,detachedUpdates:true,sourceWritesDuringViewing:false,wholeFormVisualParity:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`${options.prefix}-measured-${vscode.env.language}.json`),JSON.stringify(report));await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
