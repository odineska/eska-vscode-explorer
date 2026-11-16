import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { objectCapability, objectSchema, objectPlan } from '../out/metadata-object-protocol.js';
import { MetadataObjects } from '../out/metadata-objects.js';
import { plannedSource, verifyObjectSources } from '../out/metadata-object-review.js';
import { MetadataTree } from '../out/tree.js';
import { Connection } from '../out/connection.js';
import { ExplorerError } from '../out/protocol.js';
import { revealHit } from '../out/search.js';
import { createTreeProject } from './fixture.mjs';
import { editingSchema } from '../out/property-editing.js';
import { deferCleanup } from './cleanup.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const wire = value => ({ encoding: 'utf-8', value });
const original = '<Original/>\r\n';
const request = { operation: 'copy', source: 'original', name: 'Twin', parent: null, propertyValues: {}, propertyReferences: {}, propertyTypes: {} };
const schema = { schemaVersion: 1, parent: null, kinds: ['Catalog', 'CommonForm'], operations: ['create','copy','delete'],
  requiredProperties: {}, referenceProperties: {}, typeProperties: {}, uniqueProperties: {}, propertyCaptions: {},
  kindOptions: [{ key: 'catalog', value: 'Catalog', caption: { 'ru-RU': 'Справочник', 'en-US': 'Catalog' } },
    { key: 'common-form', value: 'CommonForm', caption: { 'ru-RU': 'Общая форма', 'en-US': 'Common form' } }] };
function planFor(request, referenced = false) {
  const deleted = request.operation === 'delete';
  return { schemaVersion: 1, valid: true, changed: true, operation: request.operation, objectId: deleted ? 'original' : 'twin',
    prepared: { request, sourceSnapshot: hash('inputs'), identities: deleted ? {} : { old: '11111111-1111-4111-8111-111111111111' }, expectedOutputSnapshot: hash('outputs') },
    files: [{ path: wire('owner.xml'), action: deleted ? 'delete' : 'update', before: { bytes: Buffer.byteLength(original), snapshot: hash(original) }, after: deleted ? null : { bytes: 10, snapshot: hash('outputs') } }],
    directories: [], inputs: [wire('owner.xml'), wire('module.bsl')], references: referenced ? [{ path: wire('module.bsl'), range: { start: 0, end: 4 }, reason: 'bsl_reference', confirmed: true }] : [] };
}

for (const locale of ['ru-RU','en-US']) test(`object schema retains backend captions and negotiates optional API 1.49: ${locale}`, () => {
  assert.equal(objectCapability({ capabilities: {} }), false);
  assert.equal(objectCapability({ apiVersion: { major: 1, minor: 49 }, capabilities: { metadataObjects: { schemaVersion: 1, enabled: true, preparedPlans: true } } }), true);
  assert.throws(() => objectCapability({ apiVersion: { major: 1, minor: 48 }, capabilities: { metadataObjects: { schemaVersion: 1, enabled: true, preparedPlans: true } } }), { code: 'protocolInvalid' });
  assert.equal(objectSchema(schema, null).kindOptions[0].caption[locale], locale === 'ru-RU' ? 'Справочник' : 'Catalog');
  assert.throws(() => objectSchema({ ...schema, parent: 'different' }, null), { code: 'protocolInvalid' });
});

test('kind-specific object discovery validates typed choices and their requested scope',()=>{
  const selected={...schema,selectedKind:'Catalog',initialFields:[{property:'Type',kind:'types',multiple:true,
    options:[{key:{namespace:'http://www.w3.org/2001/XMLSchema',name:'string'},caption:{'ru-RU':'Строка','en-US':'String'}}]}]};
  assert.equal(objectSchema(selected,null,'Catalog').initialFields.length,1);
  assert.throws(()=>objectSchema(selected,null,'CommonForm'),{code:'protocolInvalid'});
  for(const alter of [value=>value.initialFields[0].multiple=false,value=>value.initialFields[0].options[0].key.namespace=4,
    value=>delete value.initialFields[0].options[0].caption['ru-RU'],value=>delete value.initialFields]) {
    const value=structuredClone(selected);alter(value);assert.throws(()=>objectSchema(value,null,'Catalog'),{code:'protocolInvalid'});
  }
});

