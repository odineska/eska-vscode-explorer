import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { formCapabilities, isIdentity, identityKey, parseFormSnapshot, parseFormPreparation, parseHandlerSource, parsePropertyPalette } from '../out/form-preview/protocol.js';
import { prepare, fieldWidth, flatten, treeChildren, find, text, caption, font, color, automaticCommands, localizedProperty, pageSelections } from '../webview/forms/model.mjs';
import { formStrings } from '../out/form-preview/strings.js';
import { parsePreviewNavigation } from '../out/form-preview/navigation.js';

const source = 'a'.repeat(64);
function fixture() {
  const origin = { source, range: { start: 0, end: 200 } };
  const font = { face: null, points: 10, weight: 400, italic: false, underline: false, strikeout: false, origins: [] };
  const role = { kind: 'role', value: 'TextColor' };
  const presentation = { picture: null, titleLocation: 'Left', displayed: true, grouping: 'Vertical', caption: { kind: 'name', text: 'Форма' }, tooltip: null, font, titleFont: font,
    foreground: role, background: role, border: role, titleColor: role, valueType: { kind: 'string', length: null, digits: null, fraction: null, dateParts: null, types: [] },
    binding: null, choices: [], autoCommands: [] };
  const root = { identity: { source, part: 'current', key: { kind: 'root' } }, origin, kind: 'Form', name: null,
    xmlName: { namespace: 'http://v8.1c.ru/8.3/xcf/logform', name: 'Form' }, properties: [], presentation, children: [], auxiliary: [] };
  return { formSessionId: 'f1', revision: '1', contextFingerprint: source, application: null, profile: 'taxi-8.3.27', limitedContext: false, modelComplete: true,
    status: 'ready', lastError: null, dependencies: [{ id: source, root: { encoding: 'utf-8', value: '/project/src' }, path: { encoding: 'utf-8', value: 'Form.xml' }, snapshot: source, version: null, member: null, role: 'form' }],
    model: { importantColor: {kind:"role",value:"ImportantColor"}, root, assets: [], attributes: [], commands: [], parameters: [], diagnostics: { composition: [], appearance: [] } } };
}

test('both preview windows validate the same navigation snapshot', () => {
  const navigation = { pages: { 'source:pages': 'source:page' }, collapsed: { 'source:group': true } };
  const parsed = parsePreviewNavigation(navigation);
  assert.deepEqual(parsed, navigation);
  assert.notEqual(parsed.pages, navigation.pages);
  assert.equal(parsePreviewNavigation({ ...navigation, pages: [] }), undefined);
  assert.equal(parsePreviewNavigation({ ...navigation, collapsed: { 'source:group': 'true' } }), undefined);
  assert.equal(parsePreviewNavigation({ ...navigation, pages: { invalid: 'source:page' } }), undefined);
});

test('tabular total captions use the viewer locale and preserve form overrides', () => {
  const input = fixture(), node = input.model.root;
  node.presentation.caption = { kind: 'literal', items: [
    { language: 'ru', content: 'Количество' }, { language: 'en', content: 'Quantity' },
  ] };
  node.presentation.tabularTotal = 'automatic';
  assert.equal(parseFormSnapshot(input).model.root.presentation.tabularTotal, 'automatic');
  assert.equal(caption(node, { locale: 'ru-RU', strings: formStrings('ru-RU') }), 'Количество (итог)');
  assert.equal(caption(node, { locale: 'en-US', strings: formStrings('en-US') }), 'Quantity (total)');
  node.presentation.tabularTotal = 'overridden';
  assert.equal(caption(node, { locale: 'ru-RU', strings: formStrings('ru-RU') }), 'Количество');
  node.presentation.tabularTotal = true;
  assert.throws(() => parseFormSnapshot(input));
});

test('optional table column appearance validates color and font values', () => {
  const input = fixture(), presentation = input.model.root.presentation;
  const color = {kind: 'web', value: 'LightPink'};
  presentation.tableColumnAppearance = {footerBackground: color, footerFont: {...presentation.font, points: 14}};
  assert.deepEqual(parseFormSnapshot(input).model.root.presentation.tableColumnAppearance, presentation.tableColumnAppearance);
  for (const invalid of [{footerForeground: null}, {footerFont: {points: 14}}, null]) {
    presentation.tableColumnAppearance = invalid;
    assert.throws(() => parseFormSnapshot(input));
  }
});

