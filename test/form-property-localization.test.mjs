import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import solid from 'babel-preset-solid';

const repository=fileURLToPath(new URL('../',import.meta.url));
const rendered=build({
  stdin:{contents:`import { renderToString } from 'solid-js/web';import { PropertyValue } from './webview/forms/PropertyValue.jsx';
    export const render=(field,locale)=>renderToString(()=>PropertyValue({field,state:{locale,strings:{details:'Details'}}}));`,resolveDir:repository},
  bundle:true,write:false,platform:'node',format:'cjs',conditions:['node'],define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'solid-ssr',setup(builder){builder.onLoad({filter:/\.jsx$/},async args=>({contents:(await transformAsync(await readFile(args.path,'utf8'),{filename:args.path,presets:[[solid,{generate:'ssr',hydratable:false}]],babelrc:false,configFile:false})).code,loader:'js'}));}}],
}).then(bundle=>{
  const module={exports:{}};runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),setTimeout,clearTimeout});return module.exports.render;
});
const core='http://v8.1c.ru/8.1/data/core';
const caption={'ru-RU':'Локализованная строка','en-US':'LocalizedString'};
const child=(name,value,qualifiers=[])=>({key:{namespace:core,name},qualifiers,value});
const valueText=text=>({kind:'text',text});
const record=items=>({kind:'record',caption,fields:items.map(([language,content])=>child('item',{kind:'record',fields:[child('lang',valueText(language)),child('content',valueText(content))]}))});
const field=(value,qualifiers=[])=>({key:{namespace:'http://v8.1c.ru/8.3/xcf/logform',name:'Title'},qualifiers,value});
async function html(value,locale='ru-RU',qualifiers=[]) {
  const input=field(value,qualifiers),before=structuredClone(input),result=(await rendered)(input,locale);
  assert.deepEqual(input,before,'rendering preserves the complete source value and annotations');return result;
}

test('one recognized localization is plain text in both UI languages, including literal booleans',async()=>{
  for(const locale of ['ru-RU','en-US'])for(const value of [record([['ru','Одна строка']]),{kind:'localized',caption,items:[{language:'ru',content:'Одна строка'}]}]){
    const result=await html(value,locale);assert.match(result,/<span>Одна строка<\/span>/);assert.doesNotMatch(result,/details|LocalizedString|Локализованная строка/);
  }
  assert.doesNotMatch(await html(record([['ru','true']])),/<input/);
});

test('a sole variant in another language stays visible without a language wrapper',async()=>{
  for(const locale of ['ru-RU','en-US']){
    const result=await html(record([['de','Nur Deutsch']]),locale);assert.match(result,/<span>Nur Deutsch<\/span>/);assert.doesNotMatch(result,/<details|<dt|LocalizedString/);
  }
});

test('zero variants and an explicitly empty sole content render empty without a type caption',async()=>{
  for(const value of [{kind:'localized',caption,items:[]},{kind:'localized',caption,items:[{language:'en',content:''}]},record([['ru','']])]){
    const result=await html(value);assert.match(result,/<span><\/span>/);assert.doesNotMatch(result,/details|LocalizedString|Локализованная строка|undefined/);
  }
});

test('several variants retain a language collection and prefer the UI language in its summary',async()=>{
  const value=record([['ru','Русский текст'],['en','English text']]);
  for(const [locale,expected] of [['ru-RU','Русский текст'],['en-US','English text']]){
    const result=await html(value,locale);assert.match(result,/form-property-localized/);assert.ok(result.includes('<summary>'+expected+'</summary>'));assert.doesNotMatch(result,/LocalizedString|Локализованная строка/);
  }
});

test('outer qualifiers remain visible beside a flattened sole localization',async()=>{
  const result=await html(record([['ru','Text']]),'en-US',[{key:{namespace:'urn:test',name:'note'},value:'retained'}]);
  assert.match(result,/<span>Text<\/span>/);assert.match(result,/form-property-qualifiers/);assert.match(result,/retained/);assert.doesNotMatch(result,/<details/);
});

test('annotated or nonstandard inner wrappers retain generic structured inspection',async()=>{
  const annotated=record([['ru','Text']]);annotated.fields[0].qualifiers=[{key:{namespace:'urn:test',name:'note'},value:'retained'}];
  const extra=record([['ru','Text']]);extra.fields.push({key:{namespace:'urn:test',name:'extra'},qualifiers:[],value:valueText('kept')});
  for(const value of [annotated,extra]){const result=await html(value);assert.match(result,/<details/);assert.doesNotMatch(result,/form-property-localized/);}
});

test('plain localized content is escaped as text and never interpreted as markup',async()=>{
  const result=await html(record([['en','<script>unsafe()</script> & text']]));assert.match(result,/&lt;script>/);assert.doesNotMatch(result,/<script>/);
});
