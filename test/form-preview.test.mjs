import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { formCapabilities, isIdentity, identityKey, parseFormSnapshot } from '../out/form-preview/protocol.js';
import { prepare, fieldWidth, flatten, text, font, color } from '../webview/forms/model.mjs';
import { formStrings } from '../out/form-preview/strings.js';

const source = 'a'.repeat(64);
function fixture() {
  const origin = { source, range: { start: 0, end: 200 } };
  const font = { face: null, points: 10, weight: 400, italic: false, underline: false, strikeout: false, origins: [] };
  const role = { kind: 'role', value: 'TextColor' };
  const presentation = { titleLocation: 'Left', displayed: true, grouping: 'Vertical', caption: { kind: 'name', text: 'Форма' }, tooltip: null, font, titleFont: font,
    foreground: role, background: role, border: role, titleColor: role, valueType: { kind: 'string', length: null, digits: null, fraction: null, dateParts: null, types: [] },
    binding: null, choices: [], autoCommands: [] };
  const root = { identity: { source, part: 'current', key: { kind: 'root' } }, origin, kind: 'Form', name: null,
    xmlName: { namespace: 'http://v8.1c.ru/8.3/xcf/logform', name: 'Form' }, properties: [], presentation, children: [], auxiliary: [] };
  return { formSessionId: 'f1', revision: '1', contextFingerprint: source, application: null, profile: 'taxi-8.3.27', limitedContext: false, modelComplete: true,
    status: 'ready', lastError: null, dependencies: [{ id: source, root: { encoding: 'utf-8', value: '/project/src' }, path: { encoding: 'utf-8', value: 'Form.xml' }, snapshot: source, version: null, member: null, role: 'form' }],
    model: { root, attributes: [], commands: [], parameters: [], diagnostics: { composition: [], appearance: [] } } };
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
  const value = { apiVersion: { major: 1, minor: 36 }, capabilities: { formPreview: { schemaVersion: 1, profile: 'taxi-8.3.27', readOnly: true, executesBsl: false,
    uploads: 'queryBuffers', maxSessions: 32, maxOverlayBytes: 16777216, maxInlineBytes: 262144 } } };
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