test('form identities preserve signed XML i64 boundaries without JavaScript rounding', () => {
  for (const value of ['-9223372036854775808', '9223372036854775807', '-1', '0']) {
    const identity = { source, part: 'current', key: { kind: 'xml', value } };
    assert.equal(isIdentity(identity), true); assert.ok(identityKey(identity).endsWith(`:${value}`));
  }
  for (const value of ['9223372036854775808', '-9223372036854775809', '01', '1.2', 1]) assert.equal(isIdentity({ source, part: 'current', key: { kind: 'xml', value } }), false);
});

test('form capability negotiation requires a static read-only profile and bounds uploads', () => {
  assert.equal(formCapabilities({ capabilities: {} }), undefined);
  const value = { apiVersion: { major: 1, minor: 40 }, capabilities: { formPreview: { inputPreparation: true, pictures: true, schemaVersion: 1, profile: 'taxi-8.3.27', readOnly: true, executesBsl: false,
    uploads: 'queryBuffers', maxSessions: 32, maxOverlayBytes: 16777216, maxInlineBytes: 262144 } } };
  assert.equal(formCapabilities({...value,apiVersion:{major:1,minor:36}}),undefined);
  assert.equal(formCapabilities({...value,apiVersion:{major:1,minor:37}}),undefined);
  for (const minor of [38,39]) assert.equal(formCapabilities({...value,apiVersion:{major:1,minor}}),undefined);
  assert.throws(()=>formCapabilities({...value,apiVersion:{major:2,minor:36}}));
  assert.deepEqual(formCapabilities(value), { maxSessions: 16, maxOverlayBytes: 8388608, maxInlineBytes: 131072 });
  for (const patch of [{ inputPreparation: false }, { executesBsl: true }, { readOnly: false }, { profile: 'taxi-8.5' }, { maxSessions: -1 }]) assert.throws(() => formCapabilities({ ...value, capabilities: { formPreview: { ...value.capabilities.formPreview, ...patch } } }));
});

test('form preparation validates bounded roots and source ownership without a model', () => {
  const root={value:'/source',encoding:'utf-8'},path={value:'CommonForms/Preview/Ext/Form.xml',encoding:'utf-8'};
  const value={contextFingerprint:source,application:null,limitedContext:false,roots:[root],forms:[{id:source,root,path}]};
  assert.equal(parseFormPreparation(value).forms[0].id,source);
  for (const patch of [{roots:[]},{forms:[]},{forms:[value.forms[0],value.forms[0]]},{forms:[{...value.forms[0],root:{value:'/foreign',encoding:'utf-8'}}]},{contextFingerprint:'bad'}]) assert.throws(()=>parseFormPreparation({...value,...patch}));
});

test('handler navigation is optional for viewing and validates retained owner identities', () => {
  const snapshot=fixture();
  snapshot.model.handlers=[{owner:{kind:'element',identity:snapshot.model.root.identity},event:'OnOpen',name:'Opened',origin:snapshot.model.root.origin}];
  assert.equal(parseFormSnapshot(snapshot).model.handlers.length,1);
  for(const owner of [{kind:'element',identity:{...snapshot.model.root.identity,source:'b'.repeat(64)}},{kind:'unknown'}]) {
    const invalid=structuredClone(snapshot);invalid.model.handlers[0].owner=owner;assert.throws(()=>parseFormSnapshot(invalid));
  }
  const location={source,root:{value:'/source',encoding:'utf-8'},path:{value:'CommonForms/Preview/Ext/Form/Module.bsl',encoding:'utf-8'},revision:'1'};
  assert.equal(parseHandlerSource(location).revision,'1');
  for(const patch of [{source:'bad'},{revision:1},{root:null}]) assert.throws(()=>parseHandlerSource({...location,...patch}));
});

test('form snapshots require the resolved ImportantColor supplied by API 1.40', () => {
  const snapshot = fixture();
  assert.deepEqual(parseFormSnapshot(snapshot).model.importantColor,{kind:'role',value:'ImportantColor'});
  for (const value of [undefined,null,{kind:'unknown',value:'#ffe100'},{kind:'rgb',value:17}]) {
    const invalid = structuredClone(snapshot); invalid.model.importantColor = value;
    assert.throws(() => parseFormSnapshot(invalid));
  }
});

