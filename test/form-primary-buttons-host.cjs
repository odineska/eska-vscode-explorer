const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');
const {matchFormRasterOrigin}=require('./form-raster-origin.cjs');

exports.run = async (options = {}) => {
  const prefix = options.prefix ?? 'primary-buttons';
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), gallery = fixture.primaryButtons, results = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const files = [gallery.style,gallery.configuration,...gallery.forms.map(form => form.path)];
  const before = await Promise.all(files.map(file => fs.readFile(file)));
  const style = await vscode.workspace.openTextDocument(vscode.Uri.file(gallery.style));
  const configuration = await vscode.workspace.openTextDocument(vscode.Uri.file(gallery.configuration));
  const selectedConfig = configuration.getText(), selection = '<DefaultStyle>Style.ProbeStyleValues</DefaultStyle>';
  assert.ok(selectedConfig.includes(selection));
  const css = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value,16)).join(', ')})`;
  async function edit(document,text,view) {
    if (document.getText() === text) return;
    const revision = view?.snapshot.revision, change = new vscode.WorkspaceEdit();
    change.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
    assert.equal(await vscode.workspace.applyEdit(change),true);
    if (view) await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer,'dirty primary style revision');
  }
  async function ready(ui,expected) {
    return ui.evaluate(`(() => {const buttons=[...document.querySelectorAll('.taxi-command-bar .taxi-button')];
      return buttons.length===3&&buttons.every((button,index)=>{const target=${JSON.stringify(expected.buttons)},style=getComputedStyle(button);
        return button.querySelector('[data-native-caption]')?.dataset.nativeCaption==='ready'&&(${!options.wholeWidgets}||button.querySelector('[data-native-button-border]')?.dataset.nativeButtonBorder==='ready')&&style.color===${JSON.stringify(expected.buttons.map(button => css(button.foreground)))}[index]
          &&style.backgroundColor===${JSON.stringify(expected.buttons.map(button => css(button.background)))}[index]
          &&style.fontWeight===(target[index].weight==='bold'?'700':'400');});})()`);
  }
  async function sample(ui,expected,label,targetId) {
    if (options.wholeWidgets) await matchFormRasterOrigin(ui,expected.paintOrigin??expected.nativeOrigin);
    try { await until(() => ready(ui,expected),'three native primary/ordinary captions'); }
    catch (error) {
      const debug = await ui.evaluate("[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(button=>({font:getComputedStyle(button).font,color:getComputedStyle(button).color,background:getComputedStyle(button).backgroundColor,caption:button.querySelector('[data-native-caption]')?.dataset.nativeCaption,rect:button.getBoundingClientRect().toJSON()}))");
      if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`${prefix}-failure-${vscode.env.language}.json`),JSON.stringify({label,debug,expected},null,2));
      throw error;
    }
    await ui.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const actual = await ui.evaluate(`(() => {const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),buttons:[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(button=>({...rect(button),font:getComputedStyle(button).fontSize}))};})()`);
    assert.deepEqual([actual.frame.width,actual.frame.height],expected.nativeFrame,label+' frame');
    for (const [index,button] of actual.buttons.entries()) {
      const target = expected.buttons[index];
      assert.deepEqual([button.x-actual.frame.x,button.y-actual.frame.y,button.width,button.height],[target.x,target.y,target.width,target.height],label+' '+target.caption);
    }
    let pixels, captureAttempts = 0;
    await until(async () => {
      captureAttempts++;
      const name = `${prefix}-${label}-${vscode.env.language}.png`;
      const png = targetId ? await ui.captureTarget(targetId,name,true) : await ui.screenshot(name,true);
      pixels = await ui.evaluate(`(async()=>{
        if(devicePixelRatio!==1)throw new Error('primary-reference-dpi');
        const image=await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png)}),v=>v.charCodeAt(0))],{type:'image/png'}));
        const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();
        const data=context.getImageData(0,0,canvas.width,canvas.height).data,blue=new Set(),frames=[];
        for(let p=0;p<canvas.width*canvas.height;p++)if(data[p*4]===30&&data[p*4+1]===144&&data[p*4+2]===255)blue.add(p);
        while(blue.size){const seed=blue.values().next().value,stack=[seed];blue.delete(seed);let left=canvas.width,top=canvas.height,right=0,bottom=0;
          while(stack.length){const p=stack.pop(),x=p%canvas.width,y=Math.floor(p/canvas.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
            for(const n of[x?p-1:-1,x+1<canvas.width?p+1:-1,y?p-canvas.width:-1,y+1<canvas.height?p+canvas.width:-1])if(blue.delete(n))stack.push(n);}
          if(right-left+1===${actual.frame.width}-2&&bottom-top+1===${actual.frame.height}-2)frames.push({x:left-1,y:top-1});}
        if(frames.length!==1)return {waitingForFrame:true,frames};
        const origin=frames[0],output=[];
        for(const button of ${JSON.stringify(expected.buttons)}){const r=${!!options.wholeWidgets}?{x:button.x,y:button.y,width:button.width,height:button.height+1}:button.interior,rgb=new Uint8Array(r.width*r.height*3);let offset=0;
          for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const p=((origin.y+r.y+y)*canvas.width+origin.x+r.x+x)*4;for(let c=0;c<3;c++)rgb[offset++]=data[p+c];}
          const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',rgb));
          output.push({caption:button.caption,pixels:r.width*r.height,sha:[...digest].map(v=>v.toString(16).padStart(2,'0')).join('')});}
        return {origin,regions:output};})()`);
      return !pixels.waitingForFrame;
    },'primary native frame painted');
    // Only a missing frame is retried; a pixel mismatch fails immediately.
    assert.deepEqual(pixels.regions.map(region=>region.sha),expected.buttons.map(button=>options.wholeWidgets?button.wholeRgbSha256:button.interiorRgbSha256),label+(options.wholeWidgets?' actual whole buttons and shadows':' actual screenshot interiors'));
    return {label,expected:expected.name,...actual,...pixels,captureAttempts,pixelsCompared:pixels.regions.reduce((sum,region)=>sum+region.pixels,0),differentRgbPixels:0};
  }
  for (const form of gallery.forms) {
    await edit(configuration,form.styleText?selectedConfig:selectedConfig.replace(selection,''));
    if(form.styleText)await edit(style,form.styleText);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    await until(()=>vscode.window.activeTextEditor?.document===document,'primary source active');
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(()=>[...explorer.formPreview.views.values()].some(view=>sameSourcePath(view.path,form.path)&&view.phase==='ready'),'primary form ready');
    const view=[...explorer.formPreview.views.values()].find(view=>sameSourcePath(view.path,form.path)),panel=view.frames.get('main');
    let ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    results.push(await sample(ui,form.expected,form.kind));
    if(options.wholeWidgets&&form.poses) {
      await ui.evaluate("globalThis.__posedButtons=[...document.querySelectorAll('.taxi-command-bar .taxi-button')]");
      for(const pose of form.poses) {
        const sampleResult=await sample(ui,pose,'native-pose-'+pose.pose);
        assert.equal(await ui.evaluate("globalThis.__posedButtons.every((button,index)=>button===document.querySelectorAll('.taxi-command-bar .taxi-button')[index])"),true);
        results.push({...sampleResult,positionedWholeWidgets:true,paintOrigin:pose.paintOrigin});
      }
    }
    if(['FontAuto','Color000080'].includes(form.kind)) {
      const color=form.kind.startsWith('Color'),other=gallery.forms.find(item=>item.kind===(color?'ColorFF0000':'FontRegular'));
      const owner=color?style:document,original=owner.getText(),changed=color?other.styleText:await fs.readFile(other.path,'utf8');
      // Only the primary button consumes the selected ImportantColor here;
      // the second button has its own explicit RGB background in the XML.
      const reference = row => color ? {...form.expected,name:row.name,buttons:[row.buttons[0],...form.expected.buttons.slice(1)]} : row;
      const changedExpected = reference(other.expected);
      const change=async(text,target,expected)=>{await edit(owner,text,view);await until(()=>ready(target,expected),'dirty primary paint');};
      await ui.evaluate("globalThis.__primaryButton=document.querySelector('.taxi-command-bar .taxi-button')");
      await change(changed,ui,changedExpected);results.push(await sample(ui,changedExpected,'dirty-'+form.kind));await change(original,ui,form.expected);
      if(color){const fallback=gallery.forms.find(item=>item.kind==='ColorFFE100');await edit(configuration,selectedConfig.replace(selection,''),view);results.push(await sample(ui,reference(fallback.expected),'default-'+form.kind));await edit(configuration,selectedConfig,view);}
      assert.equal(await ui.evaluate("globalThis.__primaryButton===document.querySelector('.taxi-command-bar .taxi-button')"),true);
      await explorer.formPreview.receive(view,panel,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'primary form detached');
      const detached=view.frames.get('preview'),floating=await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
      await until(()=>ready(floating,form.expected),'floating primary captions');const target=await floating.nativeWindow({detached:true});
      results.push(await sample(floating,form.expected,'floating-'+form.kind,target.targetId));
      await floating.evaluate("globalThis.__primaryButton=document.querySelector('.taxi-command-bar .taxi-button')");
      await change(changed,floating,changedExpected);results.push(await sample(floating,changedExpected,'floating-dirty-'+form.kind,target.targetId));await change(original,floating,form.expected);
      assert.equal(await floating.evaluate("globalThis.__primaryButton===document.querySelector('.taxi-command-bar .taxi-button')"),true);
      floating.close();detached.panel.dispose();await until(async()=>!(await ui.targets()).some(item=>item.targetId===target.targetId),'primary native window closed');
      ui.close();ui=await frame({fixedFormArea:true,state:{title:panel.panel.title}});results.push(await sample(ui,form.expected,'reattached-'+form.kind));
    }
    ui.close();panel.panel.dispose();await until(()=>explorer.formPreview.views.size===0,'primary session released');await Promise.all([...explorer.formPreview.closing]);
  }
  assert.deepEqual(await Promise.all(files.map(file=>fs.readFile(file))),before);
  await explorer.shutdown();
  const report={passed:true,locale:vscode.env.language,forms:gallery.forms.length,buttons:gallery.forms.length*3,dirtyFont:true,dirtyStyle:true,dirtyDefaultStyle:true,detachedUpdates:true,sourceWritesDuringViewing:false,wholeWidgetPixelParity:!!options.wholeWidgets,wholeFormVisualParity:false,results};
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,`${prefix}-measured-${vscode.env.language}.json`),JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
