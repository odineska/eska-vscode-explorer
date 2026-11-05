const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), gallery = fixture.frameCorners, results = [];
  const explorer = await vscode.extensions.all.find(item=>item.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  let compared = 0;
  for(const form of gallery.forms){
    const before = await fs.readFile(form.path);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),{preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>view.path===form.path&&view.phase==='ready'),'frame corner form ready');
    const view=[...explorer.formPreview.views.values()].find(view=>view.path===form.path),panel=view.frames.get('main');
    const ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}}), [width,height]=form.expected.nativeFrame;
    await until(()=>ui.evaluate(`(() => {const r=document.querySelector('.taxi-form-frame')?.getBoundingClientRect();return r?.width===${width}&&r?.height===${height};})()`),'native frame dimensions');
    await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const png=await ui.screenshot(`frame-corners-${form.kind}-${vscode.env.language}.png`,true);
    const pixels=await ui.evaluate(`(async()=>{
      if(devicePixelRatio!==1)throw new Error('frame-reference-dpi');
      const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),value=>value.charCodeAt(0));
      const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
      const data=context.getImageData(0,0,canvas.width,canvas.height).data,blue=new Set(),frames=[];
      for(let pixel=0;pixel<canvas.width*canvas.height;pixel++)if(data[pixel*4]===30&&data[pixel*4+1]===144&&data[pixel*4+2]===255)blue.add(pixel);
      while(blue.size){
        const seed=blue.values().next().value,stack=[seed];blue.delete(seed);let left=canvas.width,top=canvas.height,right=0,bottom=0;
        while(stack.length){const pixel=stack.pop(),x=pixel%canvas.width,y=Math.floor(pixel/canvas.width);
          left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
          for(const next of [x?pixel-1:-1,x+1<canvas.width?pixel+1:-1,y?pixel-canvas.width:-1,y+1<canvas.height?pixel+canvas.width:-1])if(blue.delete(next))stack.push(next);
        }
        if(right-left+1===${width}-2&&bottom-top+1===${height}-2)frames.push({x:left-1,y:top-1});
      }
      if(frames.length!==1)throw new Error('frame-reference-selection');
      const origin=frames[0],regions=${JSON.stringify(form.expected.regions)},reference=${JSON.stringify(gallery.referencePixels)},actual={};let count=0,different=0;
      for(const [name,r] of Object.entries(regions)){
        const colors=[];for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
          const index=((origin.y+r.y+y)*canvas.width+origin.x+r.x+x)*4,color=[...data.slice(index,index+3)];colors.push(color);
          if(color.some((value,channel)=>value!==reference[name][y*r.width+x][channel]))different++;count++;
        }
        actual[name]=colors;
      }
      return {origin,compared:count,differentRgbPixels:different,actual};
    })()`);
    results.push({name:form.kind,...pixels});compared+=pixels.compared;
    assert.equal(pixels.differentRgbPixels,0,JSON.stringify({form:form.kind,actual:pixels.actual}));
    assert.deepEqual(await fs.readFile(form.path),before);
    ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'frame session released');await Promise.all([...explorer.formPreview.closing]);
  }
  assert.equal(compared,624);
  await explorer.shutdown();
  const report={passed:true,locale:vscode.env.language,frameCornerPixels:true,compared,differentRgbPixels:0,maskedPixels:0,sourceWritesDuringViewing:false,wholeFormVisualParity:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`frame-corners-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
