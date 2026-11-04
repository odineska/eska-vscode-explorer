import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {selectSuites,caseIds} from './form-batch.mjs';
import {verifyRuntime,digest} from './installed-runtime.mjs';
import {deferCleanup} from './cleanup.mjs';

const repository=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const catalog=JSON.parse(await readFile(new URL('./form-suites.json',import.meta.url),'utf8'));
async function fixture(t) {
  const root=await mkdtemp(join(process.env.ESKA_TEST_ROOT??resolve(repository,'../eska-playground'),'form-batch-test-'));
  deferCleanup(t,()=>rm(root,{recursive:true,force:true}));return root;
}
async function archive(root,entries) {
  const input=join(root,'entries.json'),output=join(root,'viewer.vsix');await writeFile(input,JSON.stringify(entries));
  const python=process.env.ESKA_TEST_PYTHON??(process.platform==='win32'?'python':'python3');
  await run(python,['-B','-c',"import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED) as z:\n for name,data in json.load(open(sys.argv[1],encoding='utf-8')).items(): z.writestr(name,data)",input,output]);
  return output;
}
const runtime={
  'out/extension.js':'extension bytes',
  'resources/properties/view.js':'property bytes',
  'out/form-preview.js':'form bytes',
  'out/form-preview.css':'form CSS',
  'out/form-fonts/font-raster-test.wasm':'WASM bytes',
  'out/form-fonts/font-test.ttf':'font bytes',
  'resources/icons/test.svg':'<svg/>'
};
async function trees(root) {
  const checkout=join(root,'checkout'),installed=join(root,'installed');
  for(const path of [checkout,installed])for(const [file,bytes]of Object.entries(runtime)){
    await mkdir(dirname(join(path,file)),{recursive:true});await writeFile(join(path,file),bytes);
  }
  return {checkout,installed};
}
const entries=()=>Object.fromEntries(Object.entries(runtime).map(([path,bytes])=>['extension/'+path,bytes]));

test('form catalogue covers concrete drivers and ledger IDs with whole-suite transitions',async()=>{
  const ids=catalog.suites.map(row=>row.id);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,48);
  const eska=resolve(repository,'../eska'),ledger=JSON.parse(await readFile(join(eska,'tests/fixtures/forms/coverage.json'),'utf8'));
  for(const suite of catalog.suites){
    await readFile(join(repository,suite.driver));assert.equal(suite.caseSelection,'whole-suite-with-existing-transitions');
    for(const path of Object.values(suite.fixtureEnv))assert.ok((await readdir(join(eska,catalog.fixtureRoot,path))).length,path);
  }
  for(const row of ledger.entries)if(row.driver?.repository==='eska-vscode-explorer'){
    const suite=catalog.suites.find(suite=>suite.id===row.driver.suite);assert.ok(suite,row.id);assert.equal(suite.driver,row.driver.path);
  }
  assert.equal(selectSuites(catalog).length,20);
  assert.deepEqual(selectSuites(catalog,{suites:['restore'],locales:['ru']}).map(row=>[row.suite.mode,row.suite.environment.ESKA_HOST_RESTART,row.locale]),[['restart','1','ru']]);
});
test('selection rejects unknown/duplicate suites, unsupported locales and partial transitions',()=>{
  for(const options of [{suites:['missing']},{suites:['preview','preview']},{locales:[]},{locales:['fr']},{locales:['ru','ru']},{preset:'missing'}])assert.throws(()=>selectSuites(catalog,options),{category:'harness'});
  const partial=structuredClone(catalog);partial.suites.find(row=>row.id==='preview').caseSelection='single-case';
  assert.throws(()=>selectSuites(partial,{suites:['preview']}),{code:'suite_contract'});
});
test('receipt case IDs preserve dirty and floating cases rather than fixture count',()=>{
  const result={results:[{label:'Base'},{name:'dirty-Other'},{kind:'floating-Base'},{label:'reattached-Base'}]};
  assert.deepEqual(caseIds(result,'preview'),['preview/Base','preview/dirty-Other','preview/floating-Base','preview/reattached-Base']);
  assert.deepEqual(caseIds({passed:true},'restore'),['restore/suite']);
  assert.deepEqual(caseIds(undefined,'failed'),[]);
});
test('packaged bytes are checked across every runtime asset',async t=>{
  const root=await fixture(t),paths=await trees(root),vsix=await archive(root,{...entries(),'extension/package.json':'{}'});
  const result=await verifyRuntime(vsix,{...paths,forms:true});
  assert.equal(result.files.length,Object.keys(runtime).length);
  assert.equal(result.vsixSha256,digest(await readFile(vsix)));
  assert.equal(result.files.find(row=>row.path==='out/form-fonts/font-test.ttf').sha256,digest('font bytes'));
  assert.deepEqual(await verifyRuntime(vsix,{...paths,forms:true}),result);
});
test('stale WASM and CSS fail even while extension and property JS are unchanged',async t=>{
  const root=await fixture(t),paths=await trees(root),vsix=await archive(root,entries());
  for(const [kind,path]of [['installed','out/form-fonts/font-raster-test.wasm'],['checkout','out/form-preview.css'],['installed','resources/icons/test.svg']]){
    await writeFile(join(paths[kind],path),'stale');
    await assert.rejects(verifyRuntime(vsix,{...paths,forms:true}),error=>error.code==='runtime_asset_mismatch'&&error.category==='harness'&&error.context.kind===kind&&error.context.path===path);
    await writeFile(join(paths[kind],path),runtime[path]);
  }
});
test('missing form raster resources cannot pass installed form acceptance',async t=>{
  const root=await fixture(t),paths=await trees(root),input=entries();delete input['extension/out/form-fonts/font-raster-test.wasm'];
  const vsix=await archive(root,input);
  await assert.rejects(verifyRuntime(vsix,{...paths,forms:true}),{code:'vsix_runtime_missing'});
  await rm(join(paths.installed,'out/form-preview.css'));
  await assert.rejects(verifyRuntime(await archive(root,entries()),{...paths,forms:true}),{code:'runtime_asset_missing'});
});
test('CLI catalogue inspection requires no native host or build',async()=>{
  const result=await run(process.execPath,['test/form-batch.mjs','--list'],{cwd:repository,env:{...process.env,VSCODE_EXECUTABLE:'',ESKA_TEST_BINARY:''}});
  assert.deepEqual(JSON.parse(result.stdout),catalog);assert.equal(result.stderr,'');
  await assert.rejects(run(process.execPath,['test/form-batch.mjs','--suite','missing'],{cwd:repository}),error=>error.code===1&&JSON.parse(error.stderr).error.code==='unknown_suite');
});
