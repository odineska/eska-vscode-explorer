import test from 'node:test';
import assert from 'node:assert/strict';
import { FORM_NS } from '../webview/forms/model.mjs';
import { menuCaption, menuChildren, menuEnabled, menuSeparator, menuShortcut, tableCommandRows } from '../webview/forms/command-menu-model.mjs';

const property = (name, text) => ({key:{namespace:FORM_NS,name},value:{kind:'text',text}});
const action = name => ({key:'Table.StandardCommand.'+name,caption:{kind:'standard',key:'command.'+name}});
const keys = items => items.map(item=>item===menuSeparator?'separator':item.key);
const button = (name, location='Auto') => ({key:'declared-'+name,kind:'Button',children:[],presentation:{displayed:true},
  properties:[property('CommandName','Form.Item.Rows.StandardCommand.'+name),property('LocationInCommandBar',location)]});

test('the list menu includes sections independently of the inline overflow', () => {
  const create=action('Create'), copy=action('Copy'), refresh=action('Refresh'), settings=action('ListSettings');
  const table={name:'Rows',presentation:{tableCommandMenu:[[create,copy,refresh],[],[settings]]}};
  assert.deepEqual(keys(tableCommandRows(table,[])),keys([create,copy,refresh,menuSeparator,settings]));
  const explicit={...button('Create'),picture:{kind:'standard',name:'Custom'},shortcut:'Ins'};
  const rows=tableCommandRows(table,[explicit,button('Copy','InCommandBar')]);
  assert.deepEqual(keys(rows),['declared-Create',refresh.key,'separator',settings.key]);
  assert.equal(rows[0].properties,explicit.properties);
  assert.equal(rows[0].picture,explicit.picture);
  assert.equal(menuShortcut(rows[0]),'Ins');
  assert.deepEqual(table.presentation.tableCommandMenu,[[create,copy,refresh],[],[settings]]);
});

test('linked command bars use their own authored entries and the same source projection', () => {
  const create={...action('Create'),shortcut:'Ins',picture:{kind:'standard',name:'Create'}};
  const table={name:'Rows',presentation:{}}, manual=button('Create','InAdditionalSubmenu');
  const rows=tableCommandRows(table,[manual],[],[[create]]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].key,manual.key);
  assert.equal(rows[0].picture,create.picture);
  assert.equal(rows[0].shortcut,'Ins');
  assert.deepEqual(keys(tableCommandRows(table,[],[create])),[create.key]);
  assert.deepEqual(tableCommandRows(table,[]),[]);
});

test('nested menus retain section boundaries and unavailable search history', () => {
  const find=action('Find'), history={...action('SearchHistory'),beginGroup:true,enabled:false};
  const cancel={...action('CancelSearch'),beginGroup:true,shortcut:'Ctrl+Q'};
  assert.deepEqual(menuChildren({items:[find,history,cancel]}),[find,menuSeparator,history,menuSeparator,cancel]);
  assert.deepEqual(menuChildren({items:[history,cancel]}),[history,menuSeparator,cancel]);
  assert.equal(menuEnabled(history),false);
  assert.equal(menuEnabled(find),true);
  assert.equal(menuEnabled({...button('Create'),properties:[property('Enabled','false')]}),false);
  assert.equal(menuShortcut(cancel),'Ctrl+Q');
});

test('journal creation entries sort by their displayed synonyms without mutating the source', () => {
  const first={...action('First'),orderByCaption:true,caption:{kind:'literal',items:[{language:'en',content:'Zebra'},{language:'ru',content:'Арбуз'}]}};
  const second={...action('Second'),orderByCaption:true,caption:{kind:'literal',items:[{language:'en',content:'Apple'},{language:'ru',content:'Яблоко'}]}};
  const menu={items:[first,second]};
  assert.deepEqual(menuChildren(menu,{locale:'en-US',strings:{}}),[second,first]);
  assert.deepEqual(menuChildren(menu,{locale:'ru-RU',strings:{}}),[first,second]);
  assert.deepEqual(menu.items,[first,second]);
});

test('authored standard actions retain the projected caption and submenu until explicitly titled', () => {
  const find={...action('Find'),caption:{kind:'standard',key:'command.AdvancedSearch'}};
  const create={...action('Create'),items:[{...action('Invoice'),caption:{kind:'name',text:'Invoice'}}]};
  const table={name:'Rows',presentation:{tableCommandMenu:[[find,create]]}};
  const declared=button('Find'), declaredCreate=button('Create');
  declared.presentation.caption={kind:'standard',key:'command.Find'};
  const state={locale:'en-US',strings:{'command.AdvancedSearch':'Advanced search','command.Find':'Find...'}};
  const [projectedFind,projectedCreate]=tableCommandRows(table,[declared,declaredCreate]);
  assert.equal(menuCaption(projectedFind,state,false),'Advanced search');
  assert.deepEqual(menuChildren(projectedCreate,state),create.items);
  declared.properties.push(property('Title','Custom'));
  declared.presentation.caption={kind:'name',text:'Custom'};
  assert.equal(menuCaption(tableCommandRows(table,[declared])[0],state,false),'Custom');
  assert.equal(menuEnabled({...projectedFind,enabled:false}),false);
});