test('object plans reject malformed snapshots and all paths remain contained', () => {
  assert.equal(objectPlan(planFor(request)).operation, 'copy');
  for (const mutate of [value => value.prepared.sourceSnapshot = 'wrong', value => value.files[0].before.bytes = -1,
    value => value.inputs = [{ value: '../outside' }], value => value.prepared.request.propertyReferences = { Use: 'wrong' },
    value => value.references = [{ path: wire('file'), range: { start: 10, end: 1 }, reason: 'reference', confirmed: true }]]) {
    const value = structuredClone(planFor(request)); mutate(value); assert.throws(() => objectPlan(value), { code: 'protocolInvalid' });
  }
  const root = wire(resolve('.'));
  for (const path of ['../outside','./file','folder//file',resolve('/tmp/outside')]) assert.throws(() => plannedSource(root, wire(path)), { code: 'protocolInvalid' });
  assert.equal(plannedSource(root, wire('Catalogs/New.xml')), resolve('Catalogs/New.xml'));
});

async function fixture(t) {
  const root = await mkdtemp(join(process.env.ESKA_TEST_ROOT ?? resolve('../eska-playground'), 'explorer-objects-'));
  deferCleanup(t, () => rm(root, { recursive: true, force: true }));
  await writeFile(join(root,'owner.xml'),original); await writeFile(join(root,'module.bsl'),'// module');
  return root;
}
function harness(root, options = {}) {
  const calls = [], requests = [], messages = [], inputDefaults = [], inputTitles = [], inputValidations = [], schemaCalls = [], picks = [], progress = [], reviews = [];
  let dirty = options.dirty === 'before', current, ui, attempts = 0, inProgress=false;
  class Uri { constructor(scheme,path) { this.scheme=scheme;this.fsPath=path; } static file(path) { return new Uri('file',path); } }
  class CancellationTokenSource { token={isCancellationRequested:false};cancel(){this.token.isCancellationRequested=true;}dispose(){} }
  const api = { Uri, CancellationTokenSource, ViewColumn: { Active: 1 }, ProgressLocation: { Notification: 15 }, workspace: { isTrusted: true,
    textDocuments: [{ uri: Uri.file(join(root,'module.bsl')), get isDirty(){return dirty;} }] },
    window: {
      async withProgress(settings,task){
        assert.equal(inProgress,false);progress.push(settings);inProgress=true;
        if(options.dirty==='write-progress'&&progress.length===2)dirty=true;
        if(options.stale==='write-progress'&&progress.length===2){current=undefined;ui.stale();}
        try{return await task();}finally{inProgress=false;}
      },
      createWebviewPanel() {
        let receive, closed; let disposed=false;
        const panel={webview:{html:'', async postMessage(value){reviews.push(value); if(options.dirty==='review')dirty=true;
          if(options.changed)await writeFile(join(root,'owner.xml'),'changed'); if(options.stale===true){current=undefined;ui.stale();return;}
          receive({type:options.cancel?'cancel':'accept'});},onDidReceiveMessage(callback){receive=callback;queueMicrotask(()=>receive({type:'ready'}));return{dispose(){}};}},
          onDidDispose(callback){closed=callback;return{dispose(){}};},dispose(){if(disposed)return;disposed=true;closed?.();}};
        return panel;
      },
      async showInputBox(value){assert.equal(inProgress,false);inputDefaults.push(value.value);inputTitles.push(value.title);inputValidations.push(value.validateInput?.(""));return options.cancelInput===inputDefaults.length?undefined:options.inputs?.shift()??'Twin';},
      async showQuickPick(items,settings){assert.equal(inProgress,false);picks.push({items,settings});return options.pick?options.pick(items,settings):settings?.canPickMany?items:items.find(item=>item.object===options.template)??items[0];},
      async showInformationMessage(value){messages.push(value);},
      async showErrorMessage(value,...items){assert.equal(inProgress,false);messages.push(value);return options.retry?items[0]:undefined;},
    } };
  const project=options.entry?.project??{info:{root:{kind:'object',objectId:'root'},type:'configuration',sourcePath:wire(root)}};
  const entry=options.entry??{project,node:{id:{kind:'object',objectId:options.operation==='create'?'root':'original'},metadataKind:options.schema?.kindOptions[0]?.key??'catalog',parent:{kind:'collection',owner:'root',collection:{kind:'metadata',metadataKind:options.schema?.kindOptions[0]?.key??'catalog'}},label:{kind:'name',text:'Original'}}};
  const tree={ async children(owner){if(options.tree)return options.tree.children(owner);return options.template&&owner.node.id.objectId===(options.entry?.node.id.objectId??'root')?[{project,node:{id:{kind:'object',objectId:options.template},metadataKind:options.schema.kindOptions[0].key,label:{kind:'name',text:'Original'}}}]:[];}, async request(_project,method,params){calls.push(method);assert.equal(inProgress,method==='metadata/previewObject'||method==='metadata/applyObject');
    if(options.tree){if(method==='metadata/previewObject')requests.push(structuredClone(params.request));return options.tree.request(_project,method,params);}
    if(method==='metadata/objectSchema'){schemaCalls.push(structuredClone(params));return {...options.schema??schema,...params.kind?{selectedKind:params.kind,initialFields:options.initialFields??[]}:{} };}
    if(method==='metadata/previewObject'){requests.push(structuredClone(params.request));if(options.retry&&attempts++<(options.failures??1))throw new ExplorerError('requestFailed',options.retryDomain??'creation_collision',options.retryDetails);return planFor(params.request,options.referenced);}
    assert.equal(method,'metadata/applyObject');if(options.uncertain)throw new ExplorerError('connectionLost');
    return{schemaVersion:1,changed:true,objectId:params.prepared.request.operation==='delete'?'original':'twin',snapshot:params.prepared.expectedOutputSnapshot};
  } };
  current=tree;ui=new MetadataObjects(api,()=>options.readOnly===true);
  return{ui,calls,requests,messages,inputDefaults,inputTitles,inputValidations,schemaCalls,picks,progress,reviews,run:()=>ui.run(tree,entry,options.operation??'copy',()=>current,options.locale??'ru-RU',()=>{throw new Error('unexpected legacy creation');})};
}

