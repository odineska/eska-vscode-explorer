import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { formCapabilities, isIdentity, identityKey, parseFormSnapshot } from '../out/form-preview/protocol.js';
import { prepare, fieldWidth, flatten, treeChildren, find, text, font, color, automaticCommands } from '../webview/forms/model.mjs';
import { formStrings } from '../out/form-preview/strings.js';

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
    model: { root, assets: [], attributes: [], commands: [], parameters: [], diagnostics: { composition: [], appearance: [] } } };
}

test('form identities preserve signed XML i64 boundaries without JavaScript rounding', () => {
  for (const value of ['-9223372036854775808', '9223372036854775807', '-1', '0']) {
    const identity = { source, part: 'current', key: { kind: 'xml', value } };
    assert.equal(isIdentity(identity), true); assert.ok(identityKey(identity).endsWith(`:${value}`));
  }
  for (const value of ['9223372036854775808', '-9223372036854775809', '01', '1.2', 1]) assert.equal(isIdentity({ source, part: 'current', key: { kind: 'xml', value } }), false);
});

test('form capability negotiation requires a static read-only profile and bounds uploads', () => {
  assert.equal(formCapabilities({ capabilities: {} }), undefined);
  const value = { apiVersion: { major: 1, minor: 37 }, capabilities: { formPreview: { pictures: true, schemaVersion: 1, profile: 'taxi-8.3.27', readOnly: true, executesBsl: false,
    uploads: 'queryBuffers', maxSessions: 32, maxOverlayBytes: 16777216, maxInlineBytes: 262144 } } };
  assert.equal(formCapabilities({...value,apiVersion:{major:1,minor:36}}),undefined);
  assert.throws(()=>formCapabilities({...value,apiVersion:{major:2,minor:36}}));
  assert.deepEqual(formCapabilities(value), { maxSessions: 16, maxOverlayBytes: 8388608, maxInlineBytes: 131072 });
  for (const patch of [{ executesBsl: true }, { readOnly: false }, { profile: 'taxi-8.5' }, { maxSessions: -1 }]) assert.throws(() => formCapabilities({ ...value, capabilities: { formPreview: { ...value.capabilities.formPreview, ...patch } } }));
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

test('renderer preparation preserves identity across new models and localizes literal titles', () => {
  const model = fixture().model, before = prepare(model), after = prepare(structuredClone(model));
  assert.equal(before.root.key, after.root.key); assert.equal(flatten(before.root)[0].node.key, before.root.key);
  const title = { kind: 'literal', items: [{ language: 'ru', content: 'Наименование' }, { language: 'en', content: 'Name' }] };
  assert.equal(text(title, 'ru-RU', {}), 'Наименование'); assert.equal(text(title, 'en-US', {}), 'Name');
  assert.equal(fieldWidth(before.root), 161); assert.equal(color({ kind: 'rgb', value: '#009646' }), '#009646');
  assert.match(font({ face: 'Arial', points: 10 }, 'linux')['font-family'], /ESKA Taxi Sans/);
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
