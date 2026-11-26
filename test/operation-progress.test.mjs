import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OperationProgress } = require('../out/operation-progress.js');
const { RuntimeProgressReader, runtimeJson } = require('../out/runtime-tools.js');

for (const language of ['ru', 'en']) test(`live progress only displays trusted codes (${language})`, () => {
  let now = 0;
  const reports = [];
  const progress = new OperationProgress(language, value => reports.push(value), () => now);
  try {
    progress.event({ schema_version: 1, kind: 'operation_progress', phase: 'apply', event: 'native', step: 'process_database_structure', component: 'secret/password', details: 'password' });
    assert.ok(reports.at(-1).includes(language === 'ru' ? 'Обработка структуры' : 'Processing database'));
    assert.ok(!reports.at(-1).includes('secret'));
    const count = reports.length;
    now = 90_000;
    progress.event({ schema_version: 1, kind: 'operation_progress', phase: 'apply', event: 'heartbeat' });
    progress.event({ schema_version: 1, kind: 'operation_progress', phase: 'apply', event: 'native', step: 'secret' });
    progress.event({ schema_version: 1, kind: 'operation_progress', phase: '__proto__', event: 'stage' });
    assert.equal(reports.length, count + 1);
    progress.event({ schema_version: 1, kind: 'operation_progress', phase: 'apply', event: 'activity' });
    assert.ok(reports.at(-1).includes('1:30'));
    progress.dispose();
    progress.update('late');
    assert.equal(reports.length, count + 2);
  } finally { progress.dispose(); }
});

test('stream reader handles fragmentation, CRLF, oversized diagnostics and unterminated final event', () => {
  const events = [];
  const reader = new RuntimeProgressReader(value => events.push(value), 100);
  reader.write('{"first":'); reader.write('1}\r\n');
  reader.write('x'.repeat(1000)); reader.write('\n{"last":2}'); reader.end();
  assert.deepEqual(events, [{ first: 1 }, { last: 2 }]);
});

test('long live stderr does not exhaust the stdout response budget', async () => {
  let events = 0;
  const result = await runtimeJson(process.execPath, ['-e', `
    for(let i=0;i<20000;i++) process.stderr.write('{"schema_version":1,"kind":"operation_progress","event":"heartbeat"}\\n');
    process.stdout.write('{"status":"finished"}');`], {
    timeout: 10000, maxOutputBytes: 100, onProgress: () => events++,
  });
  assert.deepEqual(result, { status: 'finished' });
  assert.equal(events, 20000);
});

test('cancellation ends a streaming child without a success result', async () => {
  const controller = new AbortController();
  let events = 0;
  const result = await runtimeJson(process.execPath, ['-e', `setInterval(()=>process.stderr.write('{"tick":1}\\n'),10)`], {
    timeout: 10000, signal: controller.signal, onProgress: () => { events++; controller.abort(); },
  });
  assert.equal(result, undefined);
  assert.ok(events > 0);
});


test('backend heartbeat preserves native silence and phase transitions clear the previous step', () => {
  let now = 0;
  const reports = [], history = [];
  const progress = new OperationProgress('en', value => reports.push(value), () => now, line => history.push(line));
  try {
    progress.event({schema_version:1,kind:'operation_progress',event:'native',phase:'apply',step:'process_database_structure',quiet_ms:0});
    now = 120000;
    progress.event({schema_version:1,kind:'operation_progress',event:'heartbeat',phase:'apply',quiet_ms:90000,native_lines:42});
    assert.match(reports.at(-1), /Last message 1:30 ago/);
    assert.match(reports.at(-1), /Platform messages: 42/);
    assert.equal(history.length, 1);
    progress.event({schema_version:1,kind:'operation_progress',event:'heartbeat',phase:'verify',quiet_ms:null});
    assert.match(reports.at(-1), /Verifying the result/);
    assert.doesNotMatch(reports.at(-1), /Processing database/);
    assert.match(reports.at(-1), /Waiting for platform messages/);
  } finally { progress.dispose(); }
});


