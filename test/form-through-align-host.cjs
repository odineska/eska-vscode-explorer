const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

const fieldNames = ['A1', 'A2', 'B1', 'B2'];
const nextPaint = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

function rectangles(ui, keys) {
  return ui.evaluate(`(() => {
    const fields = [...document.querySelectorAll('[data-kind=InputField]')];
    return ${JSON.stringify(keys)}.map(key => {
      const input = fields.find(field => field.dataset.element === key)?.querySelector('.taxi-input');
      if (!input) return null;
      const {x, y, width, height} = input.getBoundingClientRect();
      return {x, y, width, height};
    });
  })()`);
}

async function setGroupMode(document, name, mode) {
  const group = new RegExp(`<UsualGroup name="${name}"[^>]*>[\\s\\S]*?<Group>Vertical</Group>(?:\\s*<ThroughAlign>[^<]+</ThroughAlign>)?`);
  const match = group.exec(document.getText());
  assert.ok(match, name);
  const replacement = match[0].replace(/\s*<ThroughAlign>[^<]+<\/ThroughAlign>$/, '') + `<ThroughAlign>${mode}</ThroughAlign>`;
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length));
  edit.replace(document.uri, range, replacement);
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const [form] = fixture.formGallery;
  const original = await fs.readFile(form.path);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(() => [...service.views.values()].some(view => view.path === form.path && view.phase === 'ready'), 'form opened');
  const view = [...service.views.values()].find(view => view.path === form.path);
  const main = view.frames.get('main');
  const keys = fieldNames.map(name => {
    const node = [...view.nodes.values()].find(node => node.name === name);
    assert.ok(node, name);
    return `${node.identity.source}:current:${node.identity.key.value}`;
  });
  const ui = await frame({ fixedFormArea: true, state: { title: main.panel.title } });
  await until(async () => (await rectangles(ui, keys)).every(Boolean), 'initial inputs');
  await ui.evaluate('document.fonts.ready.then(() => true)');
  const results = [];
  async function verify(layout, aligned, label) {
    let boxes;
    await until(async () => {
      boxes = await rectangles(layout, keys);
      if (!boxes.every(Boolean)) return false;
      return aligned ? boxes.every(box => box.x === boxes[0].x) : boxes[0].x < boxes[2].x && boxes[0].x === boxes[1].x;
    }, label);
    results.push({ label, boxes });
    return boxes;
  }
  const initial = await verify(ui, true, 'automatic cross-group alignment');
  if (process.platform === 'linux') {
    assert.deepEqual(initial.map(box => box.y - initial[0].y), [0, 60, 92, 124]);
    assert.deepEqual(initial.map(box => [box.width, box.height]), [[191, 51], [191, 23], [191, 23], [191, 23]]);
  }
  const workbench = await ui.nativeWindow();
  await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
  await until(() => view.frames.get('preview')?.ready, 'detached preview ready');
  const detached = view.frames.get('preview');
  const floating = await frame({ detached: true, state: { title: detached.panel.title } });
  const native = await floating.nativeWindow({ detached: true });
  assert.notEqual(native.targetId, workbench.targetId);
  await verify(floating, true, 'alignment in detached preview');
  await floating.evaluate("globalThis.__throughFields=[...document.querySelectorAll('.taxi-input')];true");
  const revision = view.snapshot.revision;
  for (const [width, height] of [[470, 310], [910, 640]]) {
    await floating.evaluate(`Object.assign(document.querySelector('#root').style, {width:'${width}px',height:'${height}px'});true`);
    await floating.evaluate(nextPaint);
    await verify(floating, true, `allocated width ${width}`);
    assert.equal(view.snapshot.revision, revision);
  }
  await setGroupMode(document, 'Left', 'DontUse');
  await verify(floating, false, 'left group excludes its titles');
  await setGroupMode(document, 'Left', 'Use');
  await verify(floating, true, 'left group rejoins the shared track');
  const beforeParentEdit = view.snapshot.revision;
  await setGroupMode(document, 'Outer', 'DontUse');
  await until(() => view.snapshot.revision !== beforeParentEdit, 'parent mode recomposed');
  await floating.evaluate(nextPaint);
  await verify(floating, true, 'parent flag preserves alignment within the group');
  assert.equal(await floating.evaluate('__throughFields.every(field => field.isConnected)'), true);
  await floating.screenshot(`through-align-dirty-${vscode.env.language}.png`);
  await service.receive(view, detached, { type: 'dock' });
  await until(() => !view.frames.has('preview'), 'dock completed');
  await verify(ui, true, 'aligned after return');

  const source = original.toString('utf8');
  async function replaceSource(text) {
    const revision = view.snapshot.revision;
    const edit = new vscode.WorkspaceEdit();
    const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    edit.replace(document.uri, range, text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await until(() => view.snapshot.revision !== revision, 'updated form scope');
    await ui.rendered();
  }

  const outer = /<UsualGroup name="Outer"[^>]*>.*?<ChildItems>(.*)<\/ChildItems>\s*<\/UsualGroup>(?=\s*<\/ChildItems>\s*<Attributes>)/s.exec(source);
  assert.ok(outer);
  await replaceSource(source.replace(outer[0], outer[1]));
  await verify(ui, true, 'titles align across groups in the form root');
  const page = `<Pages name="Pages" id="31"><ChildItems><Page name="ProbePage" id="33">
    <Group>Vertical</Group><ChildItems>${outer[1]}</ChildItems></Page></ChildItems></Pages>`;
  await replaceSource(source.replace(outer[0], page));
  await verify(ui, true, 'titles align across groups on a page');

  const left = /<UsualGroup name="Left"[^>]*>.*?(?=<ChildItems>)/s.exec(source);
  assert.ok(left);
  await replaceSource(source.replace(left[0], `${left[0]}<BackColor>#F0F6FC</BackColor>`));
  const painted = await verify(ui, true, 'painted group accounts for its left inset');
  if (process.platform === 'linux') assert.equal(painted[2].width - painted[0].width, 5);
  const framed = left[0].replace('<Representation>None</Representation>',
    '<Representation>StrongSeparation</Representation><ThroughAlign>Use</ThroughAlign>');
  assert.notEqual(framed, left[0]);
  await replaceSource(source.replace(left[0], framed));
  await verify(ui, true, 'explicit Use crosses the strong divider');
  assert.deepEqual(await fs.readFile(form.path), original);
  main.panel.dispose();
  await until(() => service.views.size === 0, 'preview released');
  await Promise.all([...service.closing]);
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, locale: vscode.env.language, results, dirtyDetached: true, sourceWritesDuringViewing: false,
  }));
};
