import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { groupSeparationEdges, groupSpacingInterval } from '../webview/forms/group-spacing.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';
import { formReferenceRoot } from './form-references.mjs';

const node = (properties = {}, kind = 'UsualGroup') => ({ key: 'group', kind, properties: Object.entries(properties).map(([name, text]) =>
  ({ key: { namespace: FORM_NS, name }, value: { kind: 'text', text } })) });
const edge = distance => ({ distance, insets: [] });
const none = { x: [edge(0), edge(0)], y: [edge(0), edge(0)] };
const normal = { x: [edge(10), edge(10)], y: [edge(8), edge(8)] };

test('normal separation survives nested wrappers and perpendicular rows', () => {
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'NormalSeparation' }), [none], false), normal);
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'None' }), [normal], false), normal);
  assert.deepEqual(groupSeparationEdges(node({}), [none, normal, none], false), { x: normal.x, y: none.y });
  assert.deepEqual(groupSeparationEdges(node({}), [none, normal, none], true), { x: none.x, y: normal.y });
  assert.deepEqual(groupSeparationEdges(node({}, 'Pages'), [normal], false), none, 'pages own their interior boundaries');
});

test('painted normal groups include their own padding in the boundary requirement', () => {
  const padding = { x: [5, 5], y: [5, 5] };
  const group = node({ Representation: 'NormalSeparation' });
  const painted = { x: [edge(5), edge(5)], y: [edge(3), edge(3)] };
  assert.deepEqual(groupSeparationEdges(group, [none], false, padding, true), painted);
  assert.deepEqual(groupSeparationEdges(group, [normal], false, padding, true), painted);
});

test('a painted wrapper without separation reserves nested spacing on the inside', () => {
  const wrapped = groupSeparationEdges(node({ Representation: 'None' }), [normal], false, {}, true);
  const interior = distance => ({ distance: 0, insets: [{ key: 'group', distance }] });
  assert.deepEqual(wrapped, { x: [interior(10), interior(10)], y: [interior(8), interior(8)] });
  assert.deepEqual(groupSeparationEdges(node({}), [wrapped], false), wrapped,
    'a transparent wrapper relays the request to the enclosing boundary');
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'NormalSeparation' }), [wrapped], false), normal,
    'an enclosing section owns the boundary shared with its painted descendant');
});

test('independent vertical sections reserve their title gap inside the group', () => {
  const section = node({ Representation: 'NormalSeparation', Group: 'Vertical', United: 'false' });
  assert.deepEqual(groupSeparationEdges(section, [none], false), { x: normal.x, y: none.y });
  assert.deepEqual(groupSeparationEdges(section, [normal], false), normal,
    'the independent owner retains separation requested by a nested child');
});

test('explicit group intervals use the native horizontal and vertical units', () => {
  for (const [mode, x, y] of [['None', 0, 0], ['Half', 5, 5], ['Single', 10, 9], ['Double', 20, 18]]) {
    const group = node({ HorizontalSpacing: mode, VerticalSpacing: mode });
    assert.equal(groupSpacingInterval(group, 'x'), x);
    assert.equal(groupSpacingInterval(group, 'y'), y);
  }
  assert.equal(groupSpacingInterval(node({}), 'x'), undefined);
  assert.equal(groupSpacingInterval(node({}), 'y'), undefined);
});

test('native separation gallery retains all 52 source hashes and comparable geometry', async () => {
  const root = new URL('tests/fixtures/forms/native-group-separation/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 52);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 52);
  assert.equal(metrics.rows.filter(row => row.crossCheckedCompatibility === 'Version8_3_27').length, 15);
  for (const row of metrics.rows) {
    const source = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(source).digest('hex'), metrics.sourceFiles[row.name], row.name);
    const xml = source.toString('utf8');
    const children = xml.slice(xml.indexOf('<ChildItems>'), xml.lastIndexOf('</ChildItems>'));
    const ids = [...children.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, row.name + ' visual identities');
    assert.match(row.screenshotSha256, /^[a-f0-9]{64}$/u);
    for (const [name, [x, y, width, height]] of Object.entries(row.fields)) {
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= row.frame[0] && y + height <= row.frame[1], row.name + '/' + name);
    }
  }
  const byName = Object.fromEntries(metrics.rows.map(row => [row.name, row]));
  assert.equal(byName.NormalMiddle.fields.Inner[1] - byName.ControlNone.fields.Inner[1], 8);
  assert.equal(byName.TwoNormal.fields.Peer[1] - byName.TwoNormal.fields.Inner[1], 40);
  assert.equal(byName.UnitedFalse.fields.Deep[1], byName.UnitedFalse.fields.Inner[1]);
});

test('painted group references bind the canonical XML and both Linux captures', async () => {
  const root = new URL('tests/fixtures/forms/native-painted-group-spacing/', formReferenceRoot);
  const { rows } = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  assert.equal(rows.length, 49);
  assert.equal(rows.filter(row => row.captures.ru).length, 30);
  assert.equal(new Set(rows.map(row => row.name)).size, rows.length);
  for (const row of rows) {
    const file = await readFile(new URL(row.file, root));
    assert.equal(createHash('sha256').update(file).digest('hex'), row.fixtureSha256, row.name);
    assert.match(row.canonicalSha256, /^[a-f0-9]{64}$/u);
    assert.match(row.captures.en, /^[a-f0-9]{64}$/u);
    if (row.captures.ru) assert.match(row.captures.ru, /^[a-f0-9]{64}$/u);
    for (const [x, y, width, height] of [...Object.values(row.fields), ...Object.values(row.fills)]) {
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= row.frame[0] && y + height <= row.frame[1], row.name);
    }
  }
  const cases = new Map(rows.map(row => [row.name, row]));
  assert.equal(cases.get('VerticalLeadingPaint').fields.B[1], 119);
  assert.equal(cases.get('VerticalTrailingPaint').fields.B[1], 124);
  assert.equal(cases.get('VerticalNestedOuter').fills.WrapperA[3], 49);
  assert.deepEqual(cases.get('ConditionalWidth24').frame, [274,194]);
  assert.deepEqual(cases.get('ConditionalWidth29').fields, cases.get('ConditionalVerticalControl').fields);
  assert.equal(cases.get('ConditionalWidth35').fields.B[0], 174);
});

test('nested reflow binds both captures and all referenced viewport profiles to canonical XML', async () => {
  const root = new URL('tests/fixtures/forms/native-nested-reflow/', formReferenceRoot);
  const { rows } = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  assert.equal(rows.length, 29);
  const cases = new Map(rows.map(row => [row.name, row]));
  assert.equal(cases.size, rows.length);
  assert.equal(rows.filter(row => row.reflow).length, 4);
  for (const row of rows) {
    const source = await readFile(new URL(row.file, root));
    assert.equal(createHash('sha256').update(source).digest('hex'), row.fixtureSha256, row.name);
    assert.match(row.canonicalSha256, /^[a-f0-9]{64}$/u);
    for (const locale of ['en','ru']) assert.match(row.captures[locale], /^[a-f0-9]{64}$/u);
    for (const sample of row.reflow?.cases ?? []) assert.ok(cases.has(sample), sample);
  }
  assert.deepEqual(cases.get('Vertical24').frame, [274,194]);
  assert.equal(cases.get('Right40').fields.Side[0], 169);
  assert.deepEqual(cases.get('Twin41').fields.D.slice(0,2), [134,71]);
  assert.equal(cases.get('Parallel31').fills.WrapperA[2], 151);
});