test('database-file changes are separate evidence and do not reset native silence or step', () => {
  let now = 0;
  const reports = [];
  const progress = new OperationProgress('en', value => reports.push(value), () => now);
  try {
    progress.event({schema_version:1,kind:'operation_progress',event:'native',phase:'apply',step:'update_database',quiet_ms:0});
    now = 120000;
    progress.event({schema_version:1,kind:'operation_progress',event:'database_file_changed',phase:'apply',quiet_ms:120000,db_change_age_ms:0,stage_elapsed_ms:100000});
    assert.match(reports.at(-1), /Last message 2:00 ago/);
    assert.match(reports.at(-1), /Database file changed 0:00 ago/);
    assert.match(reports.at(-1), /Stage 1:40/);
    assert.match(reports.at(-1), /Updating database configuration/);
    now = 180000;
    progress.event({schema_version:1,kind:'operation_progress',event:'heartbeat',phase:'apply',quiet_ms:180000,db_change_age_ms:60000});
    assert.match(reports.at(-1), /Last message 3:00 ago/);
    assert.match(reports.at(-1), /Database file changed 1:00 ago/);
  } finally { progress.dispose(); }
});

for (const language of ['ru', 'en']) test(`new objects and aggregated heartbeat remain validated (${language})`, () => {
  const reports = [], history = [];
  const progress = new OperationProgress(language, value => reports.push(value), () => 0, line => history.push(line));
  try {
    const base = {schema_version:1,kind:'operation_progress',phase:'apply',event:'native',step:'object_added'};
    progress.event({...base,object:'Справочник.NativeGoods',objects_seen:17});
    assert.match(reports.at(-1), /Справочник.NativeGoods/);
    assert.match(reports.at(-1), /17/);
    progress.event({...base,event:'heartbeat',object:'Catalog.OtherGoods',objects_seen:23});
    assert.match(reports.at(-1), /Catalog.OtherGoods/);
    assert.match(reports.at(-1), /23/);
    const count = reports.length;
    for (const object of ['Catalog.X\npassword', 'http://user:password', 'Unknown.Foo', 'Catalog.Parent.Child', 'Catalog.' + 'x'.repeat(129)])
      progress.event({...base,object,component:'Changed',objects_seen:999});
    assert.equal(reports.length, count);
    assert.ok(history.every(line => !line.includes('password')));
  } finally { progress.dispose(); }
});

test('component change or omission clears native, database and counter state even within one phase', () => {
  const reports = [];
  let now = 0;
  const progress = new OperationProgress('en', value => reports.push(value), () => now);
  try {
    const base = {schema_version:1,kind:'operation_progress',phase:'apply'};
    const first = {...base,event:'native',step:'object_added',object:'Catalog.First',component:'First',objects_seen:5,native_lines:19,quiet_ms:0,db_change_age_ms:0};
    progress.event(first);
    now = 10000;
    progress.event({...base,event:'native',step:'unknown',component:'Unknown'});
    assert.match(reports.at(-1), /Catalog.First/);
    progress.event({...base,event:'heartbeat',component:'Second'});
    assert.match(reports.at(-1), /Second/);
    assert.doesNotMatch(reports.at(-1), /Catalog.First|Platform messages|Object messages|Database file changed/);
    progress.event(first);
    progress.event({...base,event:'heartbeat'});
    assert.doesNotMatch(reports.at(-1), /First|Platform messages|Object messages|Database file changed/);
  } finally { progress.dispose(); }
});

test('timer advances only time and disposal prevents further updates', async () => {
  const reports = [];
  let now = 0;
  const progress = new OperationProgress('en', value => reports.push(value), () => now);
  progress.event({schema_version:1,kind:'operation_progress',event:'stage',phase:'prepare_sources'});
  now = 42000;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.match(reports.at(-1), /Preparing sources/);
  assert.match(reports.at(-1), /Elapsed 0:42/);
  progress.dispose();
  const count = reports.length;
  progress.event({schema_version:1,kind:'operation_progress',event:'stage',phase:'publish_artifact'});
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(reports.length, count);
});

test('history uses bounded batch trimming for very large native streams', () => {
  const { operationHistory } = require('../out/operation-output.js');
  let replacements = 0, appends = 0;
  const lines = [];
  const channel = {
    appendLine(line) { appends++; lines.push(line); },
    replace(value) { replacements++; lines.splice(0, lines.length, ...value.trimEnd().split('\n')); },
  };
  const api = { window: { createOutputChannel: () => channel } };
  for (let index = 0; index < 100000; index++) operationHistory(api, String(index));
  assert.ok(replacements < 1100);
  assert.ok(appends > 98000);
  assert.ok(lines.length <= 300);
  assert.equal(lines.at(-1), '99999');
});


