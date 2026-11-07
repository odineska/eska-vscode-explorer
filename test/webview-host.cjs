const fs = require('node:fs/promises');
const path = require('node:path');
const publications = new WeakMap();

/** Compare native paths with the host OS rules, including Windows drive casing. */
function sameSourcePath(left, right) {
  return path.relative(left, right) === '';
}

/** Wait for a concrete context or DOM condition in the isolated native test window. */
async function until(condition, label) {
  for (let i = 0; i < 160; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(label);
}

/** Attach to a packaged webview by its visible title and retain screenshot evidence. */
async function frame(tab) {
  const targets = await (await fetch(`http://127.0.0.1:${process.env.ESKA_HOST_DEBUG_PORT}/json/list`)).json();
  const workbenchTarget=targets.find(item=>item.type==='page'&&item.url.startsWith('vscode-file:'));
  const socket = new WebSocket(workbenchTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const nativeWindowIds = new Map();
  let serial = 0;
  const pending = new Map(), contexts = [], attached = new Map(), scriptErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')scriptErrors.push({...message.params.entry,sessionId:message.sessionId});
    if(message.method==='Runtime.exceptionThrown')scriptErrors.push({...message.params.exceptionDetails,sessionId:message.sessionId});
    if (message.method === 'Runtime.executionContextCreated') contexts.push({ id: message.params.context.id, sessionId: message.sessionId, frameId:message.params.context.auxData?.frameId });
    if (message.method === 'Runtime.executionContextDestroyed' || message.method === 'Runtime.executionContextsCleared' || message.method === 'Target.detachedFromTarget') {
      const lost=message.method==='Target.detachedFromTarget'?message.params.sessionId:message.sessionId;
      if(message.method==='Target.detachedFromTarget')for(const [target,session] of attached)if(session===lost)attached.delete(target);
      for(let index=contexts.length-1;index>=0;index--)if(contexts[index].sessionId===lost
        && (message.method!=='Runtime.executionContextDestroyed'||contexts[index].id===message.params.executionContextId))contexts.splice(index,1);
    }
    const promise = pending.get(message.id);
    if (promise) {
      pending.delete(message.id); clearTimeout(promise.timer);
      if (message.error) {
        promise.error.message = `${message.error.message} (${promise.method})`;
        promise.reject(Object.assign(promise.error, { code: message.error.code, data: message.error.data }));
      } else promise.resolve(message.result);
    }
  });
  socket.addEventListener('close', () => {
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error('native debug connection closed')); }
    pending.clear();
  });
  /** Match command replies independently of context notifications. */
  function send(method, params = {}, sessionId, timeout = process.platform === 'win32' ? 15000 : 5000) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      // Hidden Windows webviews can suspend evaluation; they must not block discovery of the active frame.
      const timer = setTimeout(() => {
        const error = pending.get(id)?.error ?? new Error();
        pending.delete(id);
        error.message = `native debug timeout: ${method}`;
        reject(Object.assign(error,{code:'native_debug_timeout',method,sessionId}));
      }, timeout);
      pending.set(id, { resolve, reject, timer, method, error: new Error(`native debug failure: ${method}`) }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const gone=error=>[-32602,-32000,-32001].includes(error?.code)&&/(?:Session with given id not found|No target with given id found|No session with given id)/i.test(error.message);
  /** Join OOPIF subtrees to their native pages before accepting a moved preview. */
  async function windowTree() {
    const parents=new Map(),windows=new Map(),all=(await send('Target.getTargets')).targetInfos;
    const record=(node,parent)=>{
      if(node.frame.parentId||parent)parents.set(node.frame.id,node.frame.parentId??parent);
      for(const child of node.childFrames??[])record(child,node.frame.id);
    };
    // OOPIF subtrees are reported by their own targets; parentId joins them to the native page.
    for(const target of all.filter(target=>['page','iframe'].includes(target.type))){
      let sessionId;
      try {
        if(target.targetId!==workbenchTarget.id)({sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}));
        const result=await send('Page.getFrameTree',{},sessionId);
        record(result.frameTree);
        if(target.type==='page')windows.set(result.frameTree.frame.id,target);
      } catch(error){if(!gone(error))throw error;}
      finally {if(sessionId)try{await send('Target.detachFromTarget',{sessionId});}catch(error){if(!gone(error))throw error;}}
    }
    return {parents,windows,all};
  }
  function ownerInTree(frameId, {parents,windows}) {
    const seen=new Set();let id=frameId;
    while(id&&!seen.has(id)) {
      if(windows.has(id))return windows.get(id);
      seen.add(id);id=parents.get(id);
    }
  }
  await send('Runtime.enable');await send('Log.enable');
  let context, discovery;
  try { await until(async () => {
    const all = await send('Target.getTargets');
    for (const target of all.targetInfos.filter(item => (item.type === 'iframe' || tab.detached && item.type === 'page' && item.targetId !== workbenchTarget.id) && !attached.has(item.targetId))) {
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        attached.set(target.targetId,sessionId);
        await send('Runtime.enable', {}, sessionId);await send('Log.enable',{},sessionId);
      } catch (error) {
        // A newly shown webview can replace its iframe between enumeration and attachment.
        // A hidden renderer may suspend domain enablement. Keep its session so
        // late context events remain observable, and discover the visible frame.
        if(error?.code==='native_debug_timeout'&&error.method==='Runtime.enable')continue;
        attached.delete(target.targetId);
        if (!([-32602, -32000, -32001].includes(error?.code) && /(?:Session with given id not found|No target with given id found|No session with given id)/i.test(error.message))) throw error;
      }
    }
    const tree=tab.detached?await windowTree():undefined;
    discovery={detached:!!tab.detached,contexts:contexts.slice(-24).map(item=>({id:item.id,frameId:item.frameId,owner:tree?ownerInTree(item.frameId,tree)?.targetId:undefined})),targets:all.targetInfos.slice(0,32).map(({targetId,type})=>({targetId,type}))};
    for (const candidate of contexts) {
      if(tree) {
        const owner=ownerInTree(candidate.frameId,tree);
        // Code can leave an old iframe with the same title in the main window while cloning the preview.
        if(!owner||owner.targetId===workbenchTarget.id)continue;
      }
      try {
        const result = await send('Runtime.evaluate', { contextId: candidate.id, expression: `document.getElementById('title')?.textContent === ${JSON.stringify(tab.state.title)}`, returnByValue: true }, candidate.sessionId, 500);
        if (result.result?.value) { context = candidate; return true; }
      } catch {}
    }
    return false;
  }, 'property frame'); } catch(error) {
    if(error.message==='property frame') {
      const roles=[];
      for(const candidate of contexts.slice(-12)) {
        try {
          const result=await send('Runtime.evaluate',{contextId:candidate.id,expression:`({role:document.querySelector('.form-shell')?.dataset.viewRole,titleMatches:document.getElementById('title')?.textContent===${JSON.stringify(tab.state.title)},visible:document.visibilityState})`,returnByValue:true},candidate.sessionId,500);
          roles.push({id:candidate.id,frameId:candidate.frameId,value:result.result?.value});
        } catch {}
      }
      discovery={...discovery,workbenchTarget:workbenchTarget.id,roles};
    }
    error.message+=' '+JSON.stringify(discovery);throw error;
  }
  /** Observe only real state messages, after the packaged renderer has handled them. */
  function projectState(value) {
    return {revision:value.revision,status:value.status,editing:{busy:value.editing?.busy,unlocked:value.editing?.unlocked,
      blocked:value.editing?.blocked,drafts:value.editing?.drafts,snapshot:value.editing?.schema?.snapshot,undo:value.editing?.schema?.undo,redo:value.editing?.schema?.redo}};
  }
  const projection = projectState.toString();
  const propertyTab = Number.isInteger(tab.state?.revision) && typeof tab.receive === 'function';
  let publication = propertyTab ? publications.get(tab) : undefined;
  if (propertyTab && !publication) {
    publication = {sequence:0};
    publications.set(tab, publication);
    const publish = tab.publish.bind(tab), observed = publication;
    tab.publish = () => {
      publish();
      // A separate ignored marker acknowledges delivery without changing any product state.
      if (tab.ready && !tab.disposed) void tab.panel.webview.postMessage({type:'eska-native-publication',sequence:++observed.sequence});
    };
  }
  await send('Runtime.evaluate', {contextId:context.id,expression:`if(!globalThis.__eskaNativeObserver){globalThis.__eskaNativeObserver=true;
    window.addEventListener('message',event=>{if(event.data?.type==='state'){
      globalThis.__eskaNativeState=event.data;
      if(event.data.model)globalThis.__eskaNativeFormRevision=event.data.revision;
    }
      if(event.data?.type==='eska-native-publication')globalThis.__eskaNativeSequence=event.data.sequence;});}`,returnByValue:true},context.sessionId);
  // Repeat the normal initial ready handshake only; subsequent waits observe production publications.
  if (propertyTab) await tab.receive({type:'ready'});
  async function currentState(idle) {
    if (!propertyTab) return;
    await until(async () => {
      const result = await send('Runtime.evaluate',{contextId:context.id,expression:`globalThis.__eskaNativeState&&({sequence:globalThis.__eskaNativeSequence,state:JSON.stringify((${projection})(globalThis.__eskaNativeState))})`,returnByValue:true},context.sessionId);
      const expected = projectState(tab.state), received = result.result?.value;
      return (!idle || (expected.status === 'ready' && !expected.editing.busy)) && received?.sequence >= publication.sequence && received.state === JSON.stringify(expected);
    },'current property state rendered');
  }
  await currentState(true);
  /** Native pixel fixtures keep their original preferred-size viewport explicitly. */
  async function fixedFormArea() {
    if (!tab.fixedFormArea) return;
    const result = await send('Runtime.evaluate', {contextId:context.id,returnByValue:true,awaitPromise:true,
      expression:`(async()=>{
        const root=document.querySelector('.taxi-form-frame'),surface=document.querySelector('.preview-scroll');if(!root||!surface)return;
        for(let i=0;i<10&&root.closest('.taxi-preview').dataset.formLayout!=='allocated';i++)await new Promise(requestAnimationFrame);
        const css=getComputedStyle(root),zoom=Number(document.querySelector('.form-zoom select').value)/100;
        const width=parseFloat(css.getPropertyValue('--taxi-form-preferred-width')),height=parseFloat(css.getPropertyValue('--taxi-form-preferred-height'));
        if(!(width>0&&height>0))return;
        const box=getComputedStyle(surface),w=(width+8)*zoom+parseFloat(box.paddingLeft)+parseFloat(box.paddingRight),h=(height+8)*zoom+parseFloat(box.paddingTop)+parseFloat(box.paddingBottom);
        if(surface.style.width===w+'px'&&surface.style.height===h+'px')return;
        Object.assign(surface.style,{width:w+'px',height:h+'px',minHeight:'0',flex:'0 0 auto'});
        for(let i=0;i<10;i++) {
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const css=getComputedStyle(root),extra=css.boxSizing==='content-box'?4:0;if(Math.abs(parseFloat(css.width)+extra-width)<1&&Math.abs(parseFloat(css.height)+extra-height)<1)break;
        }
      })()`},context.sessionId);
    if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return {
    scriptErrors() { return scriptErrors.filter(error=>error.sessionId===context.sessionId&&(/form-preview\.js/.test(error.url??'')||/form-preview\.js/.test(error.exception?.description??'')||error.executionContextId===context.id)); },
    /** A file acknowledgement alone does not mean that the next control has been rendered. */
    async rendered() {
      await currentState(true);
    },
    /** Evaluate test code solely in this task's isolated property webview. */
    async evaluate(expression) {
      await currentState(false);
      await fixedFormArea();
      const result = await send('Runtime.evaluate', { contextId: context.id, expression, returnByValue: true, awaitPromise: true }, context.sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    },
    /** Bring only the task's main workbench to the foreground for native editor commands. */
    async focusWorkbench() { await send('Page.bringToFront'); },
    /** Leave native HTML tooltips outside the measured form before a pixel capture. */
    async parkPointer(targetId) {
      const session=targetId?await send('Target.attachToTarget',{targetId,flatten:true}):undefined;
      try { await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0,button:'none'},session?.sessionId); }
      finally { if(session)await send('Target.detachFromTarget',{sessionId:session.sessionId}); }
    },
    /** Capture a specific floating workbench from this task's debugging endpoint. */
    async captureTarget(targetId, name, withData = false) {
      if (!process.env.ESKA_SCREENSHOT_DIR && !withData) return;
      const {sessionId} = await send('Target.attachToTarget', {targetId,flatten:true});
      try {
        // The move command can resolve before the auxiliary workbench has painted.
        await send('Page.bringToFront',{},sessionId);
        let editorTabs;
        try { await until(async()=>{
          const result=await send('Runtime.evaluate',{expression:"[...document.querySelectorAll('.tabs-container .tab')].map(tab=>tab.textContent)",returnByValue:true},sessionId);
          editorTabs=result.result?.value;
          return editorTabs?.includes(tab.state.title);
        },'native floating editor identity'); }
        catch(error){throw new Error(error.message+' '+JSON.stringify({expected:tab.state.title,actual:editorTabs}));}
        await send('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',awaitPromise:true},sessionId);
        const result=await send('Page.captureScreenshot',{format:'png'},sessionId);
        if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,name),Buffer.from(result.data,'base64'));
        if (withData) return result.data;
      } finally { await send('Target.detachFromTarget',{sessionId}); }
    },
    /** Resolve the native window containing this exact webview frame, even with several previews. */
    async nativeWindow({ detached = false } = {}) {
      if(!context.frameId)throw new Error('native webview frame identity missing');
      let owner,observation;
      try{await until(async()=>{
        const {parents,windows,all}=await windowTree();
        observation={frameId:context.frameId,parents:[...parents].slice(0,64),pageFrames:[...windows].slice(0,32).map(([id,target])=>[id,target.targetId]),targets:all.slice(0,64).map(({targetId,type})=>({targetId,type})),counts:{parents:parents.size,pageFrames:windows.size,targets:all.length}};
        owner=ownerInTree(context.frameId,{parents,windows});
        // The native move command can finish before the webview is reparented.
        return !!owner&&(!detached||owner.targetId!==workbenchTarget.id);
      },'native window containing the webview frame');}
      catch(error){error.message+=' '+JSON.stringify(observation);throw error;}
      return owner;
    },
    /** Resize only a window identified through this isolated host's debugging endpoint. */
    async windowBounds(targetId) {
      let session;
      try {
        if(targetId!==workbenchTarget.id)session=await send('Target.attachToTarget',{targetId,flatten:true});
        const result=await send('Runtime.evaluate',{expression:'({width:window.outerWidth,height:window.outerHeight,left:window.screenX,top:window.screenY,title:document.title})',returnByValue:true},session?.sessionId);
        return {windowId:targetId,bounds:result.result.value};
      } finally {if(session)await send('Target.detachFromTarget',{sessionId:session.sessionId});}
    },
    async resizeWindow(windowId, bounds) {
      const current=await this.windowBounds(windowId);
      const python=process.env.ESKA_TEST_PYTHON??(process.platform==='win32'?'python':'python3');
      const helper=process.platform==='win32'?'resize-native-workbench-windows.py':'resize-native-workbench.py';
      const output=require('node:child_process').execFileSync(python,['-B',path.join(__dirname,helper),process.env.VSCODE_PID,JSON.stringify({...current.bounds,xid:nativeWindowIds.get(windowId)}),JSON.stringify(bounds)],{encoding:'utf8'});
      nativeWindowIds.set(windowId,JSON.parse(output).window);
    },
    /** Enumerate only this isolated IDE process's native workbench targets, including floating windows. */
    async targets() { return (await send('Target.getTargets')).targetInfos; },
    /** Observe the native QuickPick outside the property iframe before sending keyboard commands. */
    async workbench(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true });
      return result.result?.value;
    },
    /** Monaco list selection listens to pointer input rather than an HTMLElement.click shortcut. */
    async clickWorkbench(selector) {
      const result = await send('Runtime.evaluate', {expression:`(async()=>{
        const widget=[...document.querySelectorAll('.quick-input-widget')].find(node=>node.offsetWidth&&node.offsetHeight);
        if(widget)await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.target instanceof Element
          &&(animation.effect.target===widget||widget.contains(animation.effect.target))).map(animation=>animation.finished));
        for(const element of document.querySelectorAll(${JSON.stringify(selector)})){
          const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)continue;
          const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2},hit=document.elementFromPoint(point.x,point.y);
          if(hit&&(hit===element||element.contains(hit)))return point;
        }})()`,returnByValue:true,awaitPromise:true});
      const point = result.result?.value;
      if (!point) throw new Error(`missing native control: ${selector}`);
      await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
      await send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
    },
    /** Preserve visual evidence from the actual native editor window. */
    async screenshot(name, withData = false) {
      if (!process.env.ESKA_SCREENSHOT_DIR && !withData) return;
      const result = await send('Page.captureScreenshot', { format: 'png' });
      if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR, name), Buffer.from(result.data, 'base64'));
      if (withData) return result.data;
    },
    close() { socket.close(); },
  };
}

/** Give a preview the same available area as a measured form frame. */
async function allocateFormViewport(ui, [width, height]) {
  await ui.evaluate(`(() => {
    const viewport=document.querySelector('.preview-scroll'), css=getComputedStyle(viewport);
    Object.assign(viewport.style, {
      width:(${width}+8+parseFloat(css.paddingLeft)+parseFloat(css.paddingRight))+'px',
      height:(${height}+8+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom))+'px',
      minHeight:'0',flex:'0 0 auto'
    });
  })()`);
}

/** Wait for the read-only preview to acknowledge an unsaved XML edit. */
async function editFormSource(document, view, xml) {
  const current = document.getText();
  if (current === xml) return;
  const vscode = require('vscode');
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(current.length)), xml);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('Form XML edit was rejected');
  await until(() => view.phase === 'ready' && !view.running && !view.timer
    && view.snapshot.dependencies.some(dep => dep.role === 'form' && dep.version === String(document.version)), 'dirty form XML updated');
}

exports.frame = frame;
exports.sameSourcePath = sameSourcePath;
exports.until = until;
exports.allocateFormViewport = allocateFormViewport;
exports.editFormSource = editFormSource;
