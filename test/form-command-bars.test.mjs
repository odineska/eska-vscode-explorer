import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { commandBarContent } from '../webview/forms/command-bar-model.mjs';
import { compactCommandBarGroup, displayedInPreview, groupCanShrink, stretches } from '../webview/forms/layout-model.mjs';
import { formReferenceRoot } from './form-references.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';

const node=(kind,properties={},children=[])=>({kind,key:kind,name:kind,children,auxiliary:[],
  properties:Object.entries(properties).map(([name,value])=>({key:{namespace:FORM_NS,name},value:{kind:'text',text:String(value)}})),
  presentation:{displayed:true}});

test('empty or hidden bars and their enclosing group keep source nodes but allocate no surface',()=>{
  const hidden=node('Button');hidden.presentation.displayed=false;
  for(const children of [[],[hidden]]) {
    const bar=node('CommandBar',{},children),group=node('UsualGroup',{},[bar]);
    assert.equal(commandBarContent(group,bar).visible,false);
    assert.equal(displayedInPreview(group),false);
    assert.equal(group.children[0],bar);
    assert.equal(bar.children,children);
  }
  const additional=node('Button',{LocationInCommandBar:'InAdditionalSubmenu'});
  const bar=node('CommandBar',{},[additional]);
  assert.equal(displayedInPreview(bar),true,'an additional menu is visible content');
  assert.deepEqual(commandBarContent(bar,bar).more,[additional]);
});

test('bar visibility uses the same root-bound table projection as rendered commands',()=>{
  const table=node('Table');table.name='Rows';
  const find=node('Button',{CommandName:'Form.Item.Rows.StandardCommand.Find'});
  const bar=node('CommandBar',{CommandSource:'Item.Rows'},[find]);
  const group=node('UsualGroup',{},[bar]),root=node('Form',{},[table,group]);
  assert.equal(displayedInPreview(group,root),false,'empty table has no find command');
  const column=node('InputField');column.presentation.displayed=false;table.children.push(column);
  assert.equal(displayedInPreview(group,root),true,'declared hidden columns still provide standard commands');
  assert.equal(commandBarContent(root,bar).source,table);
  const search=node('SearchStringAddition');table.auxiliary.push(search);
  assert.deepEqual(commandBarContent(root,bar).inline,[],'the automatic Find button is projected into search');
  assert.equal(commandBarContent(root,bar).visible,true,'the projected search retains the bar');
});

test('customization and duplicate additional commands preserve their placement and source identities',()=>{
  const direct=node('Button',{CommandName:'Form.Command.Run'});
  const both=node('Button',{CommandName:'Form.Command.Both',LocationInCommandBar:'InCommandBarAndInAdditionalSubmenu'});
  const customize=node('Button',{CommandName:'Form.StandardCommand.CustomizeForm'});
  const bar=node('CommandBar',{},[direct,both,customize]),content=commandBarContent(bar,bar);
  assert.deepEqual(content.inline,[direct,both]);
  assert.deepEqual(content.more,[both,customize]);
  assert.deepEqual(bar.children,[direct,both,customize]);
});

test('automatic command bars grow, explicit No fixes them, and right placement still reaches the edge',()=>{
  const auto=node('CommandBar',{},[node('Button')]);
  const fixed=node('CommandBar',{HorizontalStretch:false},[node('Button')]);
  const right=node('CommandBar',{HorizontalLocation:'Right',HorizontalStretch:false},[node('Button')]);
  assert.equal(stretches(auto,'x'),true);assert.equal(stretches(fixed,'x'),false);assert.equal(stretches(right,'x'),true);
  assert.equal(stretches(auto,'y'),false);
  const parent=node('UsualGroup',{},[auto,right]);
  assert.equal(stretches(parent,'x'),true);assert.equal(compactCommandBarGroup(parent),false);
  const compact=node('UsualGroup',{HorizontalStretch:false,Width:30},[auto,right]);
  assert.equal(stretches(compact,'x'),false);assert.equal(compactCommandBarGroup(compact),true);
  assert.equal(groupCanShrink(compact,'linux'),true);assert.equal(groupCanShrink(compact,'windows'),false);
  assert.equal(compactCommandBarGroup(node('UsualGroup',{},[fixed])),true);
  assert.equal(compactCommandBarGroup(node('UsualGroup',{HorizontalStretch:false},[node('InputField')])),false);
});