test('native object restructuring remains visible during a long silent heartbeat', () => {
  const reports = [];
  const progress = new OperationProgress('ru', value => reports.push(value), () => 3600000);
  try {
    const base = {schema_version:1,kind:'operation_progress',phase:'apply',object:'РегистрРасчета.Показатели'};
    progress.event({...base,event:'native',step:'object_modified',objects_seen:1});
    assert.match(reports.at(-1), /1С сообщила об изменении/);
    progress.event({...base,event:'native',step:'object_restructuring',objects_seen:2});
    assert.match(reports.at(-1), /1С реструктурирует/);
    progress.event({...base,event:'heartbeat',step:'object_restructuring',objects_seen:3,quiet_ms:3600000});
    assert.match(reports.at(-1), /1С реструктурирует РегистрРасчета.Показатели/);
    assert.match(reports.at(-1), /Последнее сообщение 1:00:00 назад/);
    assert.match(reports.at(-1), /Сообщений об объектах: 3/);
  } finally { progress.dispose(); }
});


test('unterminated stderr larger than the response budget cannot kill a streamed operation', async () => {
  const events = [];
  const result = await runtimeJson(process.execPath, ['-e', `
    process.stderr.write('x'.repeat(34*1024*1024));
    process.stderr.write('\\n{"schema_version":1,"kind":"operation_progress","event":"native","phase":"apply","step":"database_updated"}');
    process.stdout.write('{"error":{"code":"native_failure"}}'); process.exitCode=1;`], {
    timeout: 10000, maxOutputBytes: 100, onProgress: event => events.push(event),
  });
  assert.deepEqual(result, {error:{code:'native_failure'}});
  assert.equal(events.length, 1);
  assert.equal(events[0].step, 'database_updated');
});


test('live subprocesses opt in without changing ordinary CLI output', async () => {
  const script = 'process.stdout.write(JSON.stringify({progress:process.env.ESKA_OPERATION_PROGRESS??null}))';
  const live = await runtimeJson(process.execPath, ['-e', script], {timeout:10000,onProgress:()=>{}});
  assert.equal(live.progress, '1');
  const ordinary = await runtimeJson(process.execPath, ['-e', script], {timeout:10000});
  assert.equal(ordinary.progress, process.env.ESKA_OPERATION_PROGRESS ?? null);
});


test('module counters show real analyzer activity independently of platform messages', () => {
  const reports = [];
  let now = 0;
  const progress = new OperationProgress('ru', value => reports.push(value), () => now);
  try {
    const base = {schema_version:1,kind:'operation_progress',event:'stage',phase:'analyze_modules'};
    progress.event({...base,processed_modules:0,total_modules:10,native_lines:0});
    assert.match(reports.at(-1), /Модулей проверено: 0 из 10/);
    assert.doesNotMatch(reports.at(-1), /[Сс]ообщений платформы/);
    progress.event({...base,processed_modules:3,total_modules:10});
    now = 120000;
    progress.event({...base,processed_modules:3,total_modules:10});
    assert.match(reports.at(-1), /Анализатор обрабатывал модули 2:00 назад/);
    progress.event({...base,processed_modules:4,total_modules:10});
    assert.match(reports.at(-1), /Анализатор обрабатывал модули 0:00 назад/);
  } finally { progress.dispose(); }
});

test('checksum and generation checks are visible throughout silence without fabricating a platform message', () => {
  const reports = [];
  let now = 0;
  const progress = new OperationProgress('en', value => reports.push(value), () => now);
  try {
    const frame = {schema_version: 1, kind: 'operation_progress', phase: 'verify', quiet_ms: null};
    progress.event({...frame, event: 'command', step: 'checksum_main'});
    now = 45000;
    progress.event({...frame, event: 'heartbeat', step: 'checksum_main', stage_elapsed_ms: now});
    assert.match(reports.at(-1), /main configuration checksum/);
    assert.match(reports.at(-1), /Waiting for platform messages/);
    progress.event({...frame, event: 'command', step: 'read_generation'});
    assert.match(reports.at(-1), /Reading the configuration generation/);
    assert.doesNotMatch(reports.at(-1), /checksum/);
  } finally { progress.dispose(); }
});
