const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

async function editText(document, from, to) {
  const offset = document.getText().indexOf(from);
  assert.ok(offset >= 0, from);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(offset), document.positionAt(offset + from.length)), to);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

exports.run = async function() {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), form = fixture.form;
  const explorer = await vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  const original = await fs.readFile(form.one, 'utf8');
  const sources = [form.path, form.pictureXml, form.owner, form.generatedPictureXml, form.group];
  const before = await Promise.all(sources.map(file => fs.readFile(file)));
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => [...service.views.values()][0]?.phase === 'ready', 'picture form ready');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  let ui = await frame({ fixedFormArea: true, state: { title: main.panel.title } });
  const image = () => ui.evaluate(`(() => {
    const image = document.querySelector('[data-kind=PictureDecoration] .taxi-picture-resource');
    return image?.complete && image.naturalWidth === 16 ? image.src : null;
  })()`);
  const command = label => ui.evaluate(`(() => {
    const button = [...document.querySelectorAll('.taxi-root-commands button')]
      .find(node => node.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!button) return null;
    const image = button.querySelector('img');
    const mask = button.querySelector('.taxi-picture-template');
    const paint = mask && getComputedStyle(mask, '::after');
    return {
      text: button.textContent,
      image: image?.complete && image.naturalWidth === 16 ? image.src : null,
      tinted: !!paint && paint.maskImage.includes(image.src) && paint.maskMode === 'alpha'
        && paint.backgroundColor === getComputedStyle(button).color && getComputedStyle(image).opacity === '0',
    };
  })()`);
  const dataUrl = async file => 'data:image/svg+xml;base64,' + (await fs.readFile(file)).toString('base64');
  const matches = async (label, text, image) => {
    const rendered = await command(label);
    return rendered?.text === text && rendered.image === image;
  };
  await until(image, 'common picture loaded as inert img');
  const first = await image(), generated = await dataUrl(form.generated);
  assert.equal(view.snapshot.model.assets.length, 3);
  assert.ok(view.snapshot.dependencies.some(input => input.role === 'picture'));
  await until(async () => await matches('Local icon', '', first)
    && await matches('Text command', 'Text command', null)
    && await matches('Mixed command', 'Mixed command', first)
    && await matches('No icon', 'No icon', null)
    && await matches('GeneratedIcon', '', generated), 'authored and generated command pictures use their effective representation');

  const groupTrigger = '.taxi-root-commands [data-command-group] > button';
  const groupItems = () => ui.evaluate(`(() => [...document.querySelectorAll('.taxi-root-commands [role=menuitem]')]
    .map(item => ({ label: item.textContent, picture: !!item.querySelector('img') })))()`);
  await until(() => ui.evaluate(`document.querySelector(${JSON.stringify(groupTrigger)})?.getAttribute('aria-label') === 'PrintProbe'`), 'metadata command group rendered');
  await ui.evaluate(`document.querySelector(${JSON.stringify(groupTrigger)}).click()`);
  await until(async () => (await groupItems()).length === 2, 'automatic and added menu items are shown');
  assert.deepEqual(await groupItems(), [{ label: 'Invoice', picture: true }, { label: 'Local receipt', picture: false }]);
  const selection = view.selected;
  await ui.evaluate("document.querySelector('.taxi-root-commands [role=menuitem]').click()");
  await until(async () => (await groupItems()).length === 0, 'selecting an automatic menu item closes the menu');
  assert.deepEqual(view.selected, selection, 'preview menu does not execute a command');

  await fs.writeFile(form.one, original.replace('red', 'green'));
  const saved = await dataUrl(form.one);
  await until(async () => (await image()) === saved && await matches('Local icon', '', saved), 'saved binary refreshes the decoration and inherited command picture');
  const descriptor = await vscode.workspace.openTextDocument(vscode.Uri.file(form.pictureXml));
  await editText(descriptor, 'One.svg', 'Two.svg');
  const dirty = await dataUrl(form.two);
  await until(async () => (await image()) === dirty && await matches('Local icon', '', dirty), 'dirty descriptor changes the decoration and inherited command picture');
  await ui.screenshot(`form-pictures-${vscode.env.language}.png`);

  await ui.focusWorkbench();
  ui.close();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'picture preview detached');
  const detached = view.frames.get('preview');
  ui = await frame({ detached: true, fixedFormArea: true, state: { title: detached.panel.title } });
  await until(async () => await matches('Local icon', '', dirty) && await matches('GeneratedIcon', '', generated), 'detached preview retains effective pictures');
  const owner = await vscode.workspace.openTextDocument(vscode.Uri.file(form.owner));
  await editText(owner, '<Representation>Picture</Representation>', '<Representation>PictureAndText</Representation>');
  await until(() => matches('GeneratedIcon', 'GeneratedIcon', generated), 'dirty metadata changes generated representation in the separate window');
  await editText(document, '<Representation>Auto</Representation>', '<Representation>Text</Representation>');
  await until(() => matches('Local icon', 'Local icon', null), 'dirty form changes authored representation in the separate window');
  const generatedDescriptor = await vscode.workspace.openTextDocument(vscode.Uri.file(form.generatedPictureXml));
  await editText(generatedDescriptor, 'Generated.svg', 'Template.zip');
  await until(async () => {
    const template = view.snapshot.model.assets.find(asset => asset.picture.isTemplate)?.picture;
    const rendered = await command('GeneratedIcon');
    return template?.fileName === 'l.png' && rendered?.tinted
      && rendered.image === `data:${template.mimeType};base64,${template.data}`;
  }, 'dirty ZIP reference renders the low density template with the effective command color');
  await ui.evaluate(`document.querySelector(${JSON.stringify(groupTrigger)}).click()`);
  await until(async () => (await groupItems()).length === 2, 'group opens in the detached preview');
  const group = await vscode.workspace.openTextDocument(vscode.Uri.file(form.group));
  await editText(group, 'FormCommandBar', 'FormNavigationPanel');
  await until(() => ui.evaluate(`!document.querySelector(${JSON.stringify(groupTrigger)})`), 'dirty group category removes the menu from the detached preview');
  assert.deepEqual(await Promise.all(sources.map(file => fs.readFile(file))), before, 'viewing does not save XML');

  ui.close();
  detached.panel.dispose();
  main.panel.dispose();
  await until(() => service.views.size === 0, 'picture session released');
  await Promise.all([...service.closing]);
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, formPictures: true, locale: vscode.env.language, externalPayload: true,
    dirtyPictureDescriptor: true, commandPictures: true, generatedPictureAsset: true,
    detachedRepresentationUpdates: true, templatePictureTint: true, rootCommandMenu: true, sourceWritesDuringViewing: false,
  }));
};