test('form snapshots accept the optional native script variant independently from the shell locale', () => {
  const snapshot = fixture();
  assert.equal(parseFormSnapshot(snapshot).model.scriptVariant, undefined);
  for (const scriptVariant of ['russian', 'english']) {
    snapshot.model.scriptVariant = scriptVariant;
    assert.equal(parseFormSnapshot(snapshot).model.scriptVariant, scriptVariant);
  }
  snapshot.model.scriptVariant = 'ru-RU';
  assert.throws(() => parseFormSnapshot(snapshot));
});

test('a form snapshot rejects duplicate identities and missing input ownership', () => {
  const snapshot = fixture();
  assert.equal(parseFormSnapshot(snapshot).formSessionId, 'f1');
  const duplicate = structuredClone(snapshot); duplicate.model.root.children.push(structuredClone(duplicate.model.root));
  assert.throws(() => parseFormSnapshot(duplicate));
  const foreign = structuredClone(snapshot); foreign.model.root.identity.source = 'b'.repeat(64);
  assert.throws(() => parseFormSnapshot(foreign));
  const badSize = structuredClone(snapshot); badSize.model.root.presentation.font.points = Infinity;
  assert.throws(() => parseFormSnapshot(badSize));
  const badMark = structuredClone(snapshot); badMark.model.root.presentation.markIncomplete = 'true';
  assert.throws(() => parseFormSnapshot(badMark));
});

test('form properties validate caption pairs, qualifiers and explicit boolean hints', () => {
  const snapshot = fixture(), origin = snapshot.model.root.origin;
  const property = {key:{namespace:'http://v8.1c.ru/8.3/xcf/logform',name:'Visible'},qualifiers:[],origin,range:origin.range,
    caption:{'ru-RU':'Видимость','en-US':'Visibility'},value:{kind:'text',text:'false',scalarType:'boolean'}};
  snapshot.model.root.properties.push(property);
  assert.equal(parseFormSnapshot(snapshot).model.root.properties[0].value.text,'false');
  for (const patch of [{caption:{'en-US':'Visibility'}},{qualifiers:[{key:{name:'ref',namespace:null},value:42}]},
    {value:{kind:'text',text:'other',scalarType:'boolean'}},{value:{kind:'text',text:'true',caption:{'ru-RU':'Да'}}}]) {
    const changed = structuredClone(snapshot);changed.model.root.properties[0]={...property,...patch};
    assert.throws(()=>parseFormSnapshot(changed));
  }
});

test('nested property summaries use backend captions without interpreting user text', () => {
  const value = {kind:'record',fields:[{key:{name:'Type'},caption:{'ru-RU':'Тип','en-US':'Type'},value:{kind:'text',text:'xs:string',caption:{'ru-RU':'Строка','en-US':'String'}}},
    {key:{name:'Title'},value:{kind:'text',text:'true'}}]};
  assert.equal(localizedProperty(value,'ru-RU'),'Тип: Строка; Title: true');
  assert.equal(localizedProperty(value,'en-US'),'Type: String; Title: true');
  assert.equal(value.fields[0].value.text,'xs:string');
});

test('renderer preparation preserves identity across new models and localizes literal titles', () => {
  const model = fixture().model, before = prepare(model), after = prepare(structuredClone(model));
  assert.equal(before.root.key, after.root.key); assert.equal(flatten(before.root)[0].node.key, before.root.key);
  const title = { kind: 'literal', items: [{ language: 'ru', content: 'Наименование' }, { language: 'en', content: 'Name' }] };
  assert.equal(text(title, 'ru-RU', {}), 'Наименование'); assert.equal(text(title, 'en-US', {}), 'Name');
  assert.equal(fieldWidth(before.root), 161); assert.equal(color({ kind: 'rgb', value: '#009646' }), '#009646');
  assert.match(font({ face: 'Arial', points: 10 }, 'linux')['font-family'], /ESKA Taxi Sans/);
});

test('selection opens every enclosing page by identity while leaving unrelated groups alone', () => {
  const model=fixture().model;
  const node=(id,kind,children=[])=>({...structuredClone(model.root),kind,identity:{source,part:'current',key:{kind:'xml',value:String(id)}},children});
  model.root.children=[node(1,'Pages',[node(2,'Page',[node(3,'Pages',[node(4,'Page',[node(5,'InputField')])])])]),node(6,'Pages',[node(7,'Page')])];
  const prepared=prepare(model), root=prepared.root;
  const path=pageSelections(root,find(root,`${source}:current:5`).key);
  assert.deepEqual(path,{[`${source}:current:1`]:`${source}:current:2`,[`${source}:current:3`]:`${source}:current:4`});
  assert.deepEqual(pageSelections(root,root.key),{});
  assert.deepEqual(pageSelections(root,'missing'),{});
  assert.deepEqual(pageSelections(root,`${source}:current:7`),{[`${source}:current:6`]:`${source}:current:7`});
});

