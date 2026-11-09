import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';
import { tableLayout } from '../webview/forms/table-model.mjs';

const root = new URL('tests/fixtures/forms/native-table-height/', formReferenceRoot);
const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
const property = ([name, text]) => ({key:{namespace:FORM_NS,name},value:{kind:'text',text}});

test('table height corpus binds 54 canonical forms and 108 complete native frames', async () => {
  assert.equal(metrics.rows.length, 54);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 54);
  for (const row of metrics.rows) {
    const xml = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(xml).digest('hex'), row.xmlSha256, row.name);
    const {screenshotSha256:ru,...geometry} = row.locales.ru;
    const {screenshotSha256:en,...english} = row.locales.en;
    assert.match(ru,/^[a-f0-9]{64}$/u); assert.match(en,/^[a-f0-9]{64}$/u);
    assert.deepEqual(english,geometry,row.name);
  }
  const catalog = await readFile(new URL('Catalog.xml',root));
  assert.equal(createHash('sha256').update(catalog).digest('hex'),metrics.catalogSha256);
  const manifest=JSON.parse(await readFile(new URL('capture-manifest.json',root),'utf8'));
  assert.equal(manifest.stands.reduce((sum,stand)=>sum+stand.captures.length,0),108);
  assert.ok(manifest.stands.every(stand=>stand.sourcesUnchanged));
});

test('table font units, caps, row counts and bands match 54 native grids', () => {
  const failures=[];
  for (const row of metrics.rows) {
    const node={key:'Rows',kind:'Table',auxiliary:[],properties:Object.entries(row.properties).map(property),
      presentation:{font:row.font,autoCommandItems:[],valueType:{types:row.family==='Dynamic'?[{namespace:'http://v8.1c.ru/8.1/data/enterprise/current-config',name:'DynamicList'}]:[]}},
      children:row.columns.map(column=>({key:column.name,kind:column.kind,children:[],properties:[],
        presentation:{displayed:true,font:row.font,titleFont:column.titleFont,caption:{kind:'name',text:column.name},valueType:{kind:'string',length:20}}}))};
    const actual=tableLayout(node,{os:'linux'}).height, expected=row.locales.ru.fields.Rows[3];
    if (actual!==expected) failures.push({name:row.name,actual,expected});
  }
  assert.deepEqual(failures,[]);
});
