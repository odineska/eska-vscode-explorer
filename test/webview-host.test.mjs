import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {frame}=createRequire(import.meta.url)('./webview-host.cjs');

function debuggingEndpoint(t,{active='ready',title='Own preview',orphan=false}={}){
 const realTimeout=globalThis.setTimeout,commands=[],targets=[{id:'main',targetId:'main',type:'page',url:'vscode-file://own-main',webSocketDebuggerUrl:'ws://own-test'},{targetId:'hidden',type:'iframe'},{targetId:'floating',type:'page',url:'about:blank'},{targetId:'active',type:'iframe'}];
 // Exercise real timeout/reply routing, with a short clock only in this test process.
 t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>realTimeout(callback,ms===5000||ms===50?1:ms,...args));
 t.mock.method(globalThis,'fetch',async()=>({json:async()=>targets}));
 class Socket extends EventTarget{
  constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
  emit(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
  send(serialized){const request=JSON.parse(serialized);commands.push(request);queueMicrotask(()=>{
   const {id,method,params,sessionId}=request;let result={};
   if(method==='Target.getTargets')result={targetInfos:targets};
   else if(method==='Target.attachToTarget')result={sessionId:'session-'+params.targetId};
   else if(method==='Runtime.enable'&&sessionId){
    if(sessionId==='session-hidden'||active==='silent')return;
    if(active==='protocol-error'){this.emit({id,error:{code:-32099,message:'unexpected protocol error'}});return;}
    this.emit({method:'Runtime.executionContextCreated',sessionId,params:{context:{id:7,auxData:{frameId:'active-frame'}}}});
   }else if(method==='Runtime.evaluate')result={result:{value:params.expression.includes("document.getElementById('title')")?params.expression.includes(JSON.stringify(title)):true}};
   else if(method==='Page.getFrameTree'){
    const key=sessionId?.replace('session-','')??'main';
    result={frameTree:key==='main'?{frame:{id:'main-root'},childFrames:[{frame:{id:'hidden-wrapper'}}]}:key==='floating'?{frame:{id:'floating-root'},childFrames:[{frame:{id:'active-wrapper'}}]}:key==='hidden'?{frame:{id:'hidden-frame',parentId:'hidden-wrapper'}}:{frame:{id:'active-frame',parentId:orphan?'missing-parent':'active-wrapper'}}};
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
