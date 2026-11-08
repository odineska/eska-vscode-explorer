import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {formReferenceRoot} from './form-references.mjs';

test('unbound buttons bind five canonical forms to ten complete native frames',async()=>{
  const root=new URL('tests/fixtures/forms/native-unbound-buttons/',formReferenceRoot);
  const metrics=JSON.parse(await readFile(new URL('metrics.json',root),'utf8'));
  const manifest=JSON.parse(await readFile(new URL('capture-manifest.json',root),'utf8'));
  assert.equal(metrics.rows.length,5);assert.equal(manifest.captures.length,10);
  assert.equal(manifest.sourcesUnchanged,true);
  assert.ok(manifest.runs.every(run=>run.exitCode===0&&run.sourcesUnchanged));
  for(const row of metrics.rows){
    const xml=await readFile(new URL(row.name+'.xml',root));
    assert.equal(createHash('sha256').update(xml).digest('hex'),row.xmlSha256,row.name);
    assert.match(row.canonicalExportSha256,/^[a-f0-9]{64}$/u);
    assert.match(xml.toString('utf8'),/<Button name="Find"[\s\S]*?<CommandName>0<\/CommandName>/u);
    const {screenshotSha256:ru,...expected}=row.locales.ru;
    const {screenshotSha256:en,...english}=row.locales.en;
    assert.match(ru,/^[a-f0-9]{64}$/u);assert.match(en,/^[a-f0-9]{64}$/u);
    assert.deepEqual(expected,english,row.name);assert.deepEqual(row.hiddenButtons,['Find']);
  }
});
