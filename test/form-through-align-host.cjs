const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, allocateFormViewport, editFormSource } = require('./webview-host.cjs');

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

function withGroupProperty(xml, name, property, value) {
  const group = new RegExp(`<UsualGroup name="${name}"[^>]*>[\\s\\S]*?(?=<ChildItems>)`);
  const match = group.exec(xml);
  assert.ok(match, name);
  const header = match[0].replace(new RegExp(`\\s*<${property}>[^<]+</${property}>`), '');
  return xml.replace(match[0], header + (value ? `<${property}>${value}</${property}>\n` : ''));
}

async function inDetachedRow(service, view, main, ui, identity, run) {
  await service.receive(view, main, {type:'select', identity});
  await until(() => view.selected?.key.value === identity.key.value, 'row field selected');
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'detached row group');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true,state:{title:preview.panel.title}});
  assert.notEqual((await floating.nativeWindow({detached:true})).targetId, workbench.targetId);
  await floating.evaluate("globalThis.__wrappedFields=[...document.querySelectorAll('.taxi-input')];true");
  await run(floating);
  assert.deepEqual(view.selected, identity);
  assert.equal(await floating.evaluate('__wrappedFields.length>0 && __wrappedFields.every(field => field.isConnected)'), true);
  await service.receive(view, preview, {type:'dock'});
  await until(() => !view.frames.has('preview'), 'row returned to workbench');
  floating.close();
}

async function verifyPaymentLayout(ui, names, keys, sample, results) {
  await allocateFormViewport(ui, sample.viewport);
  const bankKey = keys[names.indexOf('Bank')];
  let actual;
  const near = (box, expected, tolerance) => box.every((value, axis) => Math.abs(value - expected[axis]) <= tolerance);
  try {
    await until(async () => {
      actual = await ui.evaluate(`(() => {
        const form=document.querySelector('.taxi-form-frame'), origin=form.getBoundingClientRect();
        const fields=new Map([...form.querySelectorAll('[data-kind=InputField]')].map(field => [field.dataset.element,field]));
        const controls=Object.fromEntries(${JSON.stringify(names.map((name,index)=>[name,keys[index]]))}.map(([name,key]) => {
          const rect=fields.get(key).querySelector('.taxi-input').getBoundingClientRect();
          return [name,[rect.x-origin.x,rect.y-origin.y,rect.width,rect.height]];
        }));
        const bank=fields.get(${JSON.stringify(bankKey)}).querySelector('.taxi-field-label');
        const lines=[...bank.querySelectorAll('.taxi-field-caption-line')].map(line=>line.textContent);
        return {frame:[origin.width,origin.height],controls,lines:lines.length ? lines : [bank.getAttribute('aria-label')]};
      })()`);
      return near(actual.frame, sample.frame, 1)
        && (actual.controls.Num[0] === actual.controls.Bank[0]) === sample.aligned
        && actual.lines.length === sample.bankLines.length && actual.lines.every((line,i) => line === sample.bankLines[i])
        && names.every(name => near(actual.controls[name], sample.controls[name], sample.positionTolerancePx));
    }, sample.case);
  } catch (error) {
    throw new Error(JSON.stringify({case:sample.case,actual,expected:sample}), {cause:error});
  }
  results.push({label:'adaptive-caption-'+sample.case,...actual});
}

