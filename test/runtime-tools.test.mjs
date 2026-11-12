import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { runtimeJson } = createRequire(import.meta.url)('../out/runtime-tools.js');

/** Exercise actual child-process buffering using a large, valid native-style plan. */
test('large project plans and structured CLI failures survive the process boundary', async () => {
  const result = await runtimeJson(process.execPath, ['-e',
    'process.stdout.write(JSON.stringify({status:"preview", changes:Object.fromEntries(Array.from({length:30000}, (_,i)=>["Documents/Document"+i+"/Ext/ObjectModule.bsl","modified"]))}))'],
    { timeout: 10000 });
  assert.equal(result?.status, 'preview');
  assert.equal(Object.keys(result.changes).length, 30000);
  const failure = await runtimeJson(process.execPath, ['-e',
    'process.stdout.write(JSON.stringify({error:{code:"missing_profile"}}));process.exitCode=1'],
    { timeout: 10000 });
  assert.deepEqual(failure, { error: { code: 'missing_profile' } });
});

test('malformed output and cancelled processes do not produce a successful operation', async () => {
  assert.equal(await runtimeJson(process.execPath, ['-e', 'process.stdout.write("incomplete")'], { timeout: 10000 }), undefined);
  const abort = new AbortController();
  const pending = runtimeJson(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 10000, signal: abort.signal });
  abort.abort();
  assert.equal(await pending, undefined);
});