test('the native geometry matrix binds every case to its measured XML and distinct visual identities',async()=>{
  const root=new URL('tests/fixtures/forms/native-command-bars/',formReferenceRoot);
  const metrics=JSON.parse(await readFile(new URL('metrics.json',root),'utf8'));
  assert.equal(metrics.rows.length,38);
  assert.equal(new Set(metrics.rows.map(row=>row.name)).size,38);
  for(const row of metrics.rows) {
    const source=await readFile(new URL(row.name+'.xml',root));
    assert.equal(createHash('sha256').update(source).digest('hex'),row.sourceSha256,row.name);
    const elements=source.toString('utf8').split('<Attributes>')[0];
    const identities=[...elements.matchAll(/\bid="(-?\d+)"/gu)].map(match=>match[1]);
    assert.equal(new Set(identities).size,identities.length,row.name+' visual IDs');
  }
});


test('additional menus reserve trailing space without introducing an empty table surface', () => {
  const table = node('Table'); table.name = 'Rows';
  const find = node('Button', { CommandName: 'Form.Item.Rows.StandardCommand.Find' });
  const additional = node('Button', { CommandName: 'Form.Command.Second', LocationInCommandBar: 'InAdditionalSubmenu' });
  const customize = node('Button', { CommandName: 'Form.StandardCommand.CustomizeForm' });
  const bar = node('CommandBar', { CommandSource: 'Item.Rows' }, [find, additional, customize]);
  const root = node('Form', {}, [table, bar]), content = commandBarContent(root, bar);
  assert.equal(content.source, undefined);
  assert.equal(content.tableCommands, false);
  assert.deepEqual(content.inline, []);
  assert.deepEqual(content.more, [additional, customize]);
  assert.equal(content.spaceBeforeMore, true);
  assert.equal(content.visible, true);
  assert.deepEqual(bar.children, [find, additional, customize]);
  const plain = node('CommandBar', {}, [additional]);
  assert.equal(commandBarContent(plain, plain).spaceBeforeMore, true);
  const direct = node('CommandBar', {}, [node('Button', { CommandName: 'Form.Command.Run' })]);
  assert.equal(commandBarContent(direct, direct).spaceBeforeMore, false);
});

test('native command overflow corpus binds 24 sources and three compatibility probes', async () => {
  const root = new URL('tests/fixtures/forms/native-command-overflow/', formReferenceRoot);
  const metrics = JSON.parse(await readFile(new URL('metrics.json', root), 'utf8'));
  assert.equal(metrics.rows.length, 24);
  assert.equal(new Set(metrics.rows.map(row => row.name)).size, 24);
  assert.equal(metrics.rows.filter(row => row.compatibility24).length, 3);
  for (const row of metrics.rows) {
    const source = await readFile(new URL(row.name + '.xml', root));
    assert.equal(createHash('sha256').update(source).digest('hex'), row.xmlSha256, row.name);
    for (const locale of ['ru', 'en']) {
      const native = row.locales[locale];
      assert.match(native.screenshotSha256, /^[a-f0-9]{64}$/u);
      if (native.commandsPaint.More && row.stretch !== false) {
        assert.equal(native.commandsPaint.More[0] + native.commandsPaint.More[2] + 21, native.frame[0], row.name);
      }
      if (row.compatibility24) {
        const { screenshotSha256: currentHash, ...current } = native;
        const { screenshotSha256: previousHash, ...previous } = row.compatibility24.locales[locale];
        assert.match(currentHash, /^[a-f0-9]{64}$/u); assert.match(previousHash, /^[a-f0-9]{64}$/u);
        assert.deepEqual(current, previous, row.name + '/' + locale);
      }
    }
  }
  const natural = metrics.rows.find(row => row.name === 'NaturalEmptySource');
  assert.deepEqual(natural.locales.ru.frame, [456, 143]);
  assert.deepEqual(natural.locales.en.frame, [504, 143]);
  const plain = metrics.rows.find(row => row.name === 'PlainInputs');
  const single = metrics.rows.find(row => row.name === 'PlainInputsSingle');
  const double = metrics.rows.find(row => row.name === 'PlainInputsDouble');
  assert.deepEqual(plain.locales.ru.fields, single.locales.ru.fields);
  assert.equal(double.locales.ru.fields.Middle[0] - plain.locales.ru.fields.Middle[0], 10);
});
