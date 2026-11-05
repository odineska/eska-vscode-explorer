import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {prepareFormReferences} from '../scripts/form-references.mjs';
import {deferCleanup} from './cleanup.mjs';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const commit = 'a'.repeat(40);

async function fixture(t) {
  const root = await mkdtemp(join(process.env.ESKA_TEST_ROOT ?? resolve(repository, '../eska-playground'), 'form-reference-test-'));
  deferCleanup(t, () => rm(root, {recursive: true, force: true}));
  return root;
}

async function referenceFiles(root) {
  const folder = join(root, 'tests/fixtures/forms');
  await mkdir(folder, {recursive: true});
  for (const name of ['catalog.json', 'coverage.json']) await writeFile(join(folder, name), '{}\n');
}

function gitFixture(calls, {tagCommit = commit} = {}) {
  return async (command, args, options) => {
    calls.push({command, args, options});
    if (args[0] === 'clone') {
      await referenceFiles(args.at(-1));
      return {stdout: ''};
    }
    return {stdout: (args.at(-1) === 'HEAD' ? commit : tagCommit) + '\n'};
  };
}

test('CI reference checkout is pinned to the tested release tag and its commit', async t => {
  const root = await fixture(t);
  const calls = [];
  const result = await prepareFormReferences(root, '0.24.1', undefined, gitFixture(calls));
  assert.deepEqual(result, {path: join(root, 'form-references'), ref: 'v0.24.1', commit, source: 'release-tag'});
  assert.deepEqual(calls[0].args, [
    'clone', '--quiet', '--depth', '1', '--single-branch', '--branch', 'v0.24.1',
    '--', 'https://github.com/odineska/eska.git', result.path,
  ]);
  assert.deepEqual(calls.slice(1).map(call => call.args), [
    ['rev-parse', 'HEAD'], ['rev-parse', 'refs/tags/v0.24.1^{commit}'],
  ]);
  assert.ok(calls.every(call => call.command === 'git'));
});

test('explicit source checkouts remain read only and never invoke Git', async t => {
  const root = await fixture(t);
  const source = join(root, 'provided');
  await referenceFiles(source);
  const before = await readFile(join(source, 'tests/fixtures/forms/catalog.json'));
  const result = await prepareFormReferences(root, '0.24.1', source, () => { throw new Error('unexpected Git call'); });
  assert.deepEqual(result, {path: source, ref: null, commit: null, source: 'provided'});
  assert.deepEqual(await readFile(join(source, 'tests/fixtures/forms/catalog.json')), before);
});

test('invalid paths and release refs stop before any clone', async t => {
  const root = await fixture(t);
  const run = () => { throw new Error('unexpected Git call'); };
  await assert.rejects(prepareFormReferences('relative', '0.24.1', undefined, run), /installation-root/);
  await assert.rejects(prepareFormReferences(root, '0.24.1', 'relative', run), /source-root/);
  for (const version of ['main', '../tag', '0.24.1 --branch main', '0.24.1\n']) {
    await assert.rejects(prepareFormReferences(root, version, undefined, run), /release-version/);
  }
  await mkdir(join(root, 'form-references'));
  await writeFile(join(root, 'form-references/own.txt'), 'preserve');
  await assert.rejects(prepareFormReferences(root, '0.24.1', undefined, run), /destination-exists/);
  assert.equal(await readFile(join(root, 'form-references/own.txt'), 'utf8'), 'preserve');
});

test('a different tag commit and clone failures cannot publish reference paths', async t => {
  const root = await fixture(t);
  await assert.rejects(prepareFormReferences(root, '0.24.1', undefined, gitFixture([], {tagCommit: 'b'.repeat(40)})), /tag-commit/);
  const other = join(root, 'other');
  await mkdir(other);
  const error = new Error('clone failed');
  await assert.rejects(prepareFormReferences(other, '0.24.1', undefined, () => { throw error; }), value => value === error);
});

test('form tests use the configured reference root and reject relative overrides', async t => {
  const root = await fixture(t);
  const moduleUrl = new URL('./form-references.mjs', import.meta.url).href;
  const source = `import {fileURLToPath} from 'node:url';
    const {formReferenceRoot}=await import(${JSON.stringify(moduleUrl)});
    console.log(fileURLToPath(formReferenceRoot));`;
  const result = await execute(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repository, env: {...process.env, ESKA_TEST_REFERENCE_ROOT: root},
  });
  assert.equal(resolve(result.stdout.trim()), root);
  await assert.rejects(execute(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repository, env: {...process.env, ESKA_TEST_REFERENCE_ROOT: 'relative'},
  }), error => error.code !== 0 && error.stderr.includes('ESKA_TEST_REFERENCE_ROOT must be absolute'));
});
