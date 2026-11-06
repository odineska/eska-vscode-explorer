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
  const sources = [form.path, form.pictureXml, form.owner];
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
    return { text: button.textContent, image: image?.complete && image.naturalWidth === 16 ? image.src : null };
  })()`);
  const dataUrl = async file => 'data:image/svg+xml;base64,' + (await fs.readFile(file)).toString('base64');
  const matches = async (label, text, image) => {
    const rendered = await command(label);
    return rendered?.text === text && rendered.image === image;
  };
  await until(image, 'common picture loaded as inert img');
  const first = await image(), generated = await dataUrl(form.generated);
  assert.equal(view.snapshot.model.assets.length, 2);
  assert.ok(view.snapshot.dependencies.some(input => input.role === 'picture'));
  await until(async () => await matches('Local icon', '', first)
    && await matches('Text command', 'Text command', null)
    && await matches('Mixed command', 'Mixed command', first)
    && await matches('No icon', 'No icon', null)
    && await matches('GeneratedIcon', '', generated), 'authored and generated command pictures use their effective representation');

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
    detachedRepresentationUpdates: true, sourceWritesDuringViewing: false,
  }));
};