for(const scenario of [{name:'dirty original input',dirty:'before'},{name:'dirty input during review',dirty:'review'},{name:'disk conflict',changed:true},
  {name:'cancelled review',cancel:true},{name:'readonly file',readOnly:true},{name:'replaced backend',stale:true},{name:'dirty input on entering write progress',dirty:'write-progress'},{name:'replaced backend on entering write progress',stale:'write-progress'}]) test(`object operation never writes after ${scenario.name}`,async t=>{
  const root=await fixture(t),value=harness(root,scenario);deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),undefined);assert.equal(value.calls.filter(call=>call==='metadata/applyObject').length,0);
});
for(const locale of ['ru-RU','en-US'])test(`object copy applies exactly once after a localized complete review: ${locale}`,async t=>{
  const root=await fixture(t),value=harness(root,{locale});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),'twin');assert.equal(value.calls.filter(call=>call==='metadata/applyObject').length,1);
  assert.ok(value.reviews[0].detail.includes('owner.xml'));assert.ok(value.reviews[0].detail.includes('11111111-1111-4111-8111-111111111111'));
  assert.deepEqual(value.progress.map(item=>[item.location,item.cancellable]),[[15,false],[15,false]]);
  assert.match(value.progress[0].title,locale==='ru-RU'?/Расчёт/:/Calculating/);
  assert.match(value.progress[1].title,locale==='ru-RU'?/Запись/:/Writing/);
});
test('deletion force follows explicit reference review and a second checked preview',async t=>{
  const root=await fixture(t),value=harness(root,{operation:'delete',referenced:true});deferCleanup(t,()=>value.ui.dispose());
  await value.run();assert.equal(value.requests.length,2);assert.equal(value.requests[0].force,false);assert.equal(value.requests[1].force,true);
  assert.ok(value.reviews[0].detail.includes('module.bsl'));assert.equal(value.calls.filter(call=>call==='metadata/applyObject').length,1);
});
test('validation failure keeps the entered name for correction',async t=>{
  const root=await fixture(t),value=harness(root,{retry:true,inputs:['Duplicate','Corrected']});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),'twin');assert.equal(value.inputDefaults[1],'Duplicate');assert.equal(value.requests[1].name,'Corrected');
});
test('invalid required values can be corrected without losing the name or entered fields',async t=>{
  const root=await fixture(t),value=harness(root,{operation:'create',retry:true,retryDomain:'object_invalid',
    schema:{...schema,kinds:['ScheduledJob'],kindOptions:[{key:'scheduled-job',value:'ScheduledJob',caption:{'ru-RU':'Регламентное задание','en-US':'Scheduled job'}}],
      requiredProperties:{'scheduled-job':['MethodName']},propertyCaptions:{MethodName:{'ru-RU':'Имя метода','en-US':'Method name'}}},
    inputs:['Bad.Value','NewJob','CommonModule.Tasks.Run']});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),'twin');assert.deepEqual(value.inputDefaults,['','','Bad.Value']);
  assert.equal(value.requests[1].name,'NewJob');assert.equal(value.requests[1].propertyValues.MethodName,'CommonModule.Tasks.Run');
});
for (const [kind,key,property,caption] of [['HTTPService','http-service','RootURL','Корневой URL'],['WebService','web-service','DescriptorFileName','Имя файла дескриптора']]) {
  for (const operation of ['copy','create']) test(`${kind} ${operation} corrects unique properties while preserving the name and prior input`,async t=>{
    const root=await fixture(t),value=harness(root,{operation,retry:true,failures:2,retryDomain:'object_property_conflict',
      retryDetails:{property,value:'original',objectId:'original'},template:operation==='create'?'original':undefined,
      schema:{...schema,kinds:[kind],kindOptions:[{key,value:kind,caption:{'ru-RU':kind,'en-US':kind}}],
        propertyCaptions:{[property]:{'ru-RU':caption,'en-US':property}}},
      inputs:['NewService','stillTaken','available']});deferCleanup(t,()=>value.ui.dispose());
    assert.equal(await value.run(),'twin');
    assert.deepEqual(value.inputDefaults,[operation==='copy'?'OriginalКопия':'','original','stillTaken']);
    assert.deepEqual(value.inputTitles,['Имя',caption,caption]);
    assert.deepEqual(value.requests.map(request=>request.name),['NewService','NewService','NewService']);
    assert.deepEqual(value.requests[2].propertyValues,{[property]:'available'});
    assert.equal(value.requests[2][operation==='copy'?'source':'template'],'original');
    assert.equal(value.calls.filter(call=>call==='metadata/applyObject').length,1);
    assert.ok(value.messages[0].includes(caption));
  });
}

