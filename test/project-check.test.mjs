import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

for (const language of ['ru', 'en']) {
  test(`check does not republish diagnostics after editing and saving during analysis (${language})`, async t => {
    let changed;
    const published = [];
    const disposable = { dispose() {} };
    const uri = { fsPath: '/project/Module.bsl' };
    const document = { uri, isDirty: false };
    const vscode = {
      env: { language }, Uri: { file: fsPath => ({ fsPath }) },
      workspace: {
        isTrusted: true, textDocuments: [document],
        onDidChangeTextDocument: callback => { changed = callback; return disposable; },
      },
      languages: { createDiagnosticCollection: () => ({
        clear() {}, delete() {}, set: rows => published.push(rows), dispose() {},
      }) },
      commands: { executeCommand() { assert.fail('stale diagnostics must not open Problems'); } },
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      Range: class {}, Diagnostic: class {},
    };
    let edit = true;
    const require = createRequire(new URL('../out/project-check.js', import.meta.url));
    const module = { exports: {} };
    runInNewContext('(function(require,module,exports){' + readFileSync(new URL('../out/project-check.js', import.meta.url), 'utf8') + '\n})',
      { AbortController, AbortSignal, Set })(name => {
      if (name === 'vscode') return vscode;
      if (name === './project-command.js') return {
        projectComponent: async () => 'eska-check', saveProjectFiles: async () => true,
        projectArgs: () => [], projectProgress: async (_title, operation, signal) => operation(signal),
      };
      if (name === './runtime-tools.js') return { runtimeJson: async () => {
        if (edit) {
          document.isDirty = true;
          changed({ document, contentChanges: [{}] });
          document.isDirty = false;
        }
        return {
          schema_version: 1, kind: 'check', complete: true, status: 'threshold_exceeded',
          counts: { errors: 1, warnings: 0, information: 0, hints: 0 },
          files: [{ path: { encoding: 'utf-8', value: uri.fsPath }, diagnostics: [{
            message: 'Example', code: 'Example', severity: 'Error',
            start_line: 0, start_column: 0, end_line: 0, end_column: 1,
          }] }],
        };
      } };
      return require(name);
    }, module, module.exports);
    const check = new module.exports.ProjectCheck({ application() {}, executable: async () => undefined });
    t.after(() => check.dispose());
    const result = await check.run({ root: '/project', executable: 'eska-project' });
    assert.equal(result.error, true);
    assert.equal(published.length, 0);
    // A new run must not inherit the invalidation from the previous one.
    edit = false;
    vscode.commands.executeCommand = () => {};
    const fresh = await check.run({ root: '/project', executable: 'eska-project' });
    assert.equal(fresh.error, false);
    assert.equal(published.length, 1);
  });
}
