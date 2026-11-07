const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), form = fixture.form;
  const paths = [form.path,form.style,form.definition], before = await Promise.all(paths.map(file => fs.readFile(file)));
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(form.path)),{preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(() => [...explorer.formPreview.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'),'native alias form');
  const view = [...explorer.formPreview.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
  const ui = await frame({fixedFormArea:true,state:{title:panel.panel.title}});
  const rendered = (color,target = ui) => target.evaluate(`(() => {const button=document.querySelector('.taxi-command-bar .taxi-button');return !!button&&getComputedStyle(button).color===${JSON.stringify(color)};})()`);
  await until(() => rendered('rgb(18, 52, 86)'),'TextColor resolved as named StyleItem');
  assert.ok(view.snapshot.dependencies.some(value => JSON.stringify(value.path).includes('StyleItems/TextColor.xml')));
  await ui.screenshot(`style-color-roles-${vscode.env.language}.png`);
  await ui.evaluate("globalThis.__aliasButton=document.querySelector('.taxi-command-bar .taxi-button')");
  const style = await vscode.workspace.openTextDocument(vscode.Uri.file(form.style)), originalStyle = style.getText();
  const definition = await vscode.workspace.openTextDocument(vscode.Uri.file(form.definition)), originalDefinition = definition.getText();
  async function change(document,text,color,target = ui) {
    const revision = view.snapshot.revision, edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
    assert.equal(await vscode.workspace.applyEdit(edit),true);
    await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer,'dirty alias revision');
    await until(() => rendered(color,target),'dirty alias color');
  }
  await change(style,originalStyle.replace('#123456','#654321'),'rgb(101, 67, 33)');
  const fallback = originalStyle.replace(/<Item name="StyleItem\.TextColor">[\s\S]*?<\/Item>/,'');
  assert.notEqual(fallback,originalStyle);
  await change(style,fallback,'rgb(255, 140, 0)');
  const updatedDefinition = originalDefinition.replace('web:DarkOrange','#112233');
  assert.notEqual(updatedDefinition,originalDefinition);
  await change(definition,updatedDefinition,'rgb(17, 34, 51)');
  await change(definition,originalDefinition,'rgb(255, 140, 0)');
  await change(style,originalStyle,'rgb(18, 52, 86)');
  assert.equal(await ui.evaluate("globalThis.__aliasButton===document.querySelector('.taxi-command-bar .taxi-button')"),true);
  await explorer.formPreview.receive(view,panel,{type:'detach'});
  await until(() => view.frames.get('preview')?.ready,'alias preview detached');
  const detached = view.frames.get('preview'), floating = await frame({detached:true,fixedFormArea:true,state:{title:detached.panel.title}});
  await until(() => rendered('rgb(18, 52, 86)',floating),'alias in detached window');
  await floating.evaluate("globalThis.__aliasButton=document.querySelector('.taxi-command-bar .taxi-button')");
  await change(style,originalStyle.replace('#123456','#654321'),'rgb(101, 67, 33)',floating);
  await change(style,originalStyle,'rgb(18, 52, 86)',floating);
  assert.equal(await floating.evaluate("globalThis.__aliasButton===document.querySelector('.taxi-command-bar .taxi-button')"),true);
  assert.deepEqual(await Promise.all(paths.map(file => fs.readFile(file))),before);
  floating.close();detached.panel.dispose();ui.close();panel.panel.dispose();
  await until(() => explorer.formPreview.views.size === 0,'alias session released');
  await Promise.all([...explorer.formPreview.closing]);
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,
    namedColorMatchesProfileAlias:true,dirtySelectedColor:true,definitionFallback:true,dirtyDefinition:true,
    detachedStyleUpdates:true,sourceWritesDuringViewing:false,visualParityVerified:false}));
};