for(const operation of ['copy','create'])for(const field of [
  {kind:'Method',key:'method',property:'HTTPMethod',before:'GET',after:'POST',caption:'HTTP-метод',
    choices:[{property:'HTTPMethod',kind:'values',multiple:false,options:[{value:'GET',caption:{'ru-RU':'GET','en-US':'GET'}},{value:'POST',caption:{'ru-RU':'POST','en-US':'POST'}}]}]},
  {kind:'URLTemplate',key:'url-template',property:'Template',before:'/original',after:'',caption:'Шаблон',choices:[]},
])test(`${operation} corrects scoped ${field.property} from the shared schema`,async t=>{
  const root=await fixture(t),parent='opaque-owner',source='opaque-source';
  const project={info:{root:{kind:'object',objectId:'root'},type:'configuration',sourcePath:wire(root)}};
  const entry={project,node:{id:{kind:'object',objectId:operation==='copy'?source:parent},metadataKind:field.key,
    parent:{kind:'collection',owner:operation==='copy'?parent:'root',collection:{kind:'metadata',metadataKind:field.key}},label:{kind:'name',text:'Original'}}};
  const value=harness(root,{operation,entry,retry:true,retryDomain:'object_property_conflict',retryDetails:{property:field.property,value:field.before},
    template:operation==='create'?source:undefined,initialFields:field.choices,
    schema:{...schema,parent,kinds:[field.kind],kindOptions:[{key:field.key,value:field.kind,caption:{'ru-RU':field.kind,'en-US':field.kind}}],
      uniqueProperties:{[field.key]:[field.property]},propertyCaptions:{[field.property]:{'ru-RU':field.caption,'en-US':field.property}}},
    inputs:field.choices.length?['Twin']:['Twin',''],pick(items){return items.find(item=>item.object===source || item.value===field.after)??items[0];}});
  deferCleanup(t,()=>value.ui.dispose());assert.equal(await value.run(),'twin');
  assert.deepEqual(value.requests.map(request=>request.name),['Twin','Twin']);
  assert.deepEqual(value.requests[1].propertyValues,{[field.property]:field.after});
  assert.equal(value.requests[1][operation==='copy'?'source':'template'],source);
  assert.ok(value.schemaCalls.every(call=>call.parent===parent));
  assert.equal(value.schemaCalls.at(-1).kind,field.kind);
  if(field.choices.length){
    assert.equal(value.inputDefaults.length,1);const picked=value.picks.at(-1);
    assert.equal(picked.settings.title,field.caption);assert.equal(picked.items[0].picked,true);
  }else{
    assert.equal(value.inputTitles[1],field.caption);assert.equal(value.inputValidations[1],undefined);
  }
});

test('cancelling a unique property correction never publishes the incomplete copy',async t=>{
  const root=await fixture(t),value=harness(root,{retry:true,retryDomain:'object_property_conflict',
    retryDetails:{property:'RootURL',value:'original'},cancelInput:2});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),undefined);
  assert.equal(value.calls.filter(call=>call==='metadata/applyObject').length,0);
});

