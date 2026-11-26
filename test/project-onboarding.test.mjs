import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
const url = new URL('../out/project-onboarding.js', import.meta.url), require = createRequire(url);
function load(overrides = {}) {
  const module = { exports: {} };
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})', { process, AbortController })(name => overrides[name] ?? (name === 'vscode' ? {} : name === './tooling/inspect.js' ? {} : require(name)), module, module.exports);
  return module.exports;
}
test('onboarding argv preserve paths and delegate artifact detection to the backend', () => {
  const { onboardingArguments, validProjectDirectory } = load();
  for (const type of ['configuration','extension','processing','report']) assert.deepEqual(Array.from(onboardingArguments({ action:'new', target:'/demo/Новый проект', type })), ['new','/demo/Новый проект','--type',type]);
  assert.deepEqual(Array.from(onboardingArguments({ action:'artifact', target:'/demo/new', artifact:'/demo/source.CF' })), ['new','/demo/new','--from','/demo/source.CF']);
  assert.deepEqual(Array.from(onboardingArguments({ action:'init', target:'/demo/project', source:'/demo/project/src' })), ['init','/demo/project','--source','src']);
  assert.deepEqual(Array.from(onboardingArguments({ action:'init', target:'/demo/project', source:'/demo/project' })), ['init','/demo/project','--source','.']);
  assert.deepEqual(Array.from(onboardingArguments({ action:'clone', target:'/demo/new', repository:'ssh://git@example.test/project' })), ['clone','ssh://git@example.test/project','/demo/new']);
  for (const value of ['..','../other','a/b','a\\b','.', '', 'a\0b','CON','NUL.txt','trailing.']) assert.equal(validProjectDirectory(value),false,value);
  assert.equal(validProjectDirectory('Проект #1'),true);
});
function setup(action, { language = 'en', existing = false, code = 0, trusted = true, cancel = false, wrapper = true, inventory = {schema_version:1,kind:'installed-platforms',platforms:[]}, platform = 'later', inventoryFailure = false, buildAvailable = true } = {}) {
  let command, picker = 0; const calls = [], opens = [], errors = [], warnings = [], picks = [], inputs = [], inventoryCalls = [];
  const vscode = { env:{language}, workspace:{isTrusted:trusted,getConfiguration:()=>({get:key=>key==='buildExecutable'?'/custom/eska-build':'/tools/eska-project'})}, Uri:{file:fsPath=>({scheme:'file',fsPath})},ProgressLocation:{Notification:1},
    commands:{registerCommand:(id,callback)=>{command=callback;return{dispose(){}}},executeCommand:async(...args)=>opens.push(args)},
    window:{showQuickPick:async (items,options)=>{picks.push({items,options});if(picker++===0)return items.find(item=>item.action===action);if(items.some(item=>'version' in item))return platform==='cancel'?undefined:items.find(item=>item.version===(platform==='later'?'':platform));return items[0]}, showOpenDialog:async options=>[{scheme:'file',fsPath:options.canSelectFiles?'/demo/source.cf':'/demo'}],
      showInputBox:async options=>{inputs.push(options);return options.title.includes('Git')?'https://example.test/repo':'Проект #1'}, showWarningMessage:async(...args)=>{warnings.push(args);return cancel?undefined:args[2]},showErrorMessage:value=>errors.push(value),showInformationMessage(){},
      withProgress:async(_options,task)=>task({report() {}}, {onCancellationRequested:()=>({dispose(){}})})}};
  const api = load({'vscode':vscode,'node:fs/promises':{realpath:async value=>value,lstat:async path=>{if(existing)return{};const error=new Error(path);error.code='ENOENT';throw error}},'./tooling/inspect.js':{findTool:async(configured,name)=>name==='eska'&&!wrapper||name==='eska-build'&&!buildAvailable?undefined:name==='eska-build'?configured:`/tools/${name}`},'./runtime-tools.js':{runtimeJson:async(binary,args)=>{inventoryCalls.push([binary,args]);if(inventoryFailure)throw new Error('inventory failed');return inventory},runtimeOutput:async(binary,args,options)=>{assert.equal(options.timeout,0);assert.equal(typeof options.onProgress,"function");calls.push([binary,args]);return{code,stdout:'not a path',stderr:''}}}});
  const disposable=api.registerProjectOnboarding({});
  return {run:()=>command(),calls,opens,errors,warnings,picks,inputs,inventoryCalls,disposable};
}
test('all four native routes use explicit project directory, both locales and selected destination', async()=>{
  for(const language of ['en','ru'])for(const action of ['new','artifact','init','clone']) {
    const state=setup(action,{language}); await state.run();
    assert.equal(state.errors.length,0,JSON.stringify({action,language,errors:state.errors}));assert.equal(state.calls.length,1);assert.equal(state.opens.length,1);
    const args=Array.from(state.calls[0][1]);assert.equal(args[0],'--project-dir');assert.equal(args[2],'--lang');assert.equal(args[3],language==='ru'?'ru-RU':'en-US');
    assert.equal(state.opens[0][0],'vscode.openFolder');assert.equal(state.opens[0][1].fsPath,action==='init'?'/demo':join('/demo','Проект #1'));
    assert.ok(state.warnings[0][1].modal);state.disposable.dispose();
  }
});
test('trust, existing destinations, cancellation and failed processes never open a project',async()=>{
  for(const options of [{trusted:false},{existing:true},{cancel:true},{code:1}]){
    const state=setup('new',options);await state.run();assert.equal(state.opens.length,0);assert.equal(state.calls.length,options.code===1?1:0);
  }
});

