import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {lstat, stat} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {promisify} from 'node:util';

const execute = promisify(execFile);

async function verifyReferences(root) {
  for (const name of ['catalog.json', 'coverage.json']) {
    assert.ok((await stat(join(root, 'tests/fixtures/forms', name))).isFile());
  }
}

/** Never use a moving main branch or overwrite an existing developer checkout. */
export async function prepareFormReferences(root, version, sourceRoot, run = execute) {
  assert.ok(isAbsolute(root), 'form-reference-installation-root');
  if (sourceRoot) {
    assert.ok(isAbsolute(sourceRoot), 'form-reference-source-root');
    await verifyReferences(sourceRoot);
    return {path: sourceRoot, ref: null, commit: null, source: 'provided'};
  }
  assert.match(version, /^\d+\.\d+\.\d+$/, 'form-reference-release-version');
  const ref = `v${version}`;
  const destination = join(root, 'form-references');
  const existing = await lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  assert.equal(existing, null, 'form-reference-destination-exists');
  await run('git', [
    'clone', '--quiet', '--depth', '1', '--single-branch', '--branch', ref,
    '--', 'https://github.com/odineska/eska.git', destination,
  ], {timeout: 120_000, maxBuffer: 1024 * 1024});
  await verifyReferences(destination);
  const options = {cwd: destination, timeout: 10_000, maxBuffer: 4096};
  const commit = (await run('git', ['rev-parse', 'HEAD'], options)).stdout.trim();
  const tagged = (await run('git', ['rev-parse', `refs/tags/${ref}^{commit}`], options)).stdout.trim();
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(commit, tagged, 'form-reference-tag-commit');
  return {path: destination, ref, commit, source: 'release-tag'};
}