async function verifyWrappedRows(form, service, results) {
  const original = await fs.readFile(form.path);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(() => [...service.views.values()].some(view => view.path === form.path && view.phase === 'ready'), 'row group opened');
  const view = [...service.views.values()].find(view => view.path === form.path), main = view.frames.get('main');
  const adaptive = form.cases.some(sample => sample.viewport);
  const tab = {fixedFormArea: !adaptive, state: {title:main.panel.title}};
  const ui = await frame(tab);
  const names = Object.keys(form.cases[0].controls);
  const identities = names.map(name => {
    const node = [...view.nodes.values()].find(node => node.name === name);
    assert.ok(node, name);
    return node.identity;
  });
  const keys = identities.map(id => `${id.source}:current:${id.key.value}`);
  await until(async () => (await rectangles(ui, keys)).every(Boolean), 'row group fields');
  await ui.evaluate('document.fonts.ready.then(()=>true)');

  const source = original.toString('utf8');
  const replace = xml => editFormSource(document, view, xml);
  if (adaptive && process.platform === 'linux') {
    await inDetachedRow(service, view, main, ui, identities[names.indexOf('Bank')], async floating => {
      for (const sample of [...form.cases, form.cases[0]]) {
        const resized = source.replace(/<Width>\d+<\/Width>/u, `<Width>${sample.leftWidth}</Width>`);
        await replace(withGroupProperty(resized, 'DetailRow', 'ThroughAlign', sample.throughAlign));
        const revision = view.snapshot.revision;
        await verifyPaymentLayout(floating, names, keys, sample, results);
        assert.equal(view.snapshot.revision, revision);
      }
      await replace(source);
    });
    results.push({label:'adaptive-caption-detached', sameDom:true, sameSelection:true});
  }
  for (const sample of form.cases.filter(sample => !sample.viewport)) {
    let xml = original.toString('utf8');
    if (form.kind === 'Leading') {
      xml = withGroupProperty(xml, 'Left', 'United', sample.parentUnited);
      xml = withGroupProperty(xml, 'Wrapper40', 'United', sample.wrapperUnited);
      xml = withGroupProperty(xml, 'Wrapper40', 'Group', sample.grouping);
      xml = withGroupProperty(xml, 'Wrapper40', 'ThroughAlign', sample.throughAlign === 'Auto' ? null : sample.throughAlign);
    }
    await replace(xml);
    await ui.evaluate(nextPaint);
    const boxes = await rectangles(ui, keys);
    const origin = await ui.evaluate("(()=>{const r=document.querySelector('.taxi-form-frame').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()");
    const relative = boxes.map(box => [box.x-origin[0],box.y-origin[1],box.width,box.height]);
    const aligned = sample.throughAlign !== 'DontUse';
    assert.equal(boxes[0].x === boxes[1].x, aligned, sample.case);
    if (process.platform === 'linux') {
      assert.deepEqual(origin.slice(2), sample.frame, sample.case + ' frame');
      const tolerance = sample.positionTolerancePx ?? 0;
      for (const [index, name] of names.entries()) {
        assert.ok(relative[index].every((value, axis) => Math.abs(value - sample.controls[name][axis]) <= tolerance),
          sample.case + ' ' + name + ' ' + JSON.stringify({actual:relative[index],expected:sample.controls[name]}));
      }
    }
    results.push({label:'nested-row-'+sample.case, frame:origin.slice(2), controls:relative, aligned});
  }
  if (form.kind === 'Leading') {
    await replace(original.toString('utf8'));
    const identity = identities[1];
    await inDetachedRow(service, view, main, ui, identity, async floating => {
      const aligned = async () => {
        const boxes = await rectangles(floating, keys);
        return boxes.every(Boolean) && boxes[0].x === boxes[1].x;
      };
      const revision = view.snapshot.revision;
      for (const [width, height] of [[430,310],[640,420]]) {
        await floating.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
        await floating.evaluate(nextPaint);
        await until(aligned, 'shared label column after resize');
        assert.equal(view.snapshot.revision, revision);
      }
      await replace(withGroupProperty(original.toString('utf8'), 'Wrapper40', 'ThroughAlign', 'DontUse'));
      await until(async () => !(await aligned()), 'dirty wrapped group leaves the track');
      await replace(original.toString('utf8'));
      await until(aligned, 'dirty wrapped group rejoins the track');
      await floating.screenshot('nested-row-detached-'+vscode.env.language+'.png');
    });
    results.push({label:'nested-row-detached-resize-dirty', sameDom:true, sameSelection:true});
  }
  assert.deepEqual(await fs.readFile(form.path), original);
  main.panel.dispose();
  await until(() => service.views.size === 0, 'row form closed');
  await Promise.all([...service.closing]);
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const [form, ...wrapped] = fixture.formGallery;
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
  await until(() => ui.evaluate(`(() => {
    const form = document.querySelector('.taxi-form-frame'), bounds = form.getBoundingClientRect();
    const css = getComputedStyle(form);
    const width = parseFloat(css.getPropertyValue('--taxi-form-preferred-width'));
    const height = parseFloat(css.getPropertyValue('--taxi-form-preferred-height'));
    return Math.abs(bounds.width - width) <= .5 && Math.abs(bounds.height - height) <= .5;
  })()`), 'preferred form size settled');
  const results = [];
  async function verify(layout, aligned, label, matches) {
    let boxes;
    await until(async () => {
      boxes = await rectangles(layout, keys);
      if (!boxes.every(Boolean) || (matches && !matches(boxes))) return false;
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
  await verify(ui, true, 'painted group accounts for its left inset',
    boxes => process.platform !== 'linux' || boxes[2].width - boxes[0].width === 5);
  const framed = left[0].replace('<Representation>None</Representation>',
    '<Representation>StrongSeparation</Representation><ThroughAlign>Use</ThroughAlign>');
  assert.notEqual(framed, left[0]);
  await replaceSource(source.replace(left[0], framed));
  await verify(ui, true, 'explicit Use crosses the strong divider');
  assert.deepEqual(await fs.readFile(form.path), original);
  main.panel.dispose();
  await until(() => service.views.size === 0, 'preview released');
  await Promise.all([...service.closing]);
  for (const row of wrapped) await verifyWrappedRows(row, service, results);
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, locale: vscode.env.language, results, dirtyDetached: true, sourceWritesDuringViewing: false,
  }));
};
