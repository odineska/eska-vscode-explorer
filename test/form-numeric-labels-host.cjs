const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, allocateFormViewport, editFormSource } = require('./webview-host.cjs');

const linux = process.platform === 'linux';

async function geometry(ui) {
  return ui.evaluate(`(() => {
    const root = document.querySelector('.taxi-form-frame');
    const origin = root.getBoundingClientRect();
    const row = root.querySelector('.taxi-group--painted');
    const fields = [...row.querySelectorAll('[data-kind=LabelField]')];
    function box(element) {
      const {x,y,width,height} = element.getBoundingClientRect();
      return [x-origin.x,y-origin.y,width,height];
    }
    const controls = fields.map(field => field.querySelector('.taxi-label-field'));
    return {
      frame:[origin.width,origin.height], row:box(row),
      captions:fields.map(field => field.querySelector('.taxi-field-label')?.getAttribute('aria-label') ?? null),
      values:controls.map(control => control.textContent.trim()), controls:controls.map(box),
    };
  })()`);
}

async function verifyPose(ui, form, sample, label = sample.name) {
  if (linux) await allocateFormViewport(ui, sample.frame);
  let actual;
  try {
    await until(async () => {
      actual = await geometry(ui);
      return JSON.stringify(actual.captions) === JSON.stringify(form.captions)
        && actual.values.length === 2 && actual.values.every(value => value === '')
        && (!linux || (
          actual.frame.every((value, index) => value === sample.frame[index])
          && actual.row.every((value, index) => Math.abs(value - sample.row[index]) <= (index === 1 ? 1 : 0))
          && (!sample.controls || actual.controls.every((rect, index) =>
            rect.every((value, axis) => Math.abs(value - sample.controls[index][axis]) <= 1)))
        ));
    }, label);
  } catch (error) {
    throw new Error(JSON.stringify({case:label, actual, expected:{...sample, captions:form.captions}}), {cause:error});
  }
  return {label,...actual};
}

async function verifyDetached(service, view, main, ui, document, original, form) {
  const identity = [...view.nodes.values()].find(node => node.name === 'RightValue').identity;
  await service.receive(view, main, {type:'select', identity});
  await until(() => view.selected?.key.value === identity.key.value, 'right total selected');
  const window = await ui.nativeWindow();
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'numeric labels detached');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true, state:{title:preview.panel.title}});
  assert.notEqual((await floating.nativeWindow({detached:true})).targetId, window.targetId);
  await floating.evaluate("globalThis.__totalLabels=[...document.querySelectorAll('.taxi-label-field')];true");
  const sample = name => form.cases.find(entry => entry.name === name);
  const changed = original.replace('<HorizontalStretch>true</HorizontalStretch>',
    '<AutoMaxWidth>false</AutoMaxWidth><MaxWidth>14</MaxWidth><HorizontalStretch>true</HorizontalStretch>');
  assert.notEqual(changed, original);
  await editFormSource(document, view, changed);
  const results = [await verifyPose(floating, form, sample('manual-max'), 'detached-manual-max')];
  await editFormSource(document, view, original);
  for (const name of ['beyond-cap', 'medium', 'at-cap']) {
    results.push(await verifyPose(floating, form, sample(name), 'detached-' + name));
  }
  assert.deepEqual(view.selected, identity);
  assert.equal(await floating.evaluate('__totalLabels.length===2 && __totalLabels.every(label=>label.isConnected)'), true);

  const nested = original.replace(/<UsualGroup[\s\S]*?<\/UsualGroup>/, row =>
    '<Pages name="Pages" id="100"><PagesRepresentation>None</PagesRepresentation><ChildItems>'
    + '<Page name="Page" id="101"><ChildItems>' + row + '</ChildItems></Page></ChildItems></Pages>');
  assert.notEqual(nested, original);
  await editFormSource(document, view, nested);
  await until(async () => (await geometry(floating)).row[2] === sample('at-cap').row[2], 'numeric label cap inside a page');
  results.push({label:'detached-row-in-page', row:(await geometry(floating)).row});
  await editFormSource(document, view, original);
  await service.receive(view, preview, {type:'dock'});
  await until(() => !view.frames.has('preview'), 'numeric labels docked');
  floating.close();
  return results;
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const explorer = await vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview, results = [];
  for (const form of fixture.formGallery) {
    const original = await fs.readFile(form.path, 'utf8');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, {preview:false});
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const opened = () => [...service.views.values()].find(view => view.path === form.path && view.phase === 'ready');
    await until(opened, 'numeric label form opened');
    const view = opened(), main = view.frames.get('main');
    const ui = await frame({state:{title:main.panel.title}});
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    const nodes = [...view.nodes.values()].filter(node => node.kind === 'LabelField');
    assert.deepEqual(nodes.map(node => node.presentation.valueType.kind), ['number', 'number']);
    assert.deepEqual(nodes.map(node => node.presentation.tabularTotal ?? null),
      form.kind === 'Numbers' ? [null, null] : ['automatic', 'automatic']);
    const revision = view.snapshot.revision;
    const samples = form.cases.filter(sample => sample.name !== 'manual-max');
    for (const sample of linux ? samples : samples.slice(0, 1)) {
      results.push(await verifyPose(ui, form, sample));
      assert.equal(view.snapshot.revision, revision);
    }
    if (linux && form.kind === 'Totals') {
      results.push(...await verifyDetached(service, view, main, ui, document, original, form));
    }
    assert.equal(await fs.readFile(form.path, 'utf8'), original);
    main.panel.dispose();
    await until(() => service.views.size === 0, 'numeric label form closed');
    await Promise.all([...service.closing]);
    ui.close();
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed:true, locale:vscode.env.language, nativeGeometryChecked:linux, results, sourceWritesDuringViewing:false,
  }));
};
