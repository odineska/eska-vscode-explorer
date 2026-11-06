const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const {frame, until, allocateFormViewport, editFormSource} = require('./webview-host.cjs');

async function pose(ui, keys, expected) {
  await allocateFormViewport(ui, expected.viewport ?? expected.frame);
  let actual;
  try {
    await until(async () => {
      actual = await ui.evaluate(`(() => {
        const root=document.querySelector('.taxi-form-frame'), origin=root.getBoundingClientRect();
        const fields=new Map([...root.querySelectorAll('[data-kind=InputField]')].map(field=>[field.dataset.element,field]));
        const controls={}, captions={};
        for (const [name,key] of Object.entries(${JSON.stringify(keys)})) {
          const field=fields.get(key), input=field?.querySelector('.taxi-input');
          if (!input) continue;
          const r=input.getBoundingClientRect();
          controls[name]=[r.x-origin.x,r.y-origin.y,r.width,r.height];
          const label=field.querySelector('.taxi-field-label');
          if (!label) continue;
          const wrapped=[...label.querySelectorAll('.taxi-field-caption-line')].map(line=>line.textContent);
          captions[name]={accessible:label.getAttribute('aria-label'),lines:wrapped.length ? wrapped : [label.textContent]};
        }
        return {frame:[origin.width,origin.height],controls,captions};
      })()`);
      const tolerance = expected.tolerancePx ?? 0;
      return actual.frame.every((v,i) => v === expected.frame[i])
        && Object.entries(expected.controls).every(([name, rect]) =>
          actual.controls[name]?.every((value,i) => Math.abs(value-rect[i]) <= tolerance))
        && Object.entries(expected.captions ?? {}).every(([name, lines]) => {
          const caption = actual.captions[name];
          return caption?.accessible === lines.join(' ') && caption.lines.length === lines.length
            && lines.every((line,index) => line === caption.lines[index]);
        });
    }, expected.name);
  } catch (error) {
    throw new Error(JSON.stringify({case:expected.name,actual,expected}), {cause:error});
  }
  return {label:expected.name,...actual};
}

function editField(xml, name, transform) {
  const field = new RegExp(`(<InputField name="${name}" id="\\d+">)([\\s\\S]*?)(</InputField>)`);
  assert.match(xml, field);
  return xml.replace(field, (_, open, properties, close) => open + transform(properties) + close);
}

function titleXml(values) {
  const language = ['ru', 'en'];
  const items = values.map((text, index) => {
    const content = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `<v8:item><v8:lang>${language[index]}</v8:lang><v8:content>${content}</v8:content></v8:item>`;
  });
  return '<Title>' + items.join('') + '</Title>';
}

function sourceVariant(xml, edit) {
  if (edit === 'automatic') return xml.replace('<Width>30</Width>', '');
  if (typeof edit === 'string') {
    assert.ok(['fixLeft','fixRight'].includes(edit));
    return editField(xml, edit === 'fixLeft' ? 'A' : 'B', properties => '<HorizontalStretch>false</HorizontalStretch>' + properties);
  }
  let changed = xml;
  for (const [name, title] of Object.entries(edit.titles ?? {})) {
    changed = editField(changed, name, properties => properties.replace(/<Title>[\s\S]*?<\/Title>/u, titleXml(title)));
  }
  for (const [name, width] of Object.entries(edit.widths ?? {})) {
    changed = editField(changed, name, properties => `<Width>${width}</Width>` + properties.replace(/<Width>.*?<\/Width>/u, ''));
  }
  if (edit.hideTitle) {
    changed = editField(changed, edit.hideTitle, properties => properties.replace('<TitleLocation>Left</TitleLocation>', '<TitleLocation>None</TitleLocation>'));
  }
  if (edit.maximum) {
    changed = editField(changed, 'B', properties => `<AutoMaxWidth>false</AutoMaxWidth><MaxWidth>${edit.maximum}</MaxWidth>` + properties);
  }
  assert.notEqual(changed, xml);
  return changed;
}