for (const field of [
  {property:'Source',kind:'types',multiple:true,options:[{key:{namespace:'http://v8.1c.ru/8.1/data/enterprise/current-config',name:'DocumentObject.Loan'},caption:{'ru-RU':'ДокументОбъект. Выдача займа','en-US':'Document object. Loan'}}]},
  {property:'Documents',kind:'references',multiple:true,options:[{value:'Document.Loan',caption:{'ru-RU':'Выдача займа','en-US':'Loan'}}]},
  {property:'Task',kind:'references',multiple:false,options:[{value:'Task.Initial',caption:{'ru-RU':'Первая','en-US':'Initial'}},{value:'Task.Followup',caption:{'ru-RU':'Следующая','en-US':'Followup'}}]},
  {property:'Group',kind:'values',multiple:false,options:[{value:'ActionsPanelTools',caption:{'ru-RU':'Сервис','en-US':'Tools'}},{value:'FormCommandBarImportant',caption:{'ru-RU':'Важное','en-US':'Important'}}]},
]) test(`initial ${field.kind}/${field.property} choices preserve checked identities and input on retry`,async t=>{
  const root=await fixture(t);
  let selections=0;
  const value=harness(root,{operation:'create',retry:true,retryDomain:'object_invalid',initialFields:[field],
    schema:{...schema,kinds:['EventSubscription'],
      kindOptions:[{key:'event-subscription',value:'EventSubscription',caption:{'ru-RU':'Подписка на событие','en-US':'Event subscription'}}],
      requiredProperties:{'event-subscription':[field.property]},
      typeProperties:field.kind==='types'?{'event-subscription':[field.property]}:{},
      referenceProperties:field.kind==='references'&&field.multiple?{'event-subscription':[field.property]}:{}},
    inputs:['NewObject'],pick(items,settings){
      assert.equal(settings.matchOnDescription,true);
      if(selections++===0) assert.equal(items.every(item=>!item.picked),true);
      else assert.equal(items[0].picked,true);
      return field.multiple?items:selections===1?items.at(-1):items[0];
    }});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),'twin');assert.equal(selections,2);
  assert.deepEqual(value.inputDefaults,['']);
  const request=value.requests[1];
  assert.equal(request.name,'NewObject');
  if(field.kind==='types')assert.deepEqual(request.propertyTypes,{Source:field.options.map(option=>option.key)});
  else if(field.multiple)assert.deepEqual(request.propertyReferences,{[field.property]:field.options.map(option=>option.value)});
  else assert.deepEqual(request.propertyValues,{[field.property]:field.options.at(-1).value});
});

test('missing initial choices explain the dependency and never fall back to manual XML names',async t=>{
  const root=await fixture(t),value=harness(root,{operation:'create',initialFields:[{property:'Task',kind:'references',multiple:false,options:[]}],
    schema:{...schema,kinds:['BusinessProcess'],kindOptions:[{key:'business-process',value:'BusinessProcess',caption:{'ru-RU':'Бизнес-процесс','en-US':'Business process'}}],
      requiredProperties:{'business-process':['Task']}}});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),undefined);assert.equal(value.requests.length,0);
  assert.equal(value.inputDefaults.length,0);assert.ok(value.messages.some(message=>message.includes('подходящих объектов')));
});

test('a source buffer made dirty during asynchronous hashing blocks publication',async t=>{
  const root=await fixture(t);let dirty=false,checks=0;
  const api={Uri:{file:fsPath=>({scheme:'file',fsPath})},workspace:{textDocuments:[{uri:{scheme:'file',fsPath:join(root,'module.bsl')},get isDirty(){return dirty;}}]}};
  await assert.rejects(verifyObjectSources(api,wire(root),planFor(request),()=>false,()=>{if(++checks===2)dirty=true;}),{domain:'creation_dirty_source'});
});

test('lost object acknowledgement reports uncertainty and never retries',async t=>{
  const root=await fixture(t),value=harness(root,{uncertain:true});deferCleanup(t,()=>value.ui.dispose());
  assert.equal(await value.run(),undefined);assert.equal(value.calls.filter(call=>call==='metadata/applyObject').length,1);assert.ok(value.messages.some(text=>text.includes('не подтверждён')));
});

for(const method of ['metadata/applyObject','metadata/applyFormEdit']) test(`${method} is never retried after a stale generation`,async()=>{
  let calls=0;const project={info:{projectId:'project',generation:'1',eventSequence:'1'}};
  const tree=Object.assign(Object.create(MetadataTree.prototype),{session:{sessionId:'session'},scopes:new Map(),async drainInputs(){},
    connection:{async request(){calls++;throw new ExplorerError('requestFailed','stale_generation');}}});
  await assert.rejects(tree.request(project,method));assert.equal(calls,1);
});

