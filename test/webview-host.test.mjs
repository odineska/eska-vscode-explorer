import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {frame,sameSourcePath}=createRequire(import.meta.url)('./webview-host.cjs');

test('native source identity follows the host path rules',()=>{
  assert.equal(sameSourcePath('source/forms/../form.xml','source/form.xml'),true);
  assert.equal(sameSourcePath('source/form.xml','source/other.xml'),false);
  if(process.platform==='win32') {
    assert.equal(sameSourcePath('C:\\Fixture\\Form.xml','c:/Fixture/Form.xml'),true);
    assert.equal(sameSourcePath('C:\\Fixture\\Form.xml','D:\\Fixture\\Form.xml'),false);
    assert.equal(sameSourcePath(String.raw`\\?\C:\Fixture\Form.xml`,'c:/Fixture/Form.xml'),true);
    assert.equal(sameSourcePath(String.raw`\\?\UNC\server\share\Form.xml`,String.raw`\\server\share\Form.xml`),true);
  } else assert.equal(sameSourcePath('source/Form.xml','source/form.xml'),false);
});

function debuggingEndpoint(t,{active='ready',title='Own preview',orphan=false,mainClone=false,inProcess=false,replacedSession=false}={}){
 const realTimeout=globalThis.setTimeout,commands=[],targets=[{id:'main',targetId:'main',type:'page',url:'vscode-file://own-main',webSocketDebuggerUrl:'ws://own-test'},{targetId:'hidden',type:'iframe'},{targetId:'floating',type:'page',url:'about:blank'},...(mainClone?[{targetId:'old',type:'iframe'}]:[]),...(inProcess?[]:[{targetId:'active',type:'iframe'}])];
 // Exercise real timeout/reply routing, with a short clock only in this test process.
 t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>realTimeout(callback,ms===5000||ms===15000||ms===50?1:ms,...args));
 t.mock.method(globalThis,'fetch',async()=>({json:async()=>targets}));
 let activeSessions=0,activeEnables=0;
 class Socket extends EventTarget{
  constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
  emit(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
  send(serialized){const request=JSON.parse(serialized);commands.push(request);queueMicrotask(()=>{
   const {id,method,params,sessionId}=request;let result={};
   if(method==='Target.getTargets')result={targetInfos:targets};
   else if(method==='Target.attachToTarget')result={sessionId:'session-'+params.targetId+(replacedSession&&params.targetId==='active'?'#'+(++activeSessions):'')};
   else if(method==='Runtime.enable'&&sessionId){
    if(sessionId==='session-hidden'||active==='silent')return;
    if(active==='protocol-error'){this.emit({id,error:{code:-32099,message:'unexpected protocol error'}});return;}
    if(replacedSession&&sessionId.startsWith('session-active#')&&++activeEnables===1) {
     this.emit({method:'Runtime.executionContextCreated',sessionId,params:{context:{id:7,auxData:{frameId:'old-frame'}}}});
     this.emit({method:'Target.detachedFromTarget',params:{sessionId,targetId:'active'}});
     this.emit({id,result,sessionId});return;
    }
    if(sessionId==='session-floating') {
     this.emit({method:'Runtime.executionContextCreated',sessionId,params:{context:{id:9,auxData:{frameId:'floating-root'}}}});
     if(inProcess)this.emit({method:'Runtime.executionContextCreated',sessionId,params:{context:{id:7,auxData:{frameId:'active-frame'}}}});
    } else {
    this.emit({method:'Runtime.executionContextCreated',sessionId,params:{context:{id:sessionId==='session-old'?6:7,auxData:{frameId:sessionId==='session-old'?'old-frame':'active-frame'}}}});
    }
   }else if(method==='Runtime.evaluate')result={result:{value:params.expression.includes("document.getElementById('title')")?params.contextId!==9&&params.expression.includes(JSON.stringify(title)):params.expression==='context-session'?sessionId:true}};
   else if(method==='Page.getFrameTree'){
    const key=sessionId?.replace('session-','').replace(/#\d+$/,'')??'main';
    result={frameTree:key==='main'?{frame:{id:'main-root'},childFrames:[{frame:{id:'hidden-wrapper'}},...(mainClone?[{frame:{id:'old-wrapper'}}]:[])]}:key==='floating'?{frame:{id:'floating-root'},childFrames:[{frame:{id:'active-wrapper'},...(inProcess?{childFrames:[{frame:{id:'active-frame'}}]}:{})}]}:key==='old'?{frame:{id:'old-frame',parentId:'old-wrapper'}}:key==='hidden'?{frame:{id:'hidden-frame',parentId:'hidden-wrapper'}}:{frame:{id:'active-frame',parentId:orphan?'missing-parent':'active-wrapper'}}};
   }
   this.emit({id,result,sessionId});
  });}
  close(){this.dispatchEvent(new Event('close'));}
 }
 t.mock.method(globalThis,'WebSocket',function(){return new Socket();});
 return commands;
}

test('a suspended background iframe does not block discovery or exact floating-window ownership',async t=>{
 const commands=debuggingEndpoint(t),ui=await frame({state:{title:'Own preview'}});
 try{assert.equal(await ui.evaluate('true'),true);const owner=await ui.nativeWindow({detached:true});assert.equal(owner.targetId,'floating');assert.equal(owner.url,'about:blank');assert.equal(commands.filter(q=>q.method==='Runtime.enable'&&q.sessionId==='session-hidden').length,1);}
 finally{ui.close();}
});
test('silent active frames and genuine domain errors still fail discovery',async t=>{
 await t.test('all frames silent',async t=>{debuggingEndpoint(t,{active:'silent'});await assert.rejects(()=>frame({state:{title:'Own preview'}}),/property frame/);});
 await t.test('unexpected protocol error',async t=>{debuggingEndpoint(t,{active:'protocol-error'});await assert.rejects(()=>frame({state:{title:'Own preview'}}),{code:-32099});});
});
test('missing floating ancestry remains a failure with bounded ownership diagnostics',async t=>{
 debuggingEndpoint(t,{orphan:true});const ui=await frame({state:{title:'Own preview'}});
 try{await assert.rejects(()=>ui.nativeWindow({detached:true}),error=>error.message.startsWith('native window containing the webview frame')&&error.message.includes('missing-parent')&&error.message.includes('active-frame'));}
 finally{ui.close();}
});

test('a cloned floating preview ignores its same-titled old iframe in the main window',async t=>{
 debuggingEndpoint(t,{mainClone:true});const ui=await frame({detached:true,state:{title:'Own preview'}});
 try{assert.equal(await ui.evaluate('context-session'),'session-active');assert.equal((await ui.nativeWindow({detached:true})).targetId,'floating');}
 finally{ui.close();}
});

test('an in-process floating preview is discovered through its native page runtime',async t=>{
 debuggingEndpoint(t,{inProcess:true,mainClone:true});const ui=await frame({detached:true,state:{title:'Own preview'}});
 try{assert.equal(await ui.evaluate('context-session'),'session-floating');assert.equal((await ui.nativeWindow({detached:true})).targetId,'floating');}
 finally{ui.close();}
});

test('a replaced target session is reattached before selecting the floating context',async t=>{
 const commands=debuggingEndpoint(t,{replacedSession:true,mainClone:true});const ui=await frame({detached:true,state:{title:'Own preview'}});
 try{
  const session=await ui.evaluate('context-session');assert.ok(session.startsWith('session-active#'));assert.notEqual(session,'session-active#1');
  assert.equal(commands.filter(row=>row.method==='Runtime.enable'&&row.sessionId?.startsWith('session-active#')).length,2);
  assert.equal((await ui.nativeWindow({detached:true})).targetId,'floating');
 }finally{ui.close();}
});
