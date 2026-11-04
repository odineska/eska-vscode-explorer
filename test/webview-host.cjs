const fs = require('node:fs/promises');
const path = require('node:path');
const publications = new WeakMap();

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
  let serial = 0;
  const pending = new Map(), contexts = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.executionContextCreated') contexts.push({ id: message.params.context.id, sessionId: message.sessionId, frameId:message.params.context.auxData?.frameId });
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
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      // Hidden Windows webviews can suspend evaluation; they must not block discovery of the active frame.
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`native debug timeout: ${method}`)); }, 5000);
      pending.set(id, { resolve, reject, timer, method, error: new Error(`native debug failure: ${method}`) }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  await send('Runtime.enable');
  const attached = new Set();
  let context;
  await until(async () => {
    const all = await send('Target.getTargets');
    for (const target of all.targetInfos.filter(item => item.type === 'iframe' && !attached.has(item.targetId))) {
      try {
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        attached.add(target.targetId);
        await send('Runtime.enable', {}, sessionId);
      } catch (error) {
        // A newly shown webview can replace its iframe between enumeration and attachment.
        attached.delete(target.targetId);
        if (!([-32602, -32000, -32001].includes(error?.code) && /(?:Session with given id not found|No target with given id found|No session with given id)/i.test(error.message))) throw error;
      }
    }
    for (const candidate of contexts) {
      try {
        const result = await send('Runtime.evaluate', { contextId: candidate.id, expression: `document.getElementById('title')?.textContent === ${JSON.stringify(tab.state.title)}`, returnByValue: true }, candidate.sessionId);
        if (result.result?.value) { context = candidate; return true; }
      } catch {}
    }
    return false;
  }, 'property frame');
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
    window.addEventListener('message',event=>{if(event.data?.type==='state')globalThis.__eskaNativeState=event.data;
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
  return {
    /** A file acknowledgement alone does not mean that the next control has been rendered. */
    async rendered() {
      await currentState(true);
    },
    /** Evaluate test code solely in this task's isolated property webview. */
    async evaluate(expression) {
      await currentState(false);
      const result = await send('Runtime.evaluate', { contextId: context.id, expression, returnByValue: true, awaitPromise: true }, context.sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    },
    /** Bring only the task's main workbench to the foreground for native editor commands. */
    async focusWorkbench() { await send('Page.bringToFront'); },
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
      const gone=error=>[-32602,-32000,-32001].includes(error?.code)&&/(?:Session with given id not found|No target with given id found|No session with given id)/i.test(error.message);
      let owner;
      await until(async()=>{
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
        const seen=new Set();let id=context.frameId;owner=undefined;
        while(id&&!seen.has(id)){
          if(windows.has(id)){
            owner=windows.get(id);
            // The native move command can finish before the webview is reparented.
            return !detached||owner.targetId!==workbenchTarget.id;
          }
          seen.add(id);id=parents.get(id);
        }
        return false;
      },'native window containing the webview frame');
      return owner;
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

exports.frame = frame;
exports.until = until;
