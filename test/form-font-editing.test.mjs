import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import solid from '@solidjs/babel-plugin';
import { editableFont, fontAttribute, patchFont } from '../webview/forms/editor-font.mjs';

const qualifiers = entries => Object.entries(entries).map(([name, value]) => [{ namespace: null, name }, value]);
const font = (attributes, value = { Text: '' }) => ({ value, qualifiers: qualifiers(attributes) });
const repository = fileURLToPath(new URL('../', import.meta.url));
const editor = build({
  stdin: { contents: `export { canEditFormProperty } from './webview/forms/FormEditorFields.jsx';`, resolveDir: repository },
  bundle: true, write: false, platform: 'node', format: 'cjs', conditions: ['node'],
  plugins: [{ name: 'solid-ssr', setup(builder) {
    builder.onLoad({ filter: /\.jsx$/ }, async args => ({ contents: (await transformAsync(await readFile(args.path, 'utf8'), {
      filename: args.path, plugins: [[solid, { generate: 'ssr', hydratable: false }]], babelrc: false, configFile: false,
    })).code, loader: 'js' }));
  } }],
}).then(bundle => {
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
  return module.exports;
});

test('ordinary font properties enter the existing inline editor without flattening unknown XML', async () => {
  const { canEditFormProperty } = await editor;
  const node = { kind: 'InputField' };
  for (const name of ['Font', 'TitleFont', 'FooterFont', 'MultipleValuesFont']) {
    const field = { source: 'property', editor: 'font', name };
    assert.equal(canEditFormProperty(node, field), true);
    assert.equal(canEditFormProperty(node, field, { writable: true, property: font({ ref: 'style:NormalTextFont', kind: 'StyleItem' }) }), true);
    assert.equal(canEditFormProperty(node, field, { writable: false, property: font({}) }), false);
    assert.equal(canEditFormProperty(node, field, { property: font({}, { Record: [] }) }), false);
  }
});

test('native references, custom families, explicit false and inherited effects retain their annotations', () => {
  const original = qualifiers({ ref: 'sys:DefaultGUIFont', faceName: 'Liberation Mono', height: '14', bold: 'true', italic: 'false', underline: 'true', strikeout: 'false', kind: 'WindowsFont' });
  const before = structuredClone(original);
  let next = patchFont(original, 'height', '16');
  assert.deepEqual(original, before);
  assert.deepEqual(next.filter(([key]) => key.name !== 'height'), original.filter(([key]) => key.name !== 'height'));
  next = patchFont(next, 'italic', '');
  assert.equal(fontAttribute(next, 'italic'), '');
  assert.equal(fontAttribute(next, 'strikeout'), 'false');
  assert.equal(editableFont({ value: { Text: '' }, qualifiers: next }), true);
  const custom = patchFont(qualifiers({ ref: 'style:NormalTextFont', kind: 'StyleItem', height: '11' }), 'faceName', 'Liberation Sans');
  assert.equal(fontAttribute(custom, 'ref'), 'sys:DefaultGUIFont');
  assert.equal(fontAttribute(custom, 'kind'), 'WindowsFont');
  assert.equal(fontAttribute(custom, 'height'), '11');
  const style = patchFont(custom, 'ref', 'style:TextFont');
  assert.equal(fontAttribute(style, 'kind'), 'StyleItem');
  assert.equal(fontAttribute(style, 'faceName'), 'Liberation Sans');
});

test('unsupported annotations and values remain read-only, and invalid partial numbers are never planned', () => {
  for (const property of [font({ future: 'keep' }), font({ kind: 'FutureFont' }), font({ height: '-1' }), font({}, { Text: 'keep' }), font({}, { Record: [] })]) {
    assert.equal(editableFont(property), false);
  }
  const annotated = font({ ref: '0' });
  annotated.qualifiers.push([{ namespace: 'urn:keep', name: 'height' }, '18']);
  assert.equal(editableFont(annotated), false);
  annotated.qualifiers = [...qualifiers({ ref: '0' }), ...qualifiers({ ref: 'sys:DefaultGUIFont' })];
  assert.equal(editableFont(annotated), false);
  for (const text of ['-', '1e', 'NaN', 'Infinity', '-1', '0', '0.05']) assert.equal(patchFont([], 'height', text), undefined);
  assert.equal(patchFont([], 'ref', 'style:'), undefined);
  for (const text of ['125.5', '0', '65536']) assert.equal(patchFont([], 'scale', text), undefined);
  for (const text of ['0.1', '0.5', '12.5']) assert.equal(fontAttribute(patchFont([], 'height', text), 'height'), text);
  assert.equal(fontAttribute(patchFont([], 'scale', '125'), 'ref'), '0');
});
