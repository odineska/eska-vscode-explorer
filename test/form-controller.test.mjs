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
  controller.dispose();assert.equal(listeners.size,0);
});
