const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const vscode=require('vscode');
const {until,frame, sameSourcePath } = require('./webview-host.cjs');

function captionContrast(foreground, background) {
  const luminance = color => color.match(/[\d.]+/g).slice(0,3).reduce((sum,value,index) => {
    const channel=Number(value)/255;
    return sum+[0.2126,0.7152,0.0722][index]*(channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4);
  },0);
  const a=luminance(foreground),b=luminance(background);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}

/** Observe only the readonly application form while changing this test container's allocation. */
async function resizeApplication(ui,index,artifacts) {
  await ui.evaluate(`globalThis.__applicationResize={style:document.querySelector('#root').style.cssText,nodes:[...document.querySelectorAll('.taxi-form-frame,.taxi-element')]};true`);
  const samples=[];
  try {
    for(const [width,height] of [[1200,700],[800,500],[480,360],[1200,700]]) {
      await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
      await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
      let sample, previous;
      await until(async()=>{
        sample=await ui.evaluate(`(() => {
        const root=document.querySelector('.taxi-form-frame'),r=root.getBoundingClientRect(),v=document.querySelector('.preview-scroll');
        const visible=[...root.querySelectorAll('.taxi-element')].filter(node=>getComputedStyle(node).visibility!=='hidden'&&node.getClientRects().length);
        const body=root.querySelector('.taxi-form-scrollport'), b=body.getBoundingClientRect();
        const contentBottom=body.hasAttribute('data-scrollable')?b.y+body.scrollHeight-body.scrollTop:r.bottom;
        const outside=visible.filter(node=>{const box=node.getBoundingClientRect();return box.right>r.right+2||box.bottom>contentBottom+2;});
        const bars=[...root.querySelectorAll('.taxi-tabs,.taxi-root-commands,.taxi-table-command-bar')].map(node=>({kind:node.className,width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,overflow:getComputedStyle(node).overflowX}));
        return {frame:{width:r.width,height:r.height},viewport:{width:v.clientWidth,height:v.clientHeight},sameNodes:__applicationResize.nodes.every(node=>node.isConnected),outsideElements:outside.map(node=>({kind:node.dataset.kind,id:node.dataset.element,rect:node.getBoundingClientRect().toJSON()})),contentBottom,rects:visible.map(node=>({id:node.dataset.element,...node.getBoundingClientRect().toJSON()})),tables:[...root.querySelectorAll('.taxi-table-content')].map(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth})),bars,unsupported:root.querySelectorAll('.taxi-unsupported').length};
      })()`);
        const stable=isDeepStrictEqual(sample,previous);previous=sample;return stable;
      },'application layout settles after resize');
      await fs.writeFile(path.join(artifacts,`application-geometry-${index}-${width}-${height}.json`),JSON.stringify(sample,null,2));
      await ui.screenshot(`application-resize-${index}-${width}-${height}-${vscode.env.language}.png`);
      assert.equal(sample.sameNodes,true);assert.equal(sample.unsupported,0);
      assert.deepEqual(sample.outsideElements,[],'visible application controls stay inside the form frame');
      samples.push({width,height,...sample});
    }
    assert.deepEqual(samples.at(-1).rects,samples[0].rects,'A → B → A restores every visible element rectangle');
  } finally {await ui.evaluate(`document.querySelector('#root').style.cssText=__applicationResize.style;true`);}
  return samples;
}