const executable=process.env.ESKA_TEST_BINARY;
for(const locale of ['ru-RU','en-US'])test(`real Rust object/form creation, copying, removal and reveal: ${locale}`,{skip:!executable},async t=>{
  const root=await fixture(t),fixtureSource=await createTreeProject(root);
  await mkdir(join(fixtureSource.source,'Ext'),{recursive:true});await writeFile(join(fixtureSource.source,'Ext','ParentConfigurations.bin'),'{6,0,0,0,0,0}');
  const connection=new Connection('test',()=>{},()=>{});deferCleanup(t,()=>connection.dispose());await connection.connect({executable,path:root,locale,name:'objects'});
  const state=connection.state;assert.equal(state.kind,'ready');assert.equal(state.metadataObjects,true);
  const tree=new MetadataTree(connection,state.session,()=>{},()=>{});deferCleanup(t,()=>tree.dispose());const project=tree.projects[0];
  const discovery=objectSchema(await tree.request(project,'metadata/objectSchema',{parent:null}),null);
  assert.ok(discovery.kindOptions.find(option=>option.key==='common-form').caption[locale]);
  assert.deepEqual(discovery.uniqueProperties['http-service'],['RootURL']);
  assert.deepEqual(discovery.uniqueProperties['web-service'],['DescriptorFileName']);
  for(const [kind,property,choiceKind] of [['EventSubscription','Source','types'],['FunctionalOptionsParameter','Use','references'],['CommonCommand','Group','values']]) {
    const selected=objectSchema(await tree.request(project,'metadata/objectSchema',{parent:null,kind}),null,kind);
    const field=selected.initialFields.find(field=>field.property===property);assert.equal(field.kind,choiceKind);
    assert.ok(field.options.length);assert.ok(field.options.every(option=>typeof option.caption[locale]==='string'));
    if(choiceKind==='types')assert.ok(field.options.some(option=>option.key.name==='CatalogObject.Товары'));
    if(choiceKind==='references')assert.ok(field.options.some(option=>option.value==='Catalog.Товары'));
  }
  const input={operation:'create',kind:'CommonForm',name:'FormThroughExplorer',parent:null,template:null,propertyValues:{},propertyReferences:{},propertyTypes:{}};
  const plan=objectPlan(await tree.request(project,'metadata/previewObject',{request:input}));assert.deepEqual(plan.prepared.request,input);assert.ok(plan.inputs.length);
  const result=await tree.request(project,'metadata/applyObject',{prepared:plan.prepared});
  const created=await revealHit(tree,project,{objectId:result.objectId,node:{kind:'object',objectId:result.objectId}});assert.equal(created.node.label.text,input.name);
  const formSchema=await tree.request(project,'metadata/formEditSchema',{form:result.objectId});assert.equal(formSchema.writable,true);
  const copy=objectPlan(await tree.request(project,'metadata/previewObject',{request:{operation:'copy',source:result.objectId,name:'FormTwin',parent:null,propertyValues:{},propertyReferences:{},propertyTypes:{}}}));
  assert.notEqual(Object.values(copy.prepared.identities)[0],Object.values(plan.prepared.identities)[0]);
  const copied=await tree.request(project,'metadata/applyObject',{prepared:copy.prepared});
  assert.deepEqual(await readFile(join(fixtureSource.source,'CommonForms',input.name,'Ext','Form.xml')),await readFile(join(fixtureSource.source,'CommonForms','FormTwin','Ext','Form.xml')));
  const deletion=objectPlan(await tree.request(project,'metadata/previewObject',{request:{operation:'delete',object:copied.objectId,force:false}}));
  await tree.request(project,'metadata/applyObject',{prepared:deletion.prepared});
  await assert.rejects(readFile(join(fixtureSource.source,'CommonForms','FormTwin.xml')),error=>error.code==='ENOENT');
  assert.ok(await readFile(join(fixtureSource.source,'CommonForms',input.name+'.xml')));

  for (const [kind,property,folder] of [['HTTPService','RootURL','HTTPServices'],['WebService','DescriptorFileName','WebServices']]) {
    const originalName=`Original${kind}`;
    const creating=objectPlan(await tree.request(project,'metadata/previewObject',{request:{...input,kind,name:originalName}}));
    const original=await tree.request(project,'metadata/applyObject',{prepared:creating.prepared});
    const sourcePath=join(fixtureSource.source,folder,originalName+'.xml');
    const before=await readFile(sourcePath,'utf8');
    for(const operation of ['copy','create']) {
      const request=operation==='copy'
        ? {operation,source:original.objectId,name:`Copied${kind}`,parent:null,propertyValues:{},propertyReferences:{},propertyTypes:{}}
        : {...structuredClone(input),kind,name:`Templated${kind}`,template:original.objectId};
      let conflict;
      await assert.rejects(tree.request(project,'metadata/previewObject',{request}),error=>{
        assert.equal(error.domain,'object_property_conflict');assert.equal(error.details.property,property);
        assert.equal(typeof error.details.value,'string');conflict=error.details;return true;
      });
      request.propertyValues[property]=`${operation}-${conflict.value}`;
      const retry=objectPlan(await tree.request(project,'metadata/previewObject',{request}));
      await tree.request(project,'metadata/applyObject',{prepared:retry.prepared});
      const copy=await readFile(join(fixtureSource.source,folder,request.name+'.xml'),'utf8');
      assert.ok(copy.includes(`<${property}>${request.propertyValues[property]}</${property}>`));
      assert.equal(await readFile(sourcePath,'utf8'),before);
    }
  }

  // Exercise the same structured changes used by the host's native multi-select dialogs.
  for (const [kind,name,property,changeKind] of [['Constant','TypedSetting','Type','types'],['Subsystem','ObjectSelection','Content','references']]) {
    const creating = objectPlan(await tree.request(project,'metadata/previewObject',{
      request:{...input,kind,name}
    }));
    const object = await tree.request(project,'metadata/applyObject',{prepared:creating.prepared});
    const editing = editingSchema(await tree.request(project,'metadata/propertyEditing',{objectId:object.objectId}));
    const field = editing.fields.find(field=>field.path.at(-1).key.name===property && field.schema.kind===changeKind);
    assert.ok(field,`${kind}.${property} has a writable structured schema`);
    const choices = await tree.request(project,changeKind==='types'?'metadata/propertyTypeChoices':'metadata/propertyReferenceChoices',{
      objectId:object.objectId,path:field.path
    });
    const selected = choices.choices.filter(choice=>changeKind==='types'
      ? choice.key.namespace==='http://www.w3.org/2001/XMLSchema' && ['string','boolean'].includes(choice.key.name)
      : ['Catalog.Товары','Catalog.Покупатели'].includes(choice.value));
    assert.equal(selected.length,2);
    const change = changeKind==='types' ? {kind:changeKind,keys:selected.map(choice=>choice.key)}
      : {kind:changeKind,values:selected.map(choice=>choice.value)};
    const updated = await tree.request(project,'metadata/updateProperty',{
      objectId:object.objectId,snapshot:editing.snapshot,path:field.path,change,
      ...(field.linked ? {contextSnapshot:editing.contextSnapshot} : {})
    });
    const current = editingSchema(updated.editing).fields.find(item=>JSON.stringify(item.path)===JSON.stringify(field.path));
    assert.deepEqual(changeKind==='types'?current.schema.keys:current.schema.values,changeKind==='types'?change.keys:change.values);
    const xml = await readFile(join(fixtureSource.source,kind==='Constant'?'Constants':'Subsystems',name+'.xml'),'utf8');
    for (const value of changeKind==='types'?[':string</',':boolean</']:change.values) assert.ok(xml.includes(value),`${kind}.${property} persists ${value}`);
  }
});

