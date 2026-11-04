import { readFile,writeFile,readdir,mkdir,mkdtemp,copyFile,cp,chmod } from 'node:fs/promises';
import { join,resolve,relative,isAbsolute } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import os from 'node:os';
import { digest,verifyRuntime,harnessFailure } from './installed-runtime.mjs';

const run = promisify(execFile), repository = fileURLToPath(new URL('../',import.meta.url));
const sorted = values => values.sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
const hashFile = async path => digest(await readFile(path));
async function files(root) {
  const output=[];
  async function visit(folder) { for(const entry of await readdir(folder,{withFileTypes:true})) {
    const path=join(folder,entry.name);
    if(entry.isDirectory())await visit(path);else if(entry.isFile())output.push(path);else throw harnessFailure('snapshot_nonregular_path',{path});
  }}
  await visit(root);return sorted(output);
}
async function hashes(root,paths) { return Promise.all(paths.map(async path => ({path:relative(root,path).split('\\').join('/'),sha256:await hashFile(path)}))); }
async function gitState(root) {
  const head=await run('git',['rev-parse','HEAD'],{cwd:root}),status=await run('git',['status','--porcelain=v1','-z'],{cwd:root,encoding:'buffer'});
  return {head:head.stdout.trim(),dirty:status.stdout.length>0,statusPorcelainZBase64:status.stdout.toString('base64')};
}
async function port() { const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value; }

export function selectSuites(catalog,{suites,preset='buttons',locales=['en','ru']}={}) {
  if(catalog.schemaVersion!==1||catalog.guiConcurrency!==1)throw harnessFailure('suite_catalog_schema');
  const names=suites?.length?suites:catalog.presets[preset];
  if(!names?.length||new Set(names).size!==names.length)throw harnessFailure('suite_selection',{preset});
  if(!locales.length||new Set(locales).size!==locales.length||locales.some(locale=>!['en','ru'].includes(locale)))throw harnessFailure('suite_locales');
  return names.flatMap(id=>{const suite=catalog.suites.find(row=>row.id===id);if(!suite)throw harnessFailure('unknown_suite',{id});
    if(suite.caseSelection!=='whole-suite-with-existing-transitions'||locales.some(locale=>!suite.locales.includes(locale)))throw harnessFailure('suite_contract',{id});
    return locales.map(locale=>({suite,locale}));});
}
export function caseIds(result,suite) {
  if(!result)return [];
  const rows=result.results??result.cases;
  if(Array.isArray(rows))return rows.map((row,index)=>`${suite}/${row.label??row.name??row.kind??index}`);
  return [`${suite}/suite`];
}
function options(args) {
  return parseArgs({args,options:{'eska-root':{type:'string'},backend:{type:'string'},code:{type:'string'},'cli-js':{type:'string'},'ru-language-pack':{type:'string'},suite:{type:'string',multiple:true},preset:{type:'string'},locales:{type:'string'},'build-tool':{type:'string'},'application-project':{type:'string'},'application-samples':{type:'string'},list:{type:'boolean'},help:{type:'boolean'}}}).values;
}

