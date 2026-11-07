import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const bundle = build({
  stdin: { resolveDir: repository, contents: `
    import { createRoot, createEffect, createComputed, For, onCleanup } from 'solid-js';
    import { createStore } from 'solid-js/store';
    import { createTableLayout } from './webview/forms/table-layout.js';
    export { tableLayout } from './webview/forms/table-model.mjs';
    export function observe(initial) {
      return createRoot(dispose => {
        const [source, set] = createStore({ table: initial, locale: 'ru', os: 'linux', phase: 'ready' });
        const layout = createTableLayout(() => source.table, source);
        const counts = { headers: 0, headerDisposals: 0, footers: 0, footerDisposals: 0 };
        const headers = For({ get each() { return layout().children; }, children: item => {
          counts.headers++; onCleanup(() => counts.headerDisposals++); return item;
        }});
        const footers = For({ get each() { return layout().columns; }, children: item => {
          counts.footers++; onCleanup(() => counts.footerDisposals++); return item;
        }});
        createComputed(() => { headers(); footers(); });
        const snapshots = [];
        createEffect(() => snapshots.push({ tracks: layout().tracks,
          widths: layout().columns.map(column => column.width), preferredWidth: layout().preferredWidth }));
        return { source, set, layout, counts, snapshots, dispose };
      });
    }` },
  bundle: true, write: false, platform: 'browser', format: 'cjs',
  conditions: ['browser', 'production'], define: { 'process.env.NODE_ENV': '"production"' },
});
const property = (name, text) => ({ key: { namespace: 'http://v8.1c.ru/8.3/xcf/logform', name },
  value: { kind: 'text', text: String(text) } });
const field = (key, kind, type) => ({ key, kind, children: [], auxiliary: [], properties: [],
  presentation: { displayed: true, caption: { kind: 'name', text: key }, valueType: { kind: type, length: 20 } } });
function fixture(mode) {
  const text = field('Text', 'InputField', 'string'), amount = field('Amount', 'InputField', 'number');
  const active = field('Active', 'CheckBoxField', 'boolean');
  const children = mode ? [{ ...field('Group', 'ColumnGroup', 'unknown'), children: [text, amount],
    properties: [property('Group', mode), property('ShowInHeader', true)] }, active] : [text, amount, active];
  return { key: 'Rows', kind: 'Table', children, auxiliary: [], properties: [property('Footer', true)],
    presentation: { autoCommandItems: [] } };
}
async function observe(t, initial = fixture()) {
  const module = { exports: {} }, context = createContext({ module, exports: module.exports });
  runInContext((await bundle).outputFiles[0].text, context);
  const value = data => runInContext(`(${JSON.stringify(data)})`, context);
  const result = module.exports.observe(value(initial));
  t.after(() => result.dispose());
  return { ...result, value, pure: () => module.exports.tableLayout(result.source.table, result.source) };
}
const plain = value => JSON.parse(JSON.stringify(value));
function geometry(harness) { assert.deepEqual(plain(harness.layout()), plain(harness.pure())); }

test('a Width edit retains header/column records, lists, source proxies and For owners', async t => {
  const h = await observe(t), layout = h.layout(), headers = [...layout.children], columns = [...layout.columns];
  const children = layout.children, physical = layout.columns, fields = columns.map(column => column.fields);
  const snapshots = h.snapshots.length;
  h.set('table', 'children', 0, 'properties', h.value([property('Width', 32)]));
  assert.equal(layout.children, children); assert.equal(layout.columns, physical);
  headers.forEach((header, index) => assert.equal(layout.children[index], header));
  columns.forEach((column, index) => {
    assert.equal(layout.columns[index], column); assert.equal(column.fields, fields[index]);
    assert.equal(column.node, h.source.table.children[index]);
    assert.equal(column.fields[0], h.source.table.children[index]);
  });
  assert.equal(columns[0].width, 253); assert.equal(h.snapshots.length, snapshots + 1);
  assert.deepEqual(plain(h.counts), { headers: 3, headerDisposals: 0, footers: 3, footerDisposals: 0 });
  geometry(h);
});

test('nested Horizontal, Vertical and InCell geometry retains child records and field lists', async t => {
  for (const mode of ['Horizontal', 'Vertical', 'InCell']) await t.test(mode, async t => {
    const h = await observe(t, fixture(mode)), group = h.layout().children[0];
    const children = group.children, first = children[0], physical = h.layout().columns;
    const fields = physical[0].fields, groupColumns = group.columns;
    h.set('table', 'children', 0, 'children', 0, 'properties', h.value([property('Width', 32)]));
    assert.equal(h.layout().children[0], group); assert.equal(group.children, children);
    assert.equal(group.children[0], first); assert.equal(group.columns, groupColumns);
    assert.equal(h.layout().columns, physical); assert.equal(physical[0].fields, fields);
    assert.equal(first.node, h.source.table.children[0].children[0]);
    geometry(h);
  });
});