async function inspectApplication(ui, view) {
  const nodes=[];
  function visit(node) {
    if (!['ContextMenu','ExtendedTooltip'].includes(node.kind)) nodes.push(node);
    for (const child of [...node.auxiliary,...node.children]) visit(child);
  }
  visit(view.snapshot.model.root);
  const results=[];
  for (const node of nodes) {
    if (!node.name || node.kind==='AutoCommandBar'&&!node.children.length) continue;
    await ui.evaluate(`(()=>{const input=document.querySelector('.form-inspector-search input');input.value=${JSON.stringify(node.name)};input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const selector=`[...document.querySelectorAll('.form-tree-row')].find(row=>row.querySelector('.form-truncate')?.textContent===${JSON.stringify(node.name)})`;
    await until(()=>ui.evaluate(`!!(${selector})`),'application tree selection '+node.name);
    await ui.evaluate(`(${selector}).click();true`);
    await until(()=>isDeepStrictEqual(view.palette?.identity,node.identity),'application palette '+node.name);
    assert.ok(view.palette.rows?.length,'catalog for '+node.kind+' '+node.name);
    results.push({name:node.name,kind:node.kind,properties:view.palette.rows.filter(row=>row.id.startsWith('platform:')).length});
  }
  await ui.evaluate(`(()=>{const input=document.querySelector('.form-inspector-search input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  return results;
}

async function checkTextScaling(ui) {
  const statuses = () => ui.evaluate(`({ratio:devicePixelRatio,ready:document.querySelectorAll('[data-native-caption=ready],[data-native-value=ready],[data-native-tumbler-captions=ready],[data-native-segments=ready]').length})`);
  const baseline = await statuses();
  if (process.platform !== 'linux' || baseline.ratio !== 1) return baseline;
  await until(async()=>(await statuses()).ready>0,'native text ready at 100%');
  const windowSettings=vscode.workspace.getConfiguration("window"), originalZoom=windowSettings.get("zoomLevel");
  try {
    await windowSettings.update("zoomLevel",4,vscode.ConfigurationTarget.Global);
    try { await until(async()=>{const sample=await statuses();return sample.ratio>1&&sample.ready===0;},'browser text at doubled monitor density'); }
    catch (error) { throw new Error(error.message+' '+JSON.stringify(await statuses())); }
    await ui.screenshot('application-hidpi.png');
  } finally { await windowSettings.update("zoomLevel",originalZoom,vscode.ConfigurationTarget.Global); }
  await until(async()=>{const sample=await statuses();return sample.ratio===1&&sample.ready>0;},'native text restored after density change');
  try {
    await ui.evaluate(`(()=>{const zoom=document.querySelector('.form-zoom select');zoom.value='125';zoom.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await until(async()=>(await statuses()).ready===0,'browser text at 125% zoom');
  } finally {
    await ui.evaluate(`(()=>{const zoom=document.querySelector('.form-zoom select');zoom.value='100';zoom.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  }
  await until(async()=>(await statuses()).ready>0,'native text restored at 100%');
  return {baseline,scaledWorkbench:true,zoom:125,restored:true};
}

/** Existing application inputs are read only; all reports and screenshots belong to the runner. */
exports.run=async function(){
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE), inputs=JSON.parse(process.env.ESKA_FORM_SAMPLE_PATHS ?? '[]');
  assert.ok(Array.isArray(inputs)&&inputs.length>0&&inputs.length<=128&&inputs.every(input=>typeof input==='string'&&path.isAbsolute(input)));
  const explorer=await vscode.extensions.all.find(extension=>extension.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results=[], artifacts=process.env.ESKA_SCREENSHOT_DIR ?? fixture.root;
  for(const [index,input] of inputs.entries()){
    const before=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');
    const document=await vscode.workspace.openTextDocument(vscode.Uri.file(input));await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    const started=performance.now();await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service=explorer.formPreview;
    await until(()=>[...service.views.values()].some(view=>sameSourcePath(view.path,input)&&view.phase==='ready'),`application form ${index} model`);
    const view=[...service.views.values()].find(view=>sameSourcePath(view.path,input)),main=view.frames.get('main');
    const ui=await frame({state:{title:main.panel.title}});
    await until(async()=>await ui.evaluate("!!document.querySelector('.taxi-form-frame')"),'application form DOM');
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-picture-resource')].every(image=>image.complete&&image.naturalWidth>0)"),'application form images');
    const elapsed=Math.round(performance.now()-started);
    await fs.writeFile(path.join(artifacts,`application-model-${index}.json`),JSON.stringify(view.snapshot.model));
    const referenceResults=[];
    if (view.client.limits.referenceData) {
      const reference=view.snapshot.model.dataFields.find(field=>field.valueType.types.some(type=>type.namespace==='http://v8.1c.ru/8.1/data/enterprise/current-config'&&type.name.startsWith('CatalogRef.')));
      if (reference) {
        const selectData=async(dataPath)=>{
          await ui.evaluate(`(()=>{const input=document.querySelector('.form-inspector-search input');input.value=${JSON.stringify(dataPath)};input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
          await until(()=>ui.evaluate(`!!document.querySelector('[data-form-data-path="'+CSS.escape(${JSON.stringify(dataPath)})+'"]')`),'reference row visible');
          await ui.evaluate(`document.querySelector('[data-form-data-path="'+CSS.escape(${JSON.stringify(dataPath)})+'"]').click();true`);
          await ui.evaluate(`(()=>{const input=document.querySelector('.form-inspector-search input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        };
        await ui.evaluate(`document.querySelector('[data-form-data-path="'+CSS.escape(${JSON.stringify(reference.path[0])})+'"] .form-tree-expander').click();true`);
        await until(()=>view.phase==='ready','main attribute expansion');
        await selectData(reference.path.join('.'));
        const revision=view.snapshot.revision;
        await until(()=>ui.evaluate(`!!document.querySelector('[data-form-data-path="'+CSS.escape(${JSON.stringify(reference.path.join('.'))})+'"] .form-tree-expander')`),'reference expander visible');
        await ui.evaluate(`document.querySelector('[data-form-data-path="'+CSS.escape(${JSON.stringify(reference.path.join('.'))})+'"] .form-tree-expander').click();true`);
        await until(()=>view.snapshot.revision!==revision&&view.phase==='ready','reference children loaded');
        const children=view.snapshot.model.dataFields.filter(field=>field.path.length===reference.path.length+1&&reference.path.every((part,i)=>field.path[i]===part));
        assert.ok(children.length>0,'unbound reference exposes metadata fields');
        referenceResults.push({path:reference.path,children:children.map(field=>field.path.at(-1))});
      }
    }
    const inspected=await inspectApplication(ui,view);
    const rendered=await ui.evaluate("(()=>{const visible=selector=>[...document.querySelectorAll(selector)].filter(node=>getComputedStyle(node).visibility!=='hidden').length;return {elements:visible('[data-element]'),retainedElements:document.querySelectorAll('[data-element]').length,unsupported:document.querySelectorAll('.taxi-unsupported').length,pictures:visible('.taxi-picture-resource'),incompleteFields:visible('.taxi-input--incomplete'),commandButtons:visible('.taxi-root-commands button'),scrollWidth:document.querySelector('.taxi-form-frame').scrollWidth,scrollHeight:document.querySelector('.taxi-form-frame').scrollHeight}})()");
    assert.equal(rendered.unsupported,0);
    let titleContrast;
    if(process.platform==='win32'){
      const title=await ui.evaluate("(() => {const css=getComputedStyle(document.querySelector('.taxi-form-title'));return {foreground:css.color,background:css.backgroundColor}})()");
      titleContrast=captionContrast(title.foreground,title.background);
      assert.ok(titleContrast>=4.5,'selected form title remains readable on its background');
    }
    const commandMenus = await ui.evaluate(`(() => {
      const groups = [...document.querySelectorAll('.taxi-root-commands > [data-command-group]')];
      return groups.map(group => {
        const trigger = group.querySelector(':scope > button');
        trigger.click();
        const items = [...group.querySelectorAll('[role=menuitem]')].map(item => item.textContent);
        trigger.click();
        return { key: group.dataset.commandGroup, label: trigger.getAttribute('aria-label'), items };
      });
    })()`);
    assert.ok(commandMenus.every(menu => menu.items.length > 0), 'generated menus expose their actions');
    await ui.screenshot(`application-form-${index}-${vscode.env.language}.png`);
    const resize=await resizeApplication(ui,index,artifacts);
    const textScaling=await checkTextScaling(ui);
    const after=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');assert.equal(after,before,'view preserves application XML');
    results.push({sample:index,openThroughFirstPaintMs:elapsed,...rendered,titleContrast,commandMenus,referenceResults,inspected,resize,textScaling,dependencies:view.snapshot.dependencies.length,assets:view.snapshot.model.assets.length,
      compositionDiagnostics:view.snapshot.model.diagnostics.composition.length,appearanceDiagnostics:view.snapshot.model.diagnostics.appearance.map(item=>item.code)});
    ui.close();main.panel.dispose();await until(()=>service.views.size===0,'application session released');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formApplication:true,locale:vscode.env.language,sourceWritesDuringViewing:false,results}));
};
