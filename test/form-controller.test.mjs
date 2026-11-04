import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

test('browser controller unwraps Solid store proxies before selection and navigation messages', async () => {
  const bundle = await build({ entryPoints:[fileURLToPath(new URL('../webview/forms/controller.js',import.meta.url))],
    bundle:true, write:false, platform:'browser', format:'cjs', conditions:['browser','production'], define:{'process.env.NODE_ENV':'"production"'} });
  const listeners = new Map(), messages = [], module = {exports:{}};
  const context = createContext({module,exports:module.exports,console,
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
    window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)} });
  runInContext(bundle.outputFiles[0].text,context);
  const controller = module.exports.controller({getState:()=>undefined,setState:()=>{},postMessage:value=>messages.push(structuredClone(value))});
  const identity = {source:'own',part:'current',key:{kind:'xml',value:'-9223372036854775808'}};
  const property = {key:{namespace:'form',name:'Title'},value:{kind:'text',text:'Own title'}};
  const incoming = {type:'state',sequence:1,model:{root:{identity,properties:[property],children:[],auxiliary:[]}}};
  // Browser JSON inputs and controller values must share their Object prototype.
  listeners.get('message')({data:runInContext(`(${JSON.stringify(incoming)})`,context)});
  const node = controller.state.model.root;
  assert.throws(()=>structuredClone(node.identity),/could not be cloned/,'the browser build must expose the real Solid proxy');
  context.controller=controller;
  runInContext("controller.select(controller.state.model.root);controller.post({type:'locate',target:{kind:'property',identity:controller.state.model.root.identity,property:controller.state.model.root.properties[0].key}})",context);
  assert.deepEqual(messages,[{type:'ready'},{type:'select',identity},{type:'locate',target:{kind:'property',identity,property:property.key}}]);
  assert.equal(controller.state.selected,'own:current:-9223372036854775808');
  const oldProperty = node.properties[0];
  const changed = structuredClone(incoming);changed.sequence=2;changed.model.root.properties[0].value.text='Updated title';
  listeners.get('message')({data:runInContext(`(${JSON.stringify(changed)})`,context)});
  assert.equal(controller.state.model.root.properties[0],oldProperty,'property records retain their DOM owner across new JSON key objects');
  assert.equal(oldProperty.value.text,'Updated title');
  assert.deepEqual(structuredClone(messages[2].target.property),property.key,'domain property keys remain unchanged');
  controller.dispose();assert.equal(listeners.size,0);
});

test('persisted selection identity survives loading before the restored model arrives', async () => {
  const bundle = await build({ entryPoints:[fileURLToPath(new URL('../webview/forms/controller.js',import.meta.url))],
    bundle:true, write:false, platform:'browser', format:'cjs', conditions:['browser','production'], define:{'process.env.NODE_ENV':'"production"'} });
  const listeners = new Map(), module = {exports:{}};
  let frame, saved;
  const context = createContext({module,exports:module.exports,console,
    requestAnimationFrame:callback=>{frame=callback;return 1;},cancelAnimationFrame:()=>{},
    window:{addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)} });
  runInContext(bundle.outputFiles[0].text,context);
  const identity = {source:'own',part:'current',key:{kind:'xml',value:'9223372036854775807'}};
  const previous = {schemaVersion:1,path:'/source/Form.xml',role:'preview',selection:identity,ui:{zoom:150,selected:'own:current:9223372036854775807'}};
  const controller = module.exports.controller({getState:()=>runInContext(`(${JSON.stringify(previous)})`,context),
    setState:value=>{saved=structuredClone(value);},postMessage:()=>{}});
  const loading = {type:'state',sequence:1,phase:'loading',restore:{path:'/source/Form.xml',role:'preview'}};
  listeners.get('message')({data:runInContext(`(${JSON.stringify(loading)})`,context)});frame();
  assert.deepEqual(saved.selection,identity,'loading must not overwrite the serialized identity with null');
  assert.equal(saved.ui.zoom,150);assert.equal(saved.model,undefined);
  const ready = {type:'state',sequence:2,selection:identity,model:{root:{identity,properties:[],children:[],auxiliary:[]}}};
  listeners.get('message')({data:runInContext(`(${JSON.stringify(ready)})`,context)});frame();
  assert.deepEqual(saved.selection,identity);assert.equal(saved.ui.selected,previous.ui.selected);
  controller.dispose();
});


test('shared preview navigation is restored before rendering without sharing layout or echoing updates', async () => {
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../webview/forms/controller.js',import.meta.url))],bundle:true,write:false,platform:'browser',format:'cjs',conditions:['browser','production'],define:{'process.env.NODE_ENV':'"production"'}});
  const listeners=new Map(),messages=[],module={exports:{}};
  let callback,saved;
  const context=createContext({module,exports:module.exports,console,requestAnimationFrame:value=>{callback=value;return 1;},cancelAnimationFrame:()=>{},window:{addEventListener:(name,value)=>listeners.set(name,value),removeEventListener:name=>listeners.delete(name)}});
  runInContext(bundle.outputFiles[0].text,context);
  const initial={ui:{pages:{'own:current:1':'own:current:2'},collapsed:{'own:current:10':true},zoom:150}};
  const controller=module.exports.controller({getState:()=>runInContext(`(${JSON.stringify(initial)})`,context),setState:value=>{saved=structuredClone(value);},postMessage:value=>messages.push(structuredClone(value))});
  assert.deepEqual(messages[0],{type:'ready',previewNavigation:{pages:initial.ui.pages,collapsed:initial.ui.collapsed}});
  const node=(kind,id,children=[])=>({kind,identity:{source:'own',part:'current',key:{kind:'xml',value:String(id)}},properties:[],children,auxiliary:[]});
  const root=node('Form',0,[node('Pages',1,[node('Page',2),node('Page',3)])]);
  const incoming={type:'state',sequence:1,selection:root.identity,model:{root},previewNavigation:{pages:{'own:current:1':'own:current:3'},collapsed:{}}};
  const receive=value=>listeners.get('message')({data:runInContext(`(${JSON.stringify(value)})`,context)});
  receive(incoming);callback();
  assert.equal(controller.state.ui.pages['own:current:1'],'own:current:3','root selection preserves the initialized page');
  assert.equal(controller.state.ui.collapsed['own:current:10'],undefined,'remote state replaces the old collapsed map');
  assert.equal(controller.state.ui.zoom,150);assert.equal(messages.length,1,'received navigation must not echo');
  context.controller=controller;
  runInContext("controller.ui('zoom',175);controller.ui('upper',320)",context);assert.equal(messages.length,1,'window layout stays local');
  runInContext("controller.ui('collapsed',{'own:current:10':true})",context);
  assert.deepEqual(messages.at(-1),{type:'previewNavigation',previewNavigation:{pages:{'own:current:1':'own:current:3'},collapsed:{'own:current:10':true}}});
  const count=messages.length;receive({type:'previewNavigation',previewNavigation:{pages:{'own:current:1':'own:current:2'},collapsed:{}}});callback();
  assert.equal(controller.state.ui.pages['own:current:1'],'own:current:2');assert.equal(controller.state.ui.zoom,175);assert.equal(controller.state.ui.upper,320);assert.equal(messages.length,count);
  assert.equal(saved.ui.pages['own:current:1'],'own:current:2');assert.equal(saved.ui.collapsed['own:current:10'],undefined);
  receive({type:'previewNavigation',previewNavigation:{pages:{invalid:2},collapsed:{}}});assert.equal(controller.state.ui.pages['own:current:1'],'own:current:2');
  controller.dispose();
});
