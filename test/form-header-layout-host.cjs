const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { allocateFormViewport, editFormSource, frame, sameSourcePath, until } = require('./webview-host.cjs');

const geometry = `(() => {
  const root = document.querySelector('.taxi-form-frame');
  if (!root) return null;
  const leaves = Object.fromEntries([...root.querySelectorAll('.taxi-element')]
    .map(element => [element.dataset.element.split(':').at(-1), element]));
  const width = element => element.getBoundingClientRect().width;
  const field = id => leaves[id].querySelector(':scope > .taxi-field-row');
  const link = leaves[11].querySelector(':scope > button');
  return {
    frame: width(root), row: width(leaves[3]), status: width(leaves[6]),
    titles: [4, 5, 7, 8, 10].map(id => field(id).dataset.titleLocation),
    wrap: link.hasAttribute('data-wrapped-link'), linkLabel: link.getAttribute('aria-label'),
  };
})()`;

async function layout(ui, width, predicate, message) {
  await allocateFormViewport(ui, [width, 460]);
  let sample, previous;
  await until(async () => {
    sample = await ui.evaluate(geometry);
    const signature = JSON.stringify(sample);
    const settled = signature === previous;
    previous = signature;
    return settled && sample && predicate(sample);
  }, message);
  return sample;
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const input = fixture.form, original = await fs.readFile(input.path, 'utf8');
  const explorer = await vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(input.path));
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  let view;
  await until(() => {
    view = [...service.views.values()].find(candidate => sameSourcePath(candidate.path, input.path));
    return view?.phase === 'ready';
  }, 'nested header ready');
  const main = view.frames.get('main');
  const ui = await frame({ state: { title: main.panel.title } });
  try {
    await ui.evaluate('document.fonts.ready.then(() => true)');
    const wideHeader = sample => sample.frame >= 1000 && !sample.wrap && sample.titles.every(title => title === 'Left');
    const wide = await layout(ui, 1100, wideHeader, 'wide header');
    const narrow = await layout(ui, 670, sample => sample.wrap && sample.titles[0] === 'Top', 'narrow header');
    assert.deepEqual(narrow.titles, ['Top', 'Top', 'Top', 'Left', 'Top']);
    assert.ok(narrow.frame <= 674 && narrow.row < wide.row, JSON.stringify(narrow));
    assert.equal(narrow.status, wide.status, 'the status picture keeps its width');
    assert.equal(narrow.linkLabel, wide.linkLabel, 'the link keeps its accessible name');

    const explicit = original.replace('<DataPath>Date</DataPath>', '<DataPath>Date</DataPath><TitleLocation>Left</TitleLocation>');
    assert.notEqual(explicit, original);
    await editFormSource(document, view, explicit);
    await layout(ui, 670, sample => sample.titles[1] === 'Left', 'authored side caption remains beside the date');
    await editFormSource(document, view, original);
    const restored = await layout(ui, 1100, wideHeader, 'restored wide header');
    assert.deepEqual(restored, wide);
    assert.deepEqual(ui.scriptErrors(), []);
    assert.equal(await fs.readFile(input.path, 'utf8'), original);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, wide, narrow, restored }));
  } finally {
    ui.close();
    main.panel.dispose();
    await explorer.shutdown();
  }
};