test('form viewer UI strings have identical ru/en keys', () => {
  assert.deepEqual(Object.keys(formStrings('ru-RU')).sort(), Object.keys(formStrings('en-US')).sort());
});

test('automatic metadata commands preserve localized overrides and validate optional provenance', () => {
  const snapshot = fixture(), root = snapshot.model.root;
  root.presentation.autoCommands = ['WriteAndClose'];
  assert.equal(text(automaticCommands(root)[0].caption, 'en-US', formStrings('en-US')), 'Save and close');
  root.presentation.autoCommandItems = [{ key: 'metadata-command', primary: false, origin: root.origin,
    caption: { kind: 'literal', items: [{ language: 'ru', content: 'Переопределено' }, { language: 'en', content: 'Overridden' }] } }];
  assert.equal(text(automaticCommands(parseFormSnapshot(snapshot).model.root)[0].caption, 'ru-RU', formStrings('ru-RU')), 'Переопределено');
  const bad = structuredClone(snapshot); bad.model.root.presentation.autoCommandItems[0].origin.range.start = -1;
  assert.throws(() => parseFormSnapshot(bad));
  root.presentation.autoCommandItems = [];
  assert.deepEqual(automaticCommands(root), [], 'an explicit empty bar does not restore legacy commands');
});


test('Linux profile ships exact unmodified reference fonts and their license offline', async () => {
  const root = new URL('../resources/forms/fonts/', import.meta.url), manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.unmodified, true); assert.equal(manifest.files.length, 12);
  assert.match(await readFile(new URL('LICENSE', root), 'utf8'), /SIL OPEN FONT LICENSE Version 1.1/);
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const css = await readFile(new URL('../out/form-preview.css', import.meta.url), 'utf8');
  const files = await readdir(new URL('../out/form-fonts/', import.meta.url));
  for (const file of manifest.files) assert.ok(files.some(name => name.startsWith(file.file.replace('.ttf','-')) && css.includes(name)), file.file);
  assert.match(await readFile(new URL('../out/THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8'), /Liberation Fonts 2.1.5/);
});


test('native tree hides helper nodes while preserving full identity lookup and unbound fields', () => {
  const model = prepare(fixture().model), root=model.root;
  const node=(kind,id)=>({...structuredClone(root),kind,key:id,children:[],auxiliary:[]});
  const field=node('InputField','field');field.presentation.displayed=false;
  field.auxiliary.push(node('ContextMenu','menu'),node('ExtendedTooltip','tooltip'));
  root.children.push(field);root.auxiliary.push(node('AutoCommandBar','bar'));
  assert.deepEqual(flatten(root).map(row=>row.node.key),[root.key,'field']);
  assert.equal(find(root,'tooltip').kind,'ExtendedTooltip');
  root.auxiliary[0].children.push(node('Button','command'));
  assert.deepEqual(treeChildren(root).map(node=>node.key),['bar','field']);
  const table=node('Table','table');table.auxiliary.push(node('AutoCommandBar','tableBar'));
  assert.deepEqual(treeChildren(table).map(node=>node.key),['tableBar']);
});

test('form image assets require checked source ownership, bounded image MIME and resolved references', () => {
  const model = fixture(), picture = { status:'ready', mimeType:'image/svg+xml',data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),fileName:'Icon.svg' };
  const assetSource='b'.repeat(64);model.dependencies.push({...model.dependencies[0],id:assetSource,role:'metadata'});
  model.model.assets.push({id:assetSource,picture});model.model.root.presentation.picture={kind:'common',source:assetSource};
  assert.equal(parseFormSnapshot(model).model.assets.length,1);
  const absent=structuredClone(model);absent.model.assets=[];assert.throws(()=>parseFormSnapshot(absent));
  const html=structuredClone(model);html.model.assets[0].picture.mimeType='text/html';assert.throws(()=>parseFormSnapshot(html));
  const foreign=structuredClone(model);foreign.model.assets[0].id='c'.repeat(64);assert.throws(()=>parseFormSnapshot(foreign));
});