test('component fallback uses only supported operations', async () => {
  for (const action of ['new', 'init', 'clone']) {
    const state = setup(action, { wrapper: false }); await state.run();
    assert.equal(state.errors.length, 0); assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0][0], action === 'clone' ? '/tools/eska-vcs' : '/tools/eska-project');
    assert.ok(!state.calls[0][1].includes('--workflow'));
  }
  const artifact = setup('artifact', { wrapper: false }); await artifact.run();
  assert.equal(artifact.calls.length, 0); assert.equal(artifact.errors.length, 1);
});

const platforms = {schema_version:1,kind:'installed-platforms',platforms:[
  {version:'8.3.27.2325',ibcmd:'/opt/1c/ibcmd',source:{kind:'host'}},
  {version:'8.3.28.1000',ibcmd:'/opt/other/ibcmd',source:{kind:'distrobox',container:'one-c'}},
]};
test('installed platform picker preserves inventory order and keeps choose later last in both locales',async()=>{
  for(const language of ['ru','en'])for(const action of ['new','init','artifact']){
    const state=setup(action,{language,inventory:platforms,platform:'8.3.28.1000'});await state.run();
    assert.equal(state.errors.length,0);assert.equal(state.calls.length,1);
    const pick=state.picks.find(pick=>pick.items.some(item=>'version' in item));
    assert.deepEqual(Array.from(pick.items,item=>item.label),['8.3.27.2325','8.3.28.1000',language==='ru'?'Выбрать позже':'Choose later']);
    const args=Array.from(state.calls[0][1]);
    assert.deepEqual(args.slice(args.indexOf('--platform-version')),['--platform-version','8.3.28.1000','--ibcmd','/opt/other/ibcmd','--distrobox','one-c']);
    assert.ok(state.inventoryCalls[0][1].includes('--include-distrobox'));
    assert.ok(state.inputs.every(input=>!/platform|платформ/i.test(input.title)));
  }
});
test('choose later sends an explicit empty version for all creation modes with empty or unavailable inventories',async()=>{
  for(const action of ['new','init','artifact'])for(const options of [{},{inventory:null},{inventory:{schema_version:2,kind:'installed-platforms',platforms:platforms.platforms}},{inventoryFailure:true},{buildAvailable:false},{inventory:{schema_version:1,kind:'installed-platforms',platforms:[null,{}, {version:'bad',ibcmd:'/x',source:{kind:'host'}}]}}]){
    const state=setup(action,options);await state.run();assert.equal(state.calls.length,1);assert.equal(state.errors.length,0);
    const pick=state.picks.find(pick=>pick.items.some(item=>'version' in item));assert.equal(pick.items.length,1);assert.equal(pick.items[0].version,'');
    const args=Array.from(state.calls[0][1]);assert.deepEqual(args.slice(args.indexOf('--platform-version')),['--platform-version','']);
  }
});
test('cancelling platform selection aborts every creation mode before confirmation',async()=>{
  for(const action of ['new','init','artifact']){const state=setup(action,{inventory:platforms,platform:'cancel'});await state.run();assert.equal(state.calls.length,0);assert.equal(state.warnings.length,0);assert.equal(state.errors.length,0);}
});

test('a single host platform uses the configured inventory executable and preserves its exact paths',async()=>{
  const inventory={...platforms,platforms:[platforms.platforms[0]]};
  const state=setup('new',{inventory,platform:'8.3.27.2325'});await state.run();
  assert.equal(state.inventoryCalls[0][0],'/custom/eska-build');
  const pick=state.picks.find(pick=>pick.items.some(item=>'version' in item));assert.equal(pick.items.length,2);
  const args=Array.from(state.calls[0][1]);assert.deepEqual(args.slice(args.indexOf('--platform-version')),['--platform-version','8.3.27.2325','--ibcmd','/opt/1c/ibcmd']);
});

test('component fallback passes selected version without wrapper-only runner flags',async()=>{
  for(const action of ['new','init']){const state=setup(action,{wrapper:false,inventory:platforms,platform:'8.3.28.1000'});await state.run();assert.equal(state.errors.length,0);const args=Array.from(state.calls[0][1]);assert.deepEqual(args.slice(args.indexOf('--platform-version')),['--platform-version','8.3.28.1000']);}
});