test('reordering, hiding and restoring columns only changes the relevant For owners', async t => {
  const h = await observe(t), before = [...h.layout().children], columns = [...h.layout().columns];
  h.set('table', 'children', [h.source.table.children[2], h.source.table.children[0], h.source.table.children[1]]);
  assert.deepEqual([...h.layout().children], [before[2], before[0], before[1]]);
  assert.deepEqual([...h.layout().columns], [columns[2], columns[0], columns[1]]);
  assert.equal(h.counts.headers, 3); assert.equal(h.counts.headerDisposals, 0);
  h.set('table', 'children', 1, 'presentation', 'displayed', false);
  assert.deepEqual([...h.layout().children], [before[2], before[1]]);
  assert.equal(h.counts.headerDisposals, 1); assert.equal(h.counts.footerDisposals, 1);
  h.set('table', 'children', 1, 'presentation', 'displayed', true);
  assert.notEqual(h.layout().children[1], before[0], 'removed projection entries are released');
  assert.equal(h.layout().children[0], before[2]); assert.equal(h.layout().children[2], before[1]);
  assert.equal(h.counts.headers, 4); assert.equal(h.counts.footers, 4);
  geometry(h);
});

test('replacement source objects are rebound without copying into previous source nodes', async t => {
  const h = await observe(t), header = h.layout().children[0], column = h.layout().columns[0];
  const previousSource = header.node, previousValue = plain(previousSource);
  const next = fixture(); next.children[0].properties.push(property('Width', 32));
  next.children[0].presentation.caption.text = 'Replacement caption';
  h.set('table', h.value(next));
  assert.equal(h.layout().children[0], header); assert.equal(h.layout().columns[0], column);
  assert.notEqual(header.node, previousSource); assert.equal(header.node, h.source.table.children[0]);
  assert.equal(column.fields[0], h.source.table.children[0]);
  assert.deepEqual(plain(previousSource), previousValue, 'the projection never mutates detached source records');
  assert.equal(header.node.presentation.caption.text, 'Replacement caption');
  geometry(h);
});

test('a changed widget kind replaces only that column and its header owner', async t => {
  const h = await observe(t), before = [...h.layout().children];
  h.set('table', 'children', 0, 'kind', 'CheckBoxField');
  assert.notEqual(h.layout().children[0], before[0]);
  assert.equal(h.layout().children[1], before[1]); assert.equal(h.layout().children[2], before[2]);
  assert.equal(h.counts.headers, 4); assert.equal(h.counts.headerDisposals, 1);
  assert.equal(h.counts.footers, 4); assert.equal(h.counts.footerDisposals, 1);
  geometry(h);
});

test('group mode, readonly and locale updates keep valid geometry and source bindings', async t => {
  const h = await observe(t, fixture('Horizontal')), group = h.layout().children[0], children = group.children;
  h.set('table', 'children', 0, 'properties', 0, 'value', 'text', 'Vertical');
  assert.equal(h.layout().children[0], group); assert.equal(group.children, children); geometry(h);
  const compressed = h.layout().columns[0], fields = compressed.fields;
  h.set('table', 'children', 0, 'properties', 0, 'value', 'text', 'InCell');
  assert.equal(h.layout().columns[0], compressed); assert.equal(compressed.fields, fields); geometry(h);
  h.set('table', 'properties', h.value([property('ReadOnly', true), property('Footer', true)]));
  assert.equal(h.layout().columns[0], compressed); geometry(h);
  h.set('locale', 'en'); assert.equal(h.layout().children[0], group); geometry(h);
});

test('unrelated state and source captions leave geometry owners intact; disposal stops projection updates', async t => {
  const h = await observe(t), first = h.layout().children[0], snapshots = h.snapshots.length;
  h.set('phase', 'loading');
  h.set('table', 'children', 0, 'presentation', 'caption', 'text', 'Updated caption');
  assert.equal(h.layout().children[0], first); assert.equal(first.node.presentation.caption.text, 'Updated caption');
  assert.equal(h.snapshots.length, snapshots);
  const tracks = h.layout().tracks; h.dispose();
  h.set('table', 'children', 0, 'properties', h.value([property('Width', 32)]));
  assert.equal(h.layout().tracks, tracks); assert.equal(h.snapshots.length, snapshots);
  assert.equal(h.counts.headerDisposals, h.counts.headers); assert.equal(h.counts.footerDisposals, h.counts.footers);
});
