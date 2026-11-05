const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const vscode=require('vscode');
const {until,frame}=require('./webview-host.cjs');

/** Observe only the readonly application form while changing this test container's allocation. */
async function resizeApplication(ui,index) {
  await ui.evaluate(`globalThis.__applicationResize={style:document.querySelector('#root').style.cssText,nodes:[...document.querySelectorAll('.taxi-form-frame,.taxi-element')]};true`);
  const samples=[];
  try {
    for(const [width,height] of [[480,360],[800,500],[1200,700]]) {
      await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
      await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      const sample=await ui.evaluate(`(() => {
        const root=document.querySelector('.taxi-form-frame'),r=root.getBoundingClientRect(),v=document.querySelector('.preview-scroll');
        const visible=[...root.querySelectorAll('.taxi-element')].filter(node=>getComputedStyle(node).visibility!=='hidden');
        const outside=visible.filter(node=>{const box=node.getBoundingClientRect();return box.right>r.right+2||box.bottom>r.bottom+2;});
        const bars=[...root.querySelectorAll('.taxi-tabs,.taxi-root-commands,.taxi-table-command-bar')].map(node=>({kind:node.className,width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,overflow:getComputedStyle(node).overflowX}));
        return {frame:{width:r.width,height:r.height},viewport:{width:v.clientWidth,height:v.clientHeight},sameNodes:__applicationResize.nodes.every(node=>node.isConnected),outsideElements:outside.map(node=>node.dataset.kind),tables:[...root.querySelectorAll('.taxi-table-content')].map(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth})),bars,unsupported:root.querySelectorAll('.taxi-unsupported').length};
      })()`);
      assert.equal(sample.sameNodes,true);assert.equal(sample.unsupported,0);
      assert.deepEqual(sample.outsideElements,[],'visible application controls stay inside the form frame');
      samples.push({width,height,...sample});await ui.screenshot(`application-resize-${index}-${width}-${height}-${vscode.env.language}.png`);
    }
  } finally {await ui.evaluate(`document.querySelector('#root').style.cssText=__applicationResize.style;true`);}
  return samples;
}

/** Existing application inputs are read only; all reports and screenshots belong to the runner. */
exports.run=async function(){
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE), inputs=JSON.parse(process.env.ESKA_FORM_SAMPLE_PATHS ?? '[]');
  assert.ok(Array.isArray(inputs)&&inputs.length>0&&inputs.length<=16&&inputs.every(input=>typeof input==='string'&&path.isAbsolute(input)));
  const explorer=await vscode.extensions.all.find(extension=>extension.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results=[];
  for(const [index,input] of inputs.entries()){
    const before=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');
    const document=await vscode.workspace.openTextDocument(vscode.Uri.file(input));await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    const started=performance.now();await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service=explorer.formPreview;
    await until(()=>[...service.views.values()].some(view=>view.path===input&&view.phase==='ready'),`application form ${index} model`);
    const view=[...service.views.values()].find(view=>view.path===input),main=view.frames.get('main');
    const ui=await frame({state:{title:main.panel.title}});
    await until(async()=>await ui.evaluate("!!document.querySelector('.taxi-form-frame')"),'application form DOM');
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-picture-resource')].every(image=>image.complete&&image.naturalWidth>0)"),'application form images');
    const rendered=await ui.evaluate("(()=>{const visible=selector=>[...document.querySelectorAll(selector)].filter(node=>getComputedStyle(node).visibility!=='hidden').length;return {elements:visible('[data-element]'),retainedElements:document.querySelectorAll('[data-element]').length,unsupported:document.querySelectorAll('.taxi-unsupported').length,pictures:visible('.taxi-picture-resource'),incompleteFields:visible('.taxi-input--incomplete'),commandButtons:visible('.taxi-root-commands button'),scrollWidth:document.querySelector('.taxi-form-frame').scrollWidth,scrollHeight:document.querySelector('.taxi-form-frame').scrollHeight}})()");
    assert.equal(rendered.unsupported,0);
    const elapsed=Math.round(performance.now()-started);
    await ui.screenshot(`application-form-${index}-${vscode.env.language}.png`);
    const resize=await resizeApplication(ui,index);
    const after=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');assert.equal(after,before,'view preserves application XML');
    results.push({sample:index,openThroughFirstPaintMs:elapsed,...rendered,resize,dependencies:view.snapshot.dependencies.length,assets:view.snapshot.model.assets.length,
      compositionDiagnostics:view.snapshot.model.diagnostics.composition.length,appearanceDiagnostics:view.snapshot.model.diagnostics.appearance.map(item=>item.code)});
    main.panel.dispose();await until(()=>service.views.size===0,'application session released');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formApplication:true,locale:vscode.env.language,sourceWritesDuringViewing:false,results}));
};