async function verifyDetached(service, view, main, ui, identity, run) {
  await service.receive(view, main, {type:'select', identity});
  await until(() => view.selected?.key.value === identity.key.value, 'right column field selected');
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'column layout detached');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true, state:{title:preview.panel.title}});
  assert.notEqual((await floating.nativeWindow({detached:true})).targetId, workbench.targetId);
  await floating.evaluate("globalThis.__widthInputs=[...document.querySelectorAll('.taxi-input')];true");
  await run(floating);
  assert.deepEqual(view.selected, identity);
  assert.equal(await floating.evaluate('__widthInputs.length>0 && __widthInputs.every(input=>input.isConnected)'), true);
  await service.receive(view, preview, {type:'dock'});
  await until(() => !view.frames.has('preview'), 'column layout returned');
  floating.close();
  return {sameDom:true, sameSelection:true};
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
    await until(() => [...service.views.values()].some(view => view.path === form.path && view.phase === 'ready'), 'column width form opened');
    const view = [...service.views.values()].find(view => view.path === form.path), main=view.frames.get('main');
    const ui = await frame({state:{title:main.panel.title}});
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    const nodes = [...view.nodes.values()].filter(node => node.kind === 'InputField');
    const keys = Object.fromEntries(nodes.map(node => [node.name,`${node.identity.source}:current:${node.identity.key.value}`]));
    const replace = xml => editFormSource(document, view, xml);
    if (process.platform === 'linux') {
      const revision = view.snapshot.revision;
      for (const expected of form.cases.filter(sample => !sample.edit)) {
        results.push(await pose(ui,keys,expected));
        assert.equal(view.snapshot.revision,revision);
      }
      for (const expected of form.cases.filter(sample => sample.edit)) {
        await replace(sourceVariant(original,expected.edit));
        results.push(await pose(ui,keys,expected));
      }
      if (['Columns', 'AutoReference', 'AutoFixedSiblings'].includes(form.kind)) {
        await replace(original);
        const identity = nodes.find(node => node.name === 'B').identity;
        const sample = name => form.cases.find(row => row.name === name);
        if (form.kind === 'Columns') {
          const observation = await verifyDetached(service, view, main, ui, identity, async floating => {
            const wide = sample('LeftWideLarge'), narrow = sample('Shrink20');
            const changed = original.replace('<Group>Horizontal</Group>',
              '<Group>Horizontal</Group><ChildItemsWidth>LeftWidest</ChildItemsWidth>');
            assert.notEqual(changed, original);
            await replace(changed);
            for (const expected of [wide, narrow, wide]) await pose(floating, keys, expected);
            await replace(sourceVariant(changed, 'fixRight'));
            await pose(floating, keys, form.cases.find(row => row.edit === 'fixRight'));
            await replace(original);
            await pose(floating, keys, wide);
          });
          results.push({label:'detached-column-resize-dirty', ...observation});
        } else if (form.kind === 'AutoFixedSiblings') {
          const observation = await verifyDetached(service, view, main, ui, identity, async floating => {
            const narrow = sample('FixedFieldsMinimum'), wide = sample('FixedFields94');
            await pose(floating, keys, narrow);
            await pose(floating, keys, wide);
            await pose(floating, keys, { ...narrow, name: 'fixed fields below minimum', viewport: [narrow.frame[0]-40, narrow.frame[1]] });
            assert.equal(await floating.evaluate("document.querySelector('.preview-scroll').scrollWidth > document.querySelector('.preview-scroll').clientWidth"), true);
          });
          results.push({label:'detached-fixed-siblings-resize', ...observation});
        } else {
          const observation = await verifyDetached(service, view, main, ui, identity, async floating => {
            const wide = sample('Standard94'), narrow = sample('NarrowMinimum');
            await pose(floating, keys, wide);
            await pose(floating, keys, narrow);
            await pose(floating, keys, { ...narrow, name: 'below the minimum width', viewport: [narrow.frame[0]-50, narrow.frame[1]] });
            assert.equal(await floating.evaluate("document.querySelector('.preview-scroll').scrollWidth > document.querySelector('.preview-scroll').clientWidth"), true);
            await pose(floating, keys, wide);
            const short = sample('Short74');
            await replace(sourceVariant(original, short.edit));
            await pose(floating, keys, short);
            const limited = sample('RefMax14');
            if (limited) {
              await replace(sourceVariant(original, limited.edit));
              await pose(floating, keys, limited);
            }
            await replace(original);
            await pose(floating, keys, narrow);
            await pose(floating, keys, wide);
          });
          results.push({label:'detached-auto-reference-resize-dirty', ...observation});
        }
      }
    }
    assert.equal(await fs.readFile(form.path,'utf8'),original);
    main.panel.dispose();
    await until(() => service.views.size === 0, 'column width form closed');
    await Promise.all([...service.closing]);
    ui.close();
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({
    passed:true,locale:vscode.env.language,results,sourceWritesDuringViewing:false,
  }));
};
