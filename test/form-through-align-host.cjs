const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, allocateFormViewport, editFormSource, sameSourcePath } = require('./webview-host.cjs');

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

function withContainerProperty(xml, tag, name, property, value) {
  const group = new RegExp(`<${tag} name="${name}"[^>]*>[\\s\\S]*?(?=<ChildItems>)`);
  const match = group.exec(xml);
  assert.ok(match, name);
  const header = match[0].replace(new RegExp(`\\s*<${property}>[^<]+</${property}>`), '');
  return xml.replace(match[0], header + (value ? `<${property}>${value}</${property}>\n` : ''));
}

function withGroupProperty(xml, name, property, value) {
  return withContainerProperty(xml, 'UsualGroup', name, property, value);
}

async function inDetachedRow(service, view, main, ui, identity, run) {
  await service.receive(view, main, {type:'select', identity});
  await until(() => view.selected?.key.value === identity.key.value, 'row field selected');
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'detached row group');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true,state:{title:preview.panel.title}});
  try {
    assert.notEqual((await floating.nativeWindow({detached:true})).targetId, workbench.targetId);
    await floating.evaluate("globalThis.__wrappedFields=[...document.querySelectorAll('.taxi-input')];true");
    await run(floating);
    assert.deepEqual(view.selected, identity);
    assert.equal(await floating.evaluate('__wrappedFields.length>0 && __wrappedFields.every(field => field.isConnected)'), true);
  } finally {
    try {
      await service.receive(view, preview, {type:'dock'});
      await until(() => !view.frames.has('preview'), 'row returned to workbench');
    } finally { floating.close(); }
  }
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
        const lineNodes=[...bank.querySelectorAll('.taxi-field-caption-line')];
        const lines=lineNodes.map(line=>line.textContent);
        return {frame:[origin.width,origin.height],controls,lines:lines.length ? lines : [bank.getAttribute('aria-label')],
          lineHeights:lineNodes.map(line=>line.getBoundingClientRect().height),captionHeight:bank.getBoundingClientRect().height};
      })()`);
      return near(actual.frame, sample.frame, 1)
        && (actual.controls.Num[0] === actual.controls.Bank[0]) === sample.aligned
        && actual.lines.length === sample.bankLines.length && actual.lines.every((line,i) => line === sample.bankLines[i])
        && names.every(name => near(actual.controls[name], sample.controls[name], sample.positionTolerancePx));
    }, sample.case);
  } catch (error) {
    throw new Error(JSON.stringify({case:sample.case,actual,expected:sample}), {cause:error});
  }
  if (actual.lines.length > 1) {
    assert.deepEqual(actual.lineHeights, actual.lines.map(() => 15), 'wrapped captions use the native font line height');
    assert.equal(actual.captionHeight, 15 * actual.lines.length + 2, 'the caption has one pair of vertical insets');
  }
  results.push({label:'adaptive-caption-'+sample.case,...actual});
}

async function verifyWrappedRows(form, service, results) {
  const original = await fs.readFile(form.path);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'row group opened');
  const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path)), main = view.frames.get('main');
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
    const aligned = sample.throughAlign !== 'DontUse';
    const tolerance = sample.positionTolerancePx ?? 0;
    let layout;
    await until(async () => {
      const boxes = await rectangles(ui, keys);
      if (boxes.some(box => !box)) return false;
      const origin = await ui.evaluate("(()=>{const r=document.querySelector('.taxi-form-frame').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()");
      const relative = boxes.map(box => [box.x-origin[0],box.y-origin[1],box.width,box.height]);
      layout = {boxes, origin, relative};
      return (boxes[0].x === boxes[1].x) === aligned && (process.platform !== 'linux'
        || origin.slice(2).every((value, axis) => value === sample.frame[axis])
          && relative.every((box, index) => box.every((value, axis) => Math.abs(value - sample.controls[names[index]][axis]) <= tolerance)));
    }, 'wrapped layout ' + sample.case);
    const {boxes, origin, relative} = layout;
    assert.equal(boxes[0].x === boxes[1].x, aligned, sample.case);
    if (process.platform === 'linux') {
      assert.deepEqual(origin.slice(2), sample.frame, sample.case + ' frame');
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
  await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'form opened');
  const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path));
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
  for (const row of wrapped) {
    if (row.valueCases.length) await verifyValueColumns(row, service, results);
    else if (row.boundaryCases.length || row.representationCases.length) await verifyStretchBoundary(row, service, results);
    else await verifyWrappedRows(row, service, results);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, locale: vscode.env.language, results, dirtyDetached: true, sourceWritesDuringViewing: false,
  }));
};


function withFieldTitle(xml, name, location) {
  const field = new RegExp(`<(?:RadioButtonField|InputField|CheckBoxField) name="${name}"[^>]*>[\\s\\S]*?(?=<ContextMenu)`, 'u').exec(xml);
  assert.ok(field);
  const header = field[0].replace(/\s*<TitleLocation>[^<]+<\/TitleLocation>/u, '');
  return xml.replace(field[0], header + (location ? `<TitleLocation>${location}</TitleLocation>` : ''));
}

async function verifyStretchBoundary(form, service, results) {
  const original = await fs.readFile(form.path), source = original.toString('utf8');
  const representation = form.representationCases.length > 0;
  const samples = representation ? form.representationCases : form.boundaryCases;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, {preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const current = () => [...service.views.values()].find(view => sameSourcePath(view.path,form.path));
  await until(() => current()?.phase === 'ready', 'stretch boundary ready');
  const view = current(), main = view.frames.get('main'), ui = await frame({fixedFormArea:true, state:{title:main.panel.title}});
  const nodes = [...view.nodes.values()].filter(node => ['Wide','Option','Tail'].includes(node.name));
  const identities = nodes.map(node => [node.name, `${node.identity.source}:current:${node.identity.key.value}`]);
  const observe = async target => {
    await target.evaluate(nextPaint);
    return target.evaluate(`(() => {
      const form=document.querySelector('.taxi-form-frame'),origin=form.getBoundingClientRect();
      const box=element=>{if(!element)return null;const r=element.getBoundingClientRect();return [r.x-origin.x,r.y-origin.y,r.width,r.height];};
      const fields=Object.fromEntries(${JSON.stringify(identities)}.map(([name,key])=>{
        const element=[...form.querySelectorAll('[data-element]')].find(element=>element.dataset.element===key);
        const row=element.querySelector(':scope > .taxi-field-row');
        return [name,{captionEnd:box(row.querySelector(':scope > .taxi-field-control'))[0]-parseFloat(getComputedStyle(row).columnGap),
          control:box(row.querySelector(':scope > .taxi-field-control > :is(.taxi-input,.taxi-checkbox,.taxi-radios)')),
          marks:[...row.querySelectorAll('.taxi-radio')].map(box)}];
      }));
      return {frame:[origin.width,origin.height],fields};
    })()`);
  };
  const verify = async (target, sample) => {
    let actual;
    await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)), 'current caption scope rendered');
    await until(async () => {
      actual = await observe(target);
      return actual.fields[sample.scopeField ?? 'Option'].control !== null;
    }, 'stretch boundary controls');
    const field = actual.fields[sample.scopeField ?? 'Option'];
    if (representation && process.platform === 'linux') {
      for (const name of ['Wide','Option']) assert.ok(Math.abs(actual.fields[name].control[0]-sample.controls[name].logical[0])<=3,
        sample.case+' native caption origin of '+name+' '+JSON.stringify(actual));
    }
    assert.equal(field.captionEnd === actual.fields.Wide.captionEnd, sample.alignedWithParent, sample.case + ' shared caption scope '+JSON.stringify(actual));
    if (process.platform === 'linux' && sample.ownControlX !== undefined) {
      assert.equal(field.control[0], sample.ownControlX, sample.case + ' own caption origin '+JSON.stringify(actual));
      assert.deepEqual(field.marks, sample.ownMarks, sample.case + ' complete mark rectangles '+JSON.stringify(actual));
      if (sample.ownControl) assert.deepEqual(field.control, sample.ownControl, sample.case + ' own input rectangle');
    }
    return actual;
  };
  try {
    await editFormSource(document,view,source+'\n');
    for (const sample of samples) {
      let xml = source;
      if (sample.row || representation) {
        for (const [property,value] of [['Group',sample.grouping === 'Absent' ? null : sample.grouping],
          ['HorizontalStretch',sample.horizontalStretch],['ThroughAlign',sample.throughAlign],['United',sample.united]]) {
          xml = withGroupProperty(xml, 'Row', property, value);
        }
      }
      if (representation) {
        xml=withGroupProperty(xml,'Row','Representation',sample.representation);
        xml=withFieldTitle(xml,'Wide',sample.topTitle);
        if (form.kind==='ScopePage') xml=withContainerProperty(xml,'Page','Page','Group',sample.pageGrouping);
      }
      await editFormSource(document, view, withFieldTitle(xml, 'Option', sample.titleLocation));
      results.push({label:(representation?'representation-scope-':'stretch-scope-')+sample.case,...await verify(ui,sample)});
    }
    await editFormSource(document,view,source);
    if (form.kind === 'StretchRadio') {
      const identity = nodes.find(node=>node.name==='Option').identity;
      const shared = form.boundaryCases.find(sample=>sample.case==='Auto');
      const own = form.boundaryCases.find(sample=>sample.case==='HorizontalFixed');
      await inDetachedRow(service,view,main,ui,identity,async floating=>{
        await floating.evaluate("globalThis.__boundaryFields=[...document.querySelectorAll('.taxi-input,.taxi-radios')];true");
        for (const size of [[600,300],[380,300],[600,300]]) {
          await allocateFormViewport(floating,size);
          await editFormSource(document,view,withGroupProperty(source,'Row','HorizontalStretch','false'));
          await verify(floating,own);
          await editFormSource(document,view,source);
          await verify(floating,shared);
          assert.equal(await floating.evaluate('__boundaryFields.every(field=>field.isConnected)'),true);
        }
      });
      results.push({label:'stretch-scope-detached-resize-dirty',sameDom:true,sameSelection:true});
    }
    if (form.kind==='ScopeInputs') {
      const own=samples.find(sample=>sample.case==='TwoInputsAuto'),shared=samples.find(sample=>sample.case==='RepNoneInputs');
      const identity=nodes.find(node=>node.name==='Option').identity;
      await inDetachedRow(service,view,main,ui,identity,async floating=>{
        for (const size of [[600,300],[380,300],[600,300]]) {
          await allocateFormViewport(floating,size);
          await editFormSource(document,view,withGroupProperty(source,'Row','Representation','None'));
          await verify(floating,shared);
          await editFormSource(document,view,source);
          await verify(floating,own);
        }
      });
      results.push({label:'representation-scope-detached-resize-dirty',sameDom:true,sameSelection:true});
    }
    assert.deepEqual(await fs.readFile(form.path),original);
  } finally {
    await editFormSource(document,view,source);
    ui.close();main.panel.dispose();
    await until(()=>service.views.size===0,'stretch boundary closed');
    await Promise.all([...service.closing]);
  }
}

async function verifyValueColumns(form, service, results) {
  const original = await fs.readFile(form.path), source = original.toString('utf8');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
  await vscode.window.showTextDocument(document, {preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const current = () => [...service.views.values()].find(view => sameSourcePath(view.path,form.path));
  await until(() => current()?.phase === 'ready', 'value columns ready');
  const view = current(), main = view.frames.get('main');
  const tab = {fixedFormArea:true,state:{title:main.panel.title}}, ui = await frame(tab);
  const names = new Set(['Wide','Last','Tail','Option','OuterWide','SiblingWide']);
  const nodes = [...view.nodes.values()].filter(node => names.has(node.name));
  const identities = nodes.map(node => [node.name, `${node.identity.source}:current:${node.identity.key.value}`]);
  const observe = async target => {
    await target.evaluate(nextPaint);
    return target.evaluate(`(() => {
      const form=document.querySelector('.taxi-form-frame'),origin=form.getBoundingClientRect();
      const box=element=>{if(!element)return null;const r=element.getBoundingClientRect();return [r.x-origin.x,r.y-origin.y,r.width,r.height];};
      const elements=new Map([...form.querySelectorAll('[data-element]')].map(element=>[element.dataset.element,element]));
      const fields=Object.fromEntries(${JSON.stringify(identities)}.map(([name,key])=>[name,elements.get(key)]));
      return {frame:[origin.width,origin.height],controls:Object.fromEntries(Object.entries(fields)
        .filter(([,element])=>element.querySelector('.taxi-input')).map(([name,element])=>[name,box(element.querySelector('.taxi-input'))])),
        marks:[...fields.Option.querySelectorAll('.taxi-radio')].map(box)};
    })()`);
  };
  const configured = sample => {
    let xml = source;
    for (const [group,property,value] of [
      ['Parent','United',sample.parent],['Row','United',sample.united],
      ['Row','HorizontalStretch',sample.fixed ? false : undefined],['Row','ThroughAlign',sample.through],
      ...(form.kind === 'ValueSibling' ? [['Sibling','United',sample.sibling]] : []),
    ]) xml = withGroupProperty(xml,group,property,value === undefined ? null : String(value));
    if (sample.input) {
      const field = /<InputField name="Option"[^>]*>[\s\S]*?(?=<ContextMenu)/u.exec(xml);
      assert.ok(field);
      xml = xml.replace(field[0],field[0].replace(/<Width>[^<]+<\/Width>/u,`<Width>${sample.input}</Width>`));
    }
    return xml;
  };
  const verify = async (target, sample, preferred = true) => {
    await until(()=>target.evaluate('globalThis.__eskaNativeFormRevision === '+JSON.stringify(view.snapshot.revision)), 'current value columns rendered');
    const actual = await observe(target);
    if (process.platform === 'linux') {
      // Keep the known caption metric residual separate from all column/control dimensions.
      const captionDelta = actual.controls.Wide[0] - sample.controls.Wide[0];
      assert.ok(captionDelta >= 0 && captionDelta <= 3, sample.case + ' caption metric residual');
      for (const [name,expected] of Object.entries(sample.controls)) {
        assert.deepEqual(actual.controls[name],expected.map((value,axis)=>value+(axis===0?captionDelta:0)),
          sample.case + ' native column placement of ' + name);
      }
      assert.deepEqual(actual.marks,sample.marks.map(mark=>mark.box.map((value,axis)=>value+(axis===0?captionDelta:0))),
        sample.case + ' native radio placement');
      if (preferred) assert.deepEqual(actual.frame,[sample.frame[0]+captionDelta,sample.frame[1]],sample.case+' preferred frame');
      actual.captionOriginDeltaPx = captionDelta;
    }
    return actual;
  };
  try {
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await editFormSource(document,view,source+'\n');
    for (const sample of form.valueCases) {
      await editFormSource(document,view,configured(sample));
      results.push({label:'value-columns-'+sample.case,...await verify(ui,sample)});
    }
    if (form.kind === 'ValueRadio') {
      const combined = form.valueCases.find(sample=>sample.case==='RadioTrue');
      const exposed = form.valueCases.find(sample=>sample.case==='RadioFalse');
      const identity = nodes.find(node=>node.name==='Option').identity;
      await inDetachedRow(service,view,main,ui,identity,async floating=>{
        await floating.evaluate("globalThis.__valueFields=[...document.querySelectorAll('.taxi-input,.taxi-radios')];true");
        for (const width of [600,800,600]) {
          await allocateFormViewport(floating,[width,300]);
          await editFormSource(document,view,configured(combined));
          const before = await verify(floating,combined,false);
          await editFormSource(document,view,configured(exposed));
          const after = await verify(floating,exposed,false);
          if (process.platform === 'linux') assert.equal(after.controls.Tail[0]-before.controls.Tail[0],87,'native United displacement');
          assert.equal(await floating.evaluate('__valueFields.every(field=>field.isConnected)'),true);
        }
      });
      results.push({label:'value-columns-detached-resize-dirty',sameDom:true,sameSelection:true});
    }
    assert.deepEqual(await fs.readFile(form.path),original);
  } finally {
    await editFormSource(document,view,source);
    ui.close();main.panel.dispose();
    await until(()=>service.views.size===0,'value columns closed');
    await Promise.all([...service.closing]);
  }
}
