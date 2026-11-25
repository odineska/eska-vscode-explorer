const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  if (process.platform !== 'linux') {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,skipped:'8.5 geometry is calibrated for Linux'}));
    return;
  }
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  const config = path.join(fixture.source, 'Configuration.xml');
  const original = await fs.readFile(config, 'utf8');
  const source = await fs.readFile(fixture.form.path);
  const project = path.join(fixture.root, 'eska.toml');
  const projectBefore = await fs.readFile(project, 'utf8');
  await fs.writeFile(project, projectBefore + '\n[build]\nplatform_version="8.5.4"\n');
  const samples = [];
  let ui;
  try {
    await vscode.commands.executeCommand('eska.explorer.connect');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture.form.path), { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service = explorer.formPreview;
    await until(() => [...service.views.values()].some(view => view.phase === 'ready'), 'form opened');
    const view = [...service.views.values()][0];
    ui = await frame({ state: { title: view.frames.get('main').panel.title } });
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-input[data-native-border=ready]')"), 'Taxi input painted');
    await ui.evaluate("globalThis.retainedInput = document.querySelector('.taxi-input')");
    for (const [mode, profile, native] of [['Version8_5', 'version-8.5', null], ['Version8_3_10', 'taxi-8.3.27', 'ready'], ['Version8_5', 'version-8.5', null]]) {
      const property = `<InterfaceCompatibilityMode>${mode}</InterfaceCompatibilityMode>`;
      const changed = original.includes('<InterfaceCompatibilityMode>')
        ? original.replace(/<InterfaceCompatibilityMode>[^<]*<\/InterfaceCompatibilityMode>/, property)
        : original.replace('</Properties>', property + '</Properties>');
      await fs.writeFile(config, changed);
      service.schedule(view, 0);
      await until(() => view.snapshot.profile === profile, 'backend profile ' + profile);
      await until(async () => await ui.evaluate(`document.querySelector('.taxi-preview')?.dataset.profile === '${profile}'
        && (document.querySelector('.taxi-input').dataset.nativeBorder ?? null) === ${JSON.stringify(native)}`), 'profile paint reset ' + profile);
      const sample = await ui.evaluate(`(() => {
        const input = document.querySelector('.taxi-input');
        return {profile:document.querySelector('.taxi-preview').dataset.profile,
          retained: input === globalThis.retainedInput, native: input.dataset.nativeBorder ?? null,
          border: getComputedStyle(input).borderTopColor,
          nativeBorder: input.style.getPropertyValue('--taxi-input-native-border'), height: input.offsetHeight};
      })()`);
      assert.equal(sample.retained, true);
      assert.equal(sample.height, native ? 23 : 40);
      if (!native) {
        assert.equal(sample.nativeBorder, '');
        assert.equal(sample.border, 'rgb(153, 153, 153)');
      }
      samples.push(sample);
    }
    assert.deepEqual(await fs.readFile(fixture.form.path), source);
    assert.deepEqual(ui.scriptErrors(), []);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,samples,sourceUnchanged:true}));
  } finally {
    await fs.writeFile(config, original);
    await fs.writeFile(project, projectBefore);
    ui?.close();
    await explorer.shutdown();
  }
};
