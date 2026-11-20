const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vscode = require('vscode');
const { connect, connectWorkbench } = require('./query-constructor-dom.cjs');

async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(label);
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const root = fixture.root;
  const artifacts = process.env.ESKA_ANALYZER_UI_ARTIFACTS;
  assert.ok(artifacts && path.isAbsolute(artifacts));
  const manifest = path.join(root, 'eska.toml');
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate();
  await until(() => explorer.connection.state.kind === 'ready', 'metadata connected');
  const roots = await explorer.getChildren();
  const children = (await Promise.all(roots.filter(entry => entry.node && !entry.node.parent).map(entry => explorer.getChildren(entry)))).flat();
  const settings = [...roots, ...children].find(item => item.kind === 'settings');
  assert.ok(settings, 'settings entry exists');
  await vscode.commands.executeCommand('eska.explorer.configureProject', settings);
  const ui = await connect(until, '.settings-page');
  const workbench = await connectWorkbench(until);
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const click = selector => ui.evaluate(`${element(selector)}.click()`);
  const search = '[data-setting="analyzer.rule-search"] input, input[data-setting="analyzer.rule-search"]';
  const severity = '[data-setting="tools.bsl-analyzer.diagnostics.metadataOverrides.QueryOrderByDocumentDate.lspSeverity"] select';
  const save = '[data-settings-action="save"]';
  try {
    await click('[data-settings-section="analyzer"]');
    await until(() => ui.evaluate(`!!${element(search)}`), 'analyzer rule search visible');
    const additions = ['OrdinaryFormDialogUnread', 'BuiltinFunctionNameAsDeclaration', 'LocalCallWithQueryInCycle', 'PossiblyUndefinedValue', 'UnknownQueryFunction', 'UnavailableAliasInQuery', 'ObjectModifiedInOnWrite', 'RegisterRecorderFieldInQuery', 'QueryOrderByDocumentDate', 'QueryConditionWithoutIndex'];
    for (const id of additions) {
      await ui.evaluate(`(() => { const control = ${element(search)}; control.value = ${JSON.stringify(id)}; control.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      await until(() => ui.evaluate(`document.querySelector('.settings-fields').textContent.includes(${JSON.stringify(id)})`), `catalog contains ${id}`);
    }
    await ui.evaluate(`(() => { const control = ${element(search)}; control.value = 'QueryOrderByDocumentDate'; control.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await until(() => ui.evaluate(`!!${element(severity)} && !${element(severity)}.disabled`), 'severity control visible');
    await workbench.screenshot(path.join(artifacts, 'analyzer-rule-before.png'));
    await ui.evaluate(`(() => { const control = ${element(severity)}; control.value = 'hint'; control.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await click('[data-settings-action="preview"]');
    await until(() => ui.evaluate(`!!${element(save)} && !${element(save)}.disabled`), 'preview validated by real analyzer');
    await workbench.screenshot(path.join(artifacts, 'analyzer-rule-preview.png'));
    await click(save);
    await until(async () => /lspSeverity\s*=\s*"hint"/.test(await fs.readFile(manifest, 'utf8')), 'severity saved to manifest');
    await until(() => ui.evaluate(`${element(save)}.disabled && !document.querySelector('fieldset.settings-fields').disabled`), 'settings save acknowledged');
    await until(async () => fs.access(path.join(root, 'bsl-analyzer.toml')).then(() => true, () => false), 'derived analyzer configuration published');
    const written = await fs.readFile(manifest, 'utf8');
    assert.match(written, /# UI acceptance preserves this comment/);
    assert.match(written, /tags\s*=\s*\[\s*['"]sql['"]\s*\]/);
    const generated = await fs.readFile(path.join(root, 'bsl-analyzer.toml'), 'utf8');
    assert.match(generated, /lspSeverity\s*=\s*"hint"/);
    const result = spawnSync(process.env.ESKA_ANALYZER_UI_CHECK_BINARY, ['--format', 'json', '--analyzer', process.env.ESKA_TEST_ANALYZER_BINARY], {cwd:root, encoding:'utf8', timeout:60000});
    await fs.writeFile(path.join(artifacts, 'check-report.json'), result.stdout);
    await fs.writeFile(path.join(artifacts, 'check.stderr'), result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.complete, true);
    const finding = report.files.flatMap(file => file.diagnostics).find(row => row.code === 'QueryOrderByDocumentDate');
    assert.equal(finding?.severity, 'Hint');
    await fs.writeFile(path.join(artifacts, 'manifest.toml'), written);
    await fs.writeFile(path.join(artifacts, 'effective.toml'), generated);
    const mode = 'article[data-setting="tools.bsl-analyzer.diagnostics.parameters.QueryOrderByDocumentDate"] .settings-analyzer-rule-header select';
    async function saveCurrent() {
      await click('[data-settings-action="preview"]');
      await until(() => ui.evaluate(`!${element(save)}.disabled`), 'preview accepted');
      await click(save);
      await until(() => ui.evaluate(`${element(save)}.disabled && !document.querySelector('fieldset.settings-fields').disabled`), 'save acknowledged');
    }
    await ui.evaluate(`(() => { const control = ${element(mode)}; control.value = 'off'; control.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await until(() => ui.evaluate(`${element(mode)}.value === 'off'`), 'rule disabled in draft');
    await ui.evaluate(`(() => { const level = ${element(severity)}; level.value = 'warning'; level.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await saveCurrent();
    const disabledManifest = await fs.readFile(manifest, 'utf8');
    assert.match(disabledManifest, /QueryOrderByDocumentDate\s*=\s*false/);
    assert.match(disabledManifest, /lspSeverity\s*=\s*"warning"/);
    const disabled = spawnSync(process.env.ESKA_ANALYZER_UI_CHECK_BINARY, ['--format', 'json', '--analyzer', process.env.ESKA_TEST_ANALYZER_BINARY], {cwd:root, encoding:'utf8', timeout:60000});
    const disabledReport = JSON.parse(disabled.stdout);
    assert.equal(disabledReport.complete, true);
    assert.equal(disabledReport.files.flatMap(file => file.diagnostics).some(row => row.code === 'QueryOrderByDocumentDate'), false, 'severity override does not enable a disabled rule');
    await fs.writeFile(path.join(artifacts, 'disabled-check-report.json'), disabled.stdout);
    await ui.evaluate(`(() => { const control = ${element(severity)}; control.value = ''; control.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await saveCurrent();
    const reset = await fs.readFile(manifest, 'utf8');
    assert.doesNotMatch(reset, /lspSeverity/);
    assert.match(reset, /tags\s*=\s*\[\s*['"]sql['"]\s*\]/);
    assert.match(reset, /QueryOrderByDocumentDate\s*=\s*false/);
    assert.match(reset, /# UI acceptance preserves this comment/);
    await fs.writeFile(path.join(artifacts, 'reset-manifest.toml'), reset);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true, suite:'analyzer-settings', vscode:vscode.version, locale:vscode.env.language, searched:additions, savedSeverity:'hint', effectiveSeverity:finding.severity, analyzer:report.analyzer.version, resetPreservesTags:true, disabledRuleStaysDisabled:true}));
  } finally { ui.close(); workbench.close(); }
};