test('a selected property palette requires an exact revision and real XML indices', () => {
  const snapshot = fixture(), node = snapshot.model.root;
  const field = {key:{namespace:'urn:test',name:'Width'}};
  node.properties = [field, field];
  const label = {'ru-RU':'Основные','en-US':'General'};
  const declared = (index, occurrence) => ({id:'xml:'+index,category:null,editor:null,caption:null,
    value:{kind:'declared',propertyIndex:index,occurrence,sourceKind:'form'}});
  const absent = {id:'platform:United',category:'main',editor:'boolean',caption:label,
    value:{kind:'absent',default:{kind:'boolean',value:true},caption:null}};
  const data = {formSessionId:snapshot.formSessionId,revision:snapshot.revision,identity:node.identity,
    categories:[{id:'main',caption:label}],rows:[absent,declared(0,0),declared(1,1)]};
  assert.deepEqual(parsePropertyPalette(data,snapshot,node),data);
  assert.equal(parsePropertyPalette({...data,rows:null,categories:null},snapshot,node).rows,null);
  const unavailable = {...data,rows:[{...absent,available:false},...data.rows.slice(1)]};
  assert.deepEqual(parsePropertyPalette(unavailable,snapshot,node),unavailable);
  const qualifier = {id:'platform:DisplayImportance',category:'main',editor:'enum',caption:label,
    value:{kind:'qualifier',key:{namespace:null,name:'DisplayImportance'},text:'High',
      sourceKind:'form',origin:node.origin,caption:{'ru-RU':'Высокая','en-US':'High'}}};
  const captioned = {...data,rows:[...data.rows,qualifier]};
  assert.deepEqual(parsePropertyPalette(captioned,snapshot,node),captioned);
  for (const patch of [
    {formSessionId:'other'}, {revision:'8'}, {identity:{...data.identity,source:'b'.repeat(64)}},
    {rows:[absent,declared(1,0)]}, {rows:[absent,declared(1,1),declared(2,0)]},
    {rows:[absent,declared(0,0),declared(0,0)]}, {categories:[]},
    {rows:[{...absent,value:{...absent.value,default:{kind:'boolean',value:'true'}}},...data.rows.slice(1)]},
    {rows:[{...absent,available:'false'},...data.rows.slice(1)]},
    {rows:[...data.rows,{...qualifier,value:{...qualifier.value,caption:{'en-US':'High'}}}]},
  ]) assert.throws(() => parsePropertyPalette({...data,...patch},snapshot,node));
});

test('a projected event must reference a matching field in its real XML wrapper', () => {
  const snapshot = fixture(), node = snapshot.model.root;
  const namespace = 'http://v8.1c.ru/8.3/xcf/logform';
  const event = { key:{namespace,name:'Event'}, qualifiers:[{key:{namespace:null,name:'name'},value:'OnChange'}],
    value:{kind:'text',text:'HandleChange'} };
  node.properties = [{ key:{namespace,name:'Events'}, value:{kind:'record',fields:[event]} }];
  const caption = {'ru-RU':'События','en-US':'Events'};
  const projected = {id:'platform:OnChange',category:'events',editor:'event',caption,
    value:{kind:'declaredEvent',propertyIndex:0,entryIndex:0,occurrence:0,sourceKind:'form'}};
  const declared = {id:'xml:events',category:null,editor:null,caption:null,
    value:{kind:'declared',propertyIndex:0,occurrence:0,sourceKind:'form'}};
  const data = {formSessionId:snapshot.formSessionId,revision:snapshot.revision,identity:node.identity,
    categories:[{id:'events',caption}],rows:[projected,declared]};
  assert.deepEqual(parsePropertyPalette(data,snapshot,node),data);
  for (const value of [
    {...projected.value,entryIndex:1},
    {...projected.value,propertyIndex:1},
    {...projected.value,occurrence:1},
    {...projected.value,sourceKind:'metadata'},
  ]) assert.throws(() => parsePropertyPalette({...data,rows:[{...projected,value},declared]},snapshot,node));
  assert.throws(() => parsePropertyPalette({...data,rows:[{...projected,id:'platform:StartChoice'},declared]},snapshot,node));
  assert.throws(() => parsePropertyPalette({...data,rows:[projected]},snapshot,node));
});
