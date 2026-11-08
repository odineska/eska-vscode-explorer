import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FORM_NS } from '../webview/forms/model.mjs';
import { layoutGroupSpacing } from '../webview/forms/group-spacing-layout.js';
import { formReferenceRoot } from './form-references.mjs';

const root = new URL('tests/fixtures/forms/native-page-group-spacing/', formReferenceRoot);

test('page separation corpus binds eight canonical forms and sixteen native frames', async () => {
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('capture-manifest.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 8);
  assert.equal(manifest.captures.length, 16);
  assert.equal(manifest.sourcesUnchanged, true);
  assert.ok(manifest.runs.every(run => run.exitCode === 0 && run.sourcesUnchanged));
  for (const row of metrics.rows) {
    assert.equal(createHash('sha256').update(await readFile(new URL(row.name + '.xml', root))).digest('hex'), row.xmlSha256);
    assert.equal(Object.keys(row.locales.en.fields).length, 10);
    const { screenshotSha256: english, ...en } = row.locales.en;
    const { screenshotSha256: russian, ...ru } = row.locales.ru;
    assert.deepEqual(en, ru, row.name);
    for (const [locale, digest] of [['en', english], ['ru', russian]]) {
      assert.equal(manifest.captures.find(capture => capture.name === row.name && capture.locale === locale)?.sha256, digest);
    }
  }
});

function pageTree() {
  const node = (key, kind, children = [], properties = {}) => ({ key, kind, children,
    properties: Object.entries(properties).map(([name, text]) => ({ key: { namespace: FORM_NS, name }, value: { kind: 'text', text } })),
  });
  const left = node('left', 'InputField'), right = node('right', 'InputField');
  const row = node('row', 'UsualGroup', [left, right]);
  const first = node('first', 'UsualGroup', [row], { Representation: 'NormalSeparation', Group: 'Vertical' });
  const second = node('second', 'UsualGroup', [node('last', 'InputField')], { Representation: 'NormalSeparation', Group: 'Vertical' });
  const page = node('page', 'Page', [first, second]);
  const pages = node('pages', 'Pages', [page]), model = node('form', 'Form', [pages]);
  const element = () => ({ style: new Map() });
  const elements = new Map([left, right, row, first, second, second.children[0], pages].map(node => [node.key, element()]));
  for (const e of elements.values()) e.style.getPropertyValue = name => e.style.get(name) ?? '';
  const containers = new Map([model, page, first, second, row].map(node => [node.key, {
    ...element(), parentElement: null, classList: { contains: name => name === 'taxi-items--horizontal' && node === row },
  }]));
  const alignment = { style: (e, name, value) => e.style.set(name, value) };
  return { model, elements, containers, context: { os: 'linux', alignment,
    targets: { elements, containers, children: node => node.children.filter(child => elements.has(child.key)) } } };
}

test('separation traverses logical pages and applies boundaries to mounted siblings', () => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = e => ({ getPropertyValue: name => e.style.get(name) ?? '0px' });
  try {
    const tree = pageTree();
    assert.equal(tree.elements.has('page'), false, 'Page has a container without an element wrapper');
    layoutGroupSpacing(tree.model, tree.context);
    assert.deepEqual({ separation: tree.elements.get('second').style.get('margin-top'),
      horizontal: tree.containers.get('row').style.get('--taxi-horizontal-gap') }, { separation: '8px', horizontal: '10px' });
    const windows = pageTree();
    layoutGroupSpacing(windows.model, { ...windows.context, os: 'win32' });
    assert.equal(windows.elements.get('second').style.size, 0);
    assert.equal(windows.containers.get('row').style.size, 0);
  } finally {
    if (previous === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = previous;
  }
});
