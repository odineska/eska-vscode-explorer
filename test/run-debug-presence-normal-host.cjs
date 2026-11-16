const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { connectWorkbench } = require('./query-constructor-dom.cjs');

async function until(check, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(label);
}

/** Normal-window acceptance uses public UI/API only; no debugger or database operation is invoked. */
exports.run = async function () {
  assert.equal(process.env.ESKA_HOST_NORMAL, '1');
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer');
  await until(() => extension.isActive, 'onStartupFinished activates the marker detector');
  assert.equal(extension.exports, undefined, 'normal activation exposes no private test API');
  const workbench = await connectWorkbench(until);
  const evidence = { passed: false, scenarios: [] };
  const marker = path.join(fixture.root, 'eska.toml');
  const visible = () => workbench.evaluate(`Boolean([...document.querySelectorAll('.pane-header')].find(item =>
    item.textContent.includes('ESKA:') && item.getBoundingClientRect().height > 0))`);
  const presence = async (expected, label) => {
    await until(async () => await visible() === expected, label); evidence.scenarios.push(label);
  };
  try {
    await vscode.commands.executeCommand('workbench.view.debug');
    await presence(!fixture.manifest, 'initial section presence before F5 or opening BSL');
    if (fixture.manifest && process.env.ESKA_HOST_RUN_DEBUG_EARLY) {
      await fs.writeFile(marker, fixture.manifest);
      await presence(true, 'external creation immediately after opening the panel shows the section');
    }
    const manifest = fixture.manifest ?? await fs.readFile(marker, 'utf8');
    if (fixture.manifest && !process.env.ESKA_HOST_RUN_DEBUG_EARLY) {
      await fs.writeFile(marker, manifest);
      await presence(true, 'external creation shows the section without Reload Window');
    }
    await fs.rename(marker, `${marker}.disabled`);
    await presence(false, 'external rename hides the last project section');
    await fs.writeFile(marker, '[project invalid');
    await presence(true, 'external creation with malformed TOML still shows the section');
    await fs.unlink(marker);
    await presence(false, 'external deletion hides the section');
    await fs.mkdir(marker);
    await presence(false, 'an external directory named eska.toml is not a project');
    await fs.rm(marker, { recursive: true });
    await fs.writeFile(marker, manifest);
    await presence(true, 'restored file marker shows the section again');
    assert.equal(vscode.debug.activeDebugSession, undefined);
    assert.ok(!vscode.workspace.textDocuments.some(document => document.languageId === 'bsl'));
    assert.equal(await fs.stat(path.join(fixture.root, '.vscode', 'launch.json')).then(() => true, () => false), false);
    evidence.passed = true;
  } catch (error) {
    evidence.error = String(error.stack ?? error); throw error;
  } finally {
    workbench.close();
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify(evidence));
  }
};
