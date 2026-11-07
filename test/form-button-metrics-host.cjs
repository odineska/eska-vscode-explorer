const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

const measurement = `(() => {
  const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; };
  return { frame:rect(document.querySelector('.taxi-form-frame')),
    buttons:[...document.querySelectorAll('.taxi-command-bar .taxi-button')].map(node => ({...rect(node), caption:node.textContent,
      padding:getComputedStyle(node).padding, lineHeight:getComputedStyle(node).lineHeight})) };
})()`;

function compare(actual, expected, name) {
  assert.deepEqual([actual.frame.width, actual.frame.height], expected.nativeFrame, name + ' form');
  assert.deepEqual(actual.buttons.map(button => ({x:button.x-actual.frame.x, y:button.y-actual.frame.y,
    width:button.width, height:button.height})), expected.buttons, name + ' buttons');
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [], mismatches = [];
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path), document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, {preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...explorer.formPreview.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'button font ready');
    const view = [...explorer.formPreview.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
    const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
    await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-command-bar .taxi-button').length===3"), 'button font DOM');
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await until(async () => await ui.evaluate("[...document.querySelectorAll('.taxi-command-bar .taxi-button')].every(button=>button.style.width)"), 'native caption measurement');
    const captionsReady = () => ui.evaluate("document.querySelectorAll('.taxi-command-bar [data-native-caption=ready]').length===3");
    if (process.platform === 'linux') await until(captionsReady, 'packaged WASM captions');
    const geometry = await ui.evaluate(measurement);
    if (process.platform === 'linux') try { compare(geometry, form.expected, form.kind); }
    catch (error) { mismatches.push({name:form.kind, expected:form.expected, actual:geometry, message:error.message}); }
    await ui.screenshot(`button-font-${form.kind}-${vscode.env.language}.png`);
    results.push({name:form.kind, ...geometry});
    if (form.kind === '16Normal' && process.platform === 'linux') {
      const original = document.getText();
      await ui.evaluate("globalThis.__metricButton=document.querySelector('.taxi-command-bar .taxi-button')");
      async function change(text) {
        const revision = view.snapshot.revision, edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          text);
        assert.equal(await vscode.workspace.applyEdit(edit), true);
        await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer, 'dirty font model');
      }
      for (const points of [20, 16]) {
        await change(original.replaceAll('height="16"', `height="${points}"`));
        const expected = fixture.formGallery.find(item => item.kind === `${points}Normal`).expected;
        await until(async () => {
          const actual = await ui.evaluate(measurement);
          return actual.frame.width === expected.nativeFrame[0] && actual.frame.height === expected.nativeFrame[1];
        }, 'dirty font geometry');
        compare(await ui.evaluate(measurement), expected, `dirty ${points}pt`);
        await until(captionsReady, 'dirty WASM captions');
        assert.equal(await ui.evaluate("globalThis.__metricButton===document.querySelector('.taxi-command-bar .taxi-button')"), true);
        assert.equal(document.isDirty, true);
        results.push({name:`dirty ${points}pt`, ...await ui.evaluate(measurement)});
      }
      const type = '<Type>CommandBarButton</Type>';
      await change(original.replace(type, type + '<DefaultButton>true</DefaultButton>'));
      await until(async () => await ui.evaluate("(() => {const button=document.querySelector('.taxi-button'),style=getComputedStyle(button);return button.classList.contains('taxi-button--default')&&!!button.style.backgroundImage&&style.backgroundColor==='rgb(255, 225, 0)'&&style.color==='rgb(71, 71, 71)'&&button.querySelector('[data-native-caption]').dataset.nativeCaption==='ready';})()"), 'primary button retains native fill and contrast caption');
      await change(original);
      await until(async () => await ui.evaluate("!document.querySelector('.taxi-button').classList.contains('taxi-button--default') && !!document.querySelector('.taxi-button').style.backgroundImage"), 'plain fill restored');
      await until(captionsReady, 'plain WASM caption restored');
      await change(original.replaceAll('<v8:content>WW</v8:content>', '<v8:content>é</v8:content>'));
      await until(async () => await ui.evaluate("document.querySelector('.taxi-button [data-native-caption]').textContent==='é' && document.querySelector('.taxi-button [data-native-caption]').dataset.nativeCaption==='browser'"), 'unsupported shaping uses accessible browser text');
      assert.equal(await ui.evaluate("document.querySelector('.form-status').textContent.includes('" + (vscode.env.language.startsWith('ru') ? 'отрисована браузером' : 'browser rendering') + "')"), true);
      await change(original);
      await until(captionsReady, 'caption fallback cleared');
      assert.equal(await ui.evaluate("globalThis.__metricButton===document.querySelector('.taxi-command-bar .taxi-button')"), true);
    }
    assert.deepEqual(await fs.readFile(form.path), before);
    ui.close(); panel.panel.dispose();
    await until(() => explorer.formPreview.views.size === 0, 'button metric session released');
    await Promise.all([...explorer.formPreview.closing]);
  }
  const report = {passed:!mismatches.length, buttonFontMetrics:true, locale:vscode.env.language, sourceWritesDuringViewing:false, results, mismatches};
  if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR, `button-font-measured-${vscode.env.language}.json`), JSON.stringify(report));
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify(report));
  assert.deepEqual(mismatches, []);
};
