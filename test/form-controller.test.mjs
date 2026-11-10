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
  assert.throws(()=>structuredClone(node.identity),{name:'DataCloneError'},'the browser build must expose the real Solid proxy');
  context.formController=controller;
  runInContext("formController.select(formController.state.model.root);formController.post({type:'locate',target:{kind:'property',identity:formController.state.model.root.identity,property:formController.state.model.root.properties[0].key}})",context);
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
  context.formController=controller;
  runInContext("formController.ui('zoom',150);formController.ui('upper',320)",context);
  assert.equal(messages.length,1,'layout waits until the animation frame');
  runInContext("formController.ui('collapsed',{'own:current:10':true})",context);
  assert.deepEqual(messages.at(-1),{type:'previewNavigation',previewNavigation:{pages:{'own:current:1':'own:current:3'},collapsed:{'own:current:10':true}}});
  const count=messages.length;receive({type:'previewNavigation',previewNavigation:{pages:{'own:current:1':'own:current:2'},collapsed:{}}});callback();
  assert.equal(controller.state.ui.pages['own:current:1'],'own:current:2');
  assert.equal(controller.state.ui.zoom,150);
  assert.equal(controller.state.ui.upper,320);
  assert.equal(messages.length,count+1);
  assert.equal(messages[count].type,'inspectorState');
  assert.equal(messages[count].ui.upper,320);
  assert.equal(messages[count].ui.pages,undefined,'window preferences carry no shared page state');
  receive({type:'previewNavigation',previewNavigation:{pages:{'own:current:1':'own:current:2'},collapsed:{}}});callback();
  assert.equal(messages.length,count+1,'remote navigation does not echo');
  assert.equal(saved.ui.pages['own:current:1'],'own:current:2');assert.equal(saved.ui.collapsed['own:current:10'],undefined);
  receive({type:'previewNavigation',previewNavigation:{pages:{invalid:2},collapsed:{}}});assert.equal(controller.state.ui.pages['own:current:1'],'own:current:2');
  controller.dispose();
});

test('each incoming message publishes one coherent reactive snapshot', async () => {
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await build({
    stdin: {
      contents: `export { controller } from './webview/forms/controller.js';
        export { createRoot, createEffect } from 'solid-js';`,
      resolveDir: repository,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    conditions: ['browser', 'production'],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const listeners = new Map();
  const snapshots = [], paints = [];
  const module = { exports: {} };
  const context = createContext({
    module,
    exports: module.exports,
    console,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    observe: value => snapshots.push(structuredClone(value)),
    paint: sequence => paints.push(sequence),
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
    },
  });
  runInContext(bundle.outputFiles[0].text, context);
  context.formController = module.exports.controller({
    getState: () => undefined,
    setState: () => {},
    postMessage: () => {},
  });
  const receive = value => listeners.get('message')({
    data: runInContext(`(${JSON.stringify(value)})`, context),
  });
  const node = (kind, id, children = []) => ({
    kind,
    identity: { source: 'own', part: 'current', key: { kind: 'xml', value: String(id) } },
    properties: [],
    children,
    auxiliary: [],
  });
  const root = node('Form', 0, [node('Pages', 1, [node('Page', 2), node('Page', 3)]), node('UsualGroup', 10)]);
  root.properties.push({ key: { namespace: 'form', name: 'Width' }, value: { kind: 'text', text: '10' } });
  receive({ type: 'state', sequence: 1, formSessionId: 'first', revision: '1', culture: 'en-US', model: { root } });
  runInContext(`module.exports.createRoot(dispose => {
    globalThis.stopObserving = dispose;
    module.exports.createEffect(() => paint(formController.state.modelSequence));
    module.exports.createEffect(() => observe({
      sequence: formController.state.sequence,
      culture: formController.state.culture,
      width: formController.state.model.root.properties[0].value.text,
      selected: formController.state.selected,
      page: formController.state.ui.pages['own:current:1'],
      collapsed: formController.state.ui.collapsed['own:current:10']
    }));
  });`, context);
  snapshots.length = 0;

  const changed = structuredClone(root);
  changed.properties[0].value.text = '20';
  receive({
    type: 'state',
    sequence: 2,
    formSessionId: 'first',
    revision: '2',
    culture: 'ru-RU',
    model: { root: changed },
    selection: changed.children[0].children[1].identity,
    previewNavigation: { pages: { 'own:current:1': 'own:current:3' }, collapsed: { 'own:current:10': true } },
  });
  const expected = {
    sequence: 2, culture: 'ru-RU', width: '20', selected: 'own:current:3',
    page: 'own:current:3', collapsed: true,
  };
  assert.deepEqual(snapshots, [expected], 'effects must never observe a new revision with old model or navigation');

  snapshots.length = 0;
  receive({ type: 'state', sequence: 3, phase: 'updating' });
  assert.deepEqual(snapshots, [{ ...expected, sequence: 3 }]);
  assert.deepEqual(paints, [1, 2], 'a status message leaves model-dependent effects idle');
  snapshots.length = 0;
  receive({ type: 'state', sequence: 1, culture: 'en-US', model: { root } });
  assert.deepEqual(snapshots, [], 'an older message cannot partially replace the current state');

  receive({
    type: 'previewNavigation',
    previewNavigation: { pages: { 'own:current:1': 'own:current:2' }, collapsed: { 'own:current:10': false } },
  });
  assert.deepEqual(snapshots, [{ ...expected, sequence: 3, page: 'own:current:2', collapsed: false }]);
  // A detached frame handshake can resend the current snapshot to the main frame.
  receive({ type: 'state', sequence: 4, formSessionId: 'first', revision: '2', model: { root: changed } });
  assert.deepEqual(paints, [1, 2], 'the same session revision leaves model-dependent effects idle');
  receive({ type: 'state', sequence: 5, formSessionId: 'second', revision: '2', model: { root } });
  assert.deepEqual(paints, [1, 2, 5], 'the same revision number in a new session installs a new model');
  assert.equal(snapshots.at(-1).width, '10');
  runInContext('stopObserving(); formController.dispose();', context);
  assert.equal(listeners.size, 0);
});
