import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { groupSeparationEdges, groupSpacingInterval } from '../webview/forms/group-spacing.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';
import { formReferenceRoot } from './form-references.mjs';

const node = (properties = {}, kind = 'UsualGroup') => ({ kind, properties: Object.entries(properties).map(([name, text]) =>
  ({ key: { namespace: FORM_NS, name }, value: { kind: 'text', text } })) });
const none = { x: [0, 0], y: [0, 0] };
const normal = { x: [10, 10], y: [8, 8] };

test('normal separation survives nested wrappers and perpendicular rows', () => {
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'NormalSeparation' }), [none], false), normal);
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'None' }), [normal], false), normal);
  assert.deepEqual(groupSeparationEdges(node({}), [none, normal, none], false), { x: [10, 10], y: [0, 0] });
  assert.deepEqual(groupSeparationEdges(node({}), [none, normal, none], true), { x: [0, 0], y: [8, 8] });
  assert.deepEqual(groupSeparationEdges(node({}, 'Pages'), [normal], false), none, 'pages own their interior boundaries');
});

test('painted normal groups include their own padding in the boundary requirement', () => {
  const padding = { x: [5, 5], y: [5, 5] };
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'NormalSeparation' }), [none], false, padding),
    { x: [5, 5], y: [3, 3] });
  assert.deepEqual(groupSeparationEdges(node({ Representation: 'None' }), [normal], false, padding), normal,
    'an outer painted wrapper preserves separation inherited from the nested group');
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
