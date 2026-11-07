const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), palette = fixture.formPalette, results = [];
  const paths = [palette.style, palette.configuration, ...palette.forms.map(form => form.path)];
  const before = await Promise.all(paths.map(file => fs.readFile(file)));
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const configuration = await vscode.workspace.openTextDocument(vscode.Uri.file(palette.configuration));
  const originalConfig = configuration.getText(), selection = '<DefaultStyle>Style.ProbeStyleValues</DefaultStyle>';
  assert.ok(originalConfig.includes(selection));
  async function change(document, text, view) {
    const revision = view?.snapshot.revision, edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    if (view) await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer, 'dirty palette revision');
  }
  const css = rgb => `rgb(${rgb.join(', ')})`;
  for (const context of ['selected', 'default']) {
    if (context === 'default') await change(configuration, originalConfig.replace(selection, ''));
    for (const form of palette.forms) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)), {preview:false});
      await vscode.commands.executeCommand('eska.explorer.previewForm');
      await until(() => [...explorer.formPreview.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'palette form ready');
      const view = [...explorer.formPreview.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
      const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
      const button = Object.hasOwn(palette.expected.defaultColors, form.kind);
      const selector = button ? '.taxi-command-bar .taxi-button' : form.kind === 'TabAccent' ? '.taxi-tabs [role=tab]' : '.taxi-group-title';
      const expected = css(palette.expected[`${context}Colors`][button ? form.kind : 'AccentColor']);
      const rendered = (color, target = ui) => target.evaluate(`(() => {const node=document.querySelector(${JSON.stringify(selector)});return !!node&&getComputedStyle(node).color===${JSON.stringify(color)};})()`);
      await until(() => rendered(expected), `${context} ${form.kind} color`);
      if (button && process.platform === 'linux') await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-command-bar [data-native-caption=ready]').length===3"), 'palette caption raster');
      const actual = await ui.evaluate(`(() => {
        const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
        const node=document.querySelector(${JSON.stringify(selector)});
        return {frame:rect(document.querySelector('.taxi-form-frame')),element:rect(node),color:getComputedStyle(node).color};
      })()`);
      if (button && process.platform === 'linux') {
        assert.deepEqual([actual.frame.width,actual.frame.height], [269,79]);
        assert.deepEqual([actual.element.x-actual.frame.x,actual.element.y-actual.frame.y,actual.element.width,actual.element.height], [13,39,52,26]);
      }
      await ui.screenshot(`style-palette-${context}-${form.kind}-${vscode.env.language}.png`);
      results.push({context,name:form.kind,...actual});
      if (context === 'selected' && form.kind === 'Group') {
        const style = await vscode.workspace.openTextDocument(vscode.Uri.file(palette.style)), originalStyle = style.getText();
        await ui.evaluate("globalThis.__paletteGroup=document.querySelector('.taxi-group-title')");
        await change(style, originalStyle.replace('#9800FF', '#008000'), view);
        await until(() => rendered('rgb(0, 128, 0)'), 'dirty automatic group accent');
        assert.equal(await ui.evaluate("globalThis.__paletteGroup===document.querySelector('.taxi-group-title')"), true);
        await explorer.formPreview.receive(view, panel, {type:'detach'});
        await until(() => view.frames.get('preview')?.ready, 'palette detached');
        const detached = view.frames.get('preview'), floating = await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
        await until(() => rendered('rgb(0, 128, 0)', floating), 'dirty palette in detached window');
        await floating.evaluate("globalThis.__paletteGroup=document.querySelector('.taxi-group-title')");
        await change(configuration, originalConfig.replace(selection, ''), view);
        await until(() => rendered(css(palette.expected.defaultColors.AccentColor), floating), 'default palette after dirty style deselection');
        await change(configuration, originalConfig, view);
        await until(() => rendered('rgb(0, 128, 0)', floating), 'dirty style rediscovered after selection');
        await change(style, originalStyle, view);
        await until(() => rendered(expected, floating), 'selected accent restored');
        assert.equal(await floating.evaluate("globalThis.__paletteGroup===document.querySelector('.taxi-group-title')"), true);
        floating.close(); detached.panel.dispose();
      }
      ui.close(); panel.panel.dispose();
      await until(() => explorer.formPreview.views.size === 0, 'palette session released');
      await Promise.all([...explorer.formPreview.closing]);
    }
  }
  assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(file))), before);
  await explorer.shutdown();
  const report = {passed:true,locale:vscode.env.language,sourceWritesDuringViewing:false,dirtyStyleAndSelection:true,
    detachedPaletteRediscovery:true,wholeFormVisualParity:false,results};
  if (process.env.ESKA_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR, `style-palette-measured-${vscode.env.language}.json`), JSON.stringify(report));
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify(report));
};