export async function main(args) {
  const value=options(args),catalog=JSON.parse(await readFile(join(repository,'test/form-suites.json'),'utf8'));
  if(value.help)return {usage:'node test/form-batch.mjs --eska-root <path> --backend <binary> --code <executable> [--cli-js <file>] --ru-language-pack <directory> [--preset buttons|appearance|sessions] [--suite <id>] [--locales en,ru]',output:'json'};
  if(value.list)return catalog;
  const queue=selectSuites(catalog,{suites:value.suite,preset:value.preset,locales:(value.locales??'en,ru').split(',')});
  const eska=resolve(value['eska-root']??join(repository,'../eska')),playground=resolve(eska,'../eska-playground');
  const binary=resolve(value.backend??join(eska,'target/debug/eska-project'+(process.platform==='win32'?'.exe':''))),code=value.code??process.env.VSCODE_EXECUTABLE,cli=value['cli-js']??process.env.VSCODE_CLI_JS,language=value['ru-language-pack']??process.env.ESKA_HOST_LANGUAGE_PACK_DIRECTORY;
  if(!code||!isAbsolute(code)||cli&&!isAbsolute(cli))throw harnessFailure('code_path_required');
  if(queue.some(row=>row.locale==='ru')&&(!language||!isAbsolute(language)))throw harnessFailure('ru_language_pack_required');
  for(const {suite}of queue)for(const option of suite.requiredOptions??[])if(!value[option])throw harnessFailure('suite_option_required',{suite:suite.id,option});
  await readFile(binary);await readdir(playground);
  const root=await mkdtemp(join(playground,'form-batch-')),artifacts=join(root,'artifacts');await mkdir(artifacts);
  const summary={schemaVersion:1,passed:false,root,startedAt:new Date().toISOString(),guiConcurrency:1,builds:0,packages:0,runs:[],timings:{}};
  const save=()=>writeFile(join(root,'batch.json'),JSON.stringify(summary,null,2)+'\n');
  const started=performance.now();await save();
  const witnessPaths=async()=>sorted([...await files(join(repository,'src')),...await files(join(repository,'webview')),...await files(join(repository,'test')),...await files(join(repository,'scripts')),join(repository,'package.json'),join(repository,'bun.lock')]);
  const witness=await hashes(repository,await witnessPaths());
  async function stable() { if(digest(JSON.stringify(await hashes(repository,await witnessPaths())))!==digest(JSON.stringify(witness)))throw harnessFailure('batch_inputs_changed'); }
  async function command(name,executable,args) {
    const log=join(root,name+'.log'),begin=performance.now(),output=createWriteStream(log);
    const child=spawn(executable,args,{cwd:repository,stdio:['ignore','pipe','pipe']});child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
    const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});await new Promise(resolve=>output.end(resolve));
    summary.timings[name+'Ms']=performance.now()-begin;await save();if(result.code!==0)throw harnessFailure('batch_command_failed',{name,...result,log});
  }
  try {
    const buildTool=value['build-tool']??(process.platform==='win32'?'bun.exe':'bun');
    await command('check',buildTool,['run','check']);await command('compile',buildTool,['run','compile']);summary.builds++;
    const vsix=join(artifacts,'viewer.vsix');await command('package',process.execPath,[join(repository,'node_modules/@vscode/vsce/vsce'),'package','--no-dependencies','--no-rewrite-relative-links','--out',vsix]);summary.packages++;
    await stable();
    const freezeStarted=performance.now(),runtime=await verifyRuntime(vsix,{checkout:repository,forms:true});
    const backend=join(artifacts,'eska-project'+(process.platform==='win32'?'.exe':''));await copyFile(binary,backend);await chmod(backend,0o555);await chmod(vsix,0o444);
    const fixtureSource=join(eska,catalog.fixtureRoot),fixtureRoot=join(root,'fixtures');await cp(fixtureSource,fixtureRoot,{recursive:true});
    const fixtureHashes=await hashes(fixtureRoot,await files(fixtureRoot));
    let languageRoot,languageFiles;
    if(language){languageRoot=join(artifacts,'language-pack');await cp(language,languageRoot,{recursive:true});languageFiles=await hashes(languageRoot,await files(languageRoot));}
    const corePaths=sorted([...await files(join(eska,'crates')),...await files(join(eska,'src')),join(eska,'Cargo.toml'),join(eska,'Cargo.lock')]);
    const environment={platform:process.platform,arch:process.arch,release:os.release(),node:process.version,DISPLAY:process.env.DISPLAY,WAYLAND_DISPLAY:process.env.WAYLAND_DISPLAY,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL};
    const snapshot={schemaVersion:1,eska:await gitState(eska),explorer:await gitState(repository),backend:{source:binary,sha256:await hashFile(backend),rustBuildPerformed:false},vsix:{path:vsix,sha256:runtime.vsixSha256},runtimeAssets:runtime,driverAndSourceFiles:witness,coreSourceFiles:await hashes(eska,corePaths),fixtures:fixtureHashes,environment,code:{path:code,sha256:await hashFile(code),cliPath:cli,cliSha256:cli?await hashFile(cli):undefined},languagePack:languageRoot?{source:language,path:languageRoot,files:languageFiles}:undefined};
    await writeFile(join(root,'inputs.json'),JSON.stringify(snapshot,null,2)+'\n');summary.timings.freezeInputsMs=performance.now()-freezeStarted;
    for(const {suite,locale}of queue) {
      await stable();
      const dir=join(root,suite.id+'-'+locale);await mkdir(dir);const receipt=join(dir,'receipt.json'),output=join(dir,'driver.log'),full=join(dir,'host.log');
      const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ESKA_'))delete env[key];
      Object.assign(env,{ESKA_TEST_ROOT:playground,ESKA_TEST_BACKEND:'project',ESKA_TEST_BINARY:backend,ESKA_TEST_VSIX:vsix,VSCODE_EXECUTABLE:code,ESKA_HOST_LOCALE:locale,ESKA_HOST_DEBUG_PORT:String(await port()),ESKA_HOST_SUPPORT_DISABLED:'1',ESKA_BSL_DISABLED:'1',ESKA_HOST_FULL_LOG:full,ESKA_SCREENSHOT_DIR:dir,ESKA_HOST_RECEIPT:receipt,...suite.environment});
      if(cli)env.VSCODE_CLI_JS=cli;else delete env.VSCODE_CLI_JS;
      if(locale==='ru')env.ESKA_HOST_LANGUAGE_PACK_DIRECTORY=languageRoot;
      for(const [key,path]of Object.entries(suite.fixtureEnv))env[key]=join(fixtureRoot,path);
      for(const [key,path]of Object.entries(suite.explorerPathEnv??{}))env[key]=join(repository,path);
      if(suite.id==='application'){env.ESKA_PERF_PROJECT=resolve(value['application-project']);env.ESKA_FORM_SAMPLE_PATHS=await readFile(resolve(value['application-samples']),'utf8');}
      const begin=performance.now(),log=createWriteStream(output),child=spawn(process.execPath,[join(repository,'test/run-host.mjs'),suite.driver],{cwd:repository,env,stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});summary.active={suite:suite.id,locale,pid:child.pid,debugPort:Number(env.ESKA_HOST_DEBUG_PORT)};await save();
      const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});await new Promise(resolve=>log.end(resolve));delete summary.active;
      const result=await readFile(receipt,'utf8').then(JSON.parse).catch(()=>undefined);let inputsStable=true,inputFailure;
      try{await stable();if(digest(JSON.stringify(await hashes(fixtureRoot,await files(fixtureRoot))))!==digest(JSON.stringify(fixtureHashes)))throw harnessFailure('batch_fixtures_changed');}catch(error){inputsStable=false;inputFailure={code:error.code??'batch_inputs_changed',message:String(error.message)};}
      const actual=result?.runs?.filter(run=>run.phase==='suite')??[],row={suite:suite.id,locale,mode:suite.mode,exitCode:exit.code,signal:exit.signal,seconds:(performance.now()-begin)/1000,passed:exit.code===0&&result?.passed===true&&inputsStable,inputsStable,inputFailure,classification:inputsStable&&result?((result.failure??result.cleanupFailure)?.category??(exit.code===0&&result.passed===true?'passed':'unclassified')):'harness',log:relative(root,output),receipt:relative(root,receipt),caseIds:actual.flatMap(run=>caseIds(run.result,suite.id)),hostStarts:result?.runs?.length??0,languageRegistrations:result?.runs?.filter(run=>run.phase==='language-registration').length??0,timings:result?.timings};
      summary.runs.push(row);await save();console.log(JSON.stringify({suite:row.suite,locale,passed:row.passed,seconds:row.seconds,caseIds:row.caseIds.length}));
      // A changed input set invalidates subsequent runs. Other failures retain their
      // isolated result and do not turn later suites into a shared dirty host.
      if(!inputsStable)break;
    }
    summary.passed=summary.runs.length===queue.length&&summary.runs.every(row=>row.passed);
  } catch(error) { summary.failure={category:error.category??'harness',code:error.code??'batch_failed',message:String(error.stack??error),context:error.context}; }
  summary.timings.totalMs=performance.now()-started;summary.finishedAt=new Date().toISOString();await save();return summary;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try{const result=await main(process.argv.slice(2));console.log(JSON.stringify(result.runs?{passed:result.passed,root:result.root,runs:result.runs.length,caseIds:result.runs.reduce((sum,row)=>sum+row.caseIds.length,0),timings:result.timings,failure:result.failure}:result));if(result.passed===false)process.exitCode=1;}
  catch(error){console.error(JSON.stringify({passed:false,error:{code:error.code??'batch_failed',message:String(error.message),context:error.context}}));process.exitCode=1;}
}