for(const locale of ['ru-RU','en-US'])test(`real object wizard fills required child properties in the selected owner: ${locale}`,{skip:!executable},async t=>{
  const root=await fixture(t),source=await createTreeProject(root);
  await mkdir(join(source.source,'Ext'),{recursive:true});await writeFile(join(source.source,'Ext','ParentConfigurations.bin'),'{6,0,0,0,0,0}');
  const connection=new Connection('test',()=>{},()=>{});deferCleanup(t,()=>connection.dispose());await connection.connect({executable,path:root,locale,name:'child-objects'});
  const state=connection.state;assert.equal(state.kind,'ready');
  const tree=new MetadataTree(connection,state.session,()=>{},()=>{});deferCleanup(t,()=>tree.dispose());const project=tree.projects[0];
  async function seed(kind,name,parent=null,propertyReferences={},propertyValues={}) {
    const request={operation:'create',kind,name,parent,template:null,propertyValues,propertyReferences,propertyTypes:{}};
    const plan=objectPlan(await tree.request(project,'metadata/previewObject',{request}));
    const result=await tree.request(project,'metadata/applyObject',{prepared:plan.prepared});
    return revealHit(tree,project,{objectId:result.objectId,node:{kind:'object',objectId:result.objectId}});
  }
  async function create(owner,kind,name,property,answer) {
    const parent=owner.node.id.objectId;
    const schema=objectSchema(await tree.request(project,'metadata/objectSchema',{parent,kind}),parent,kind);
    const expected=property?schema.propertyCaptions[property][locale]:undefined;
    const value=harness(root,{operation:'create',tree,entry:owner,locale,
      inputs:property&&!Array.isArray(answer)?[answer,name]:[name],
      pick(items,settings){
        if(settings.canPickMany) return items.filter(item=>answer.includes(item.value));
        return items.find(item=>item.option?.value===kind)??items[0];
      }});deferCleanup(t,()=>value.ui.dispose());
    const object=await value.run();assert.ok(object,JSON.stringify(value.messages));
    assert.equal(value.requests.length,1);assert.equal(value.requests[0].parent,parent);
    assert.equal(value.requests[0].name,name);assert.equal(value.reviews.length,1);
    if(property){
      if(Array.isArray(answer)) {
        assert.deepEqual(value.requests[0].propertyReferences,{[property]:answer});
        assert.ok(value.picks.some(pick=>pick.settings.title===expected && pick.settings.canPickMany));
      }else{
        assert.deepEqual(value.requests[0].propertyValues,{[property]:answer});assert.equal(value.inputTitles[0],expected);
      }
      if(locale==='ru-RU')assert.notEqual(expected,property);
    }
    return revealHit(tree,project,{objectId:object,node:{kind:'object',objectId:object}});
  }
  const http=await seed('HTTPService','Http');
  const template=await seed('URLTemplate','Route',http.node.id.objectId,{}, {Template:'/source'});
  const method=await create(template,'Method','Read','Handler','HandleRequest');
  async function correct(source,owner,kind,operation,name,property,answer,enumeration) {
    const value=harness(root,{operation,tree,entry:operation==='copy'?source:owner,locale,retry:true,
      inputs:enumeration?[name]:[name,answer],pick(items){
        return items.find(item=>item.option?.value===kind || item.object===source.node.id.objectId || item.value===answer)??items[0];
      }});deferCleanup(t,()=>value.ui.dispose());
    const object=await value.run();assert.ok(object,JSON.stringify(value.messages));
    assert.deepEqual(value.requests.map(request=>request.name),[name,name]);
    assert.deepEqual(value.requests[1].propertyValues,{[property]:answer});
    if(enumeration) {
      assert.equal(value.inputDefaults.length,1);
      assert.ok(value.picks.at(-1).items.some(item=>item.value==='GET'));
      assert.ok(value.picks.at(-1).items.some(item=>item.value==='POST'));
    } else assert.equal(value.inputValidations[1],undefined);
    const result=await revealHit(tree,project,{objectId:object,node:{kind:'object',objectId:object}});
    assert.equal(result.node.parent.kind==='object'?result.node.parent.objectId:result.node.parent.owner,owner.node.id.objectId);
  }
  await correct(method,template,'Method','copy','Post','HTTPMethod','POST',true);
  await correct(method,template,'Method','create','Patch','HTTPMethod','PATCH',true);
  await correct(template,http,'URLTemplate','copy','EmptyRoute','Template','',false);
  await correct(template,http,'URLTemplate','create','OtherRoute','Template','/another',false);
  const blank=harness(root,{operation:'create',tree,entry:template,locale,retry:true,inputs:['HandleDelete','Delete'],
    pick(items){return items.find(item=>item.option?.value==='Method' || item.object===null || item.value==='DELETE')??items[0];}});
  deferCleanup(t,()=>blank.ui.dispose());assert.ok(await blank.run(),JSON.stringify(blank.messages));
  assert.deepEqual(blank.requests.map(request=>request.name),['Delete','Delete']);
  assert.deepEqual(blank.requests[1].propertyValues,{Handler:'HandleDelete',HTTPMethod:'DELETE'});
  const web=await seed('WebService','Web');
  const operation=await create(web,'Operation','Execute','ProcedureName','ExecuteOperation');
  await create(operation,'Parameter','Argument');
  const webXml=await readFile(join(source.source,'WebServices','Web.xml'),'utf8');
  assert.match(webXml,/<XDTOValueType>xs:string<\/XDTOValueType>/);
  const document=await seed('Document','Posted');
  await seed('Attribute','Amount',document.node.id.objectId);
  const journal=await seed('DocumentJournal','Journal',null,{RegisteredDocuments:['Document.Posted']});
  await create(journal,'Column','Amount','References',['Document.Posted.Attribute.Amount']);
  const xml=await readFile(join(source.source,'DocumentJournals','Journal.xml'),'utf8');
  assert.ok(xml.includes('Document.Posted.Attribute.Amount'));
});
