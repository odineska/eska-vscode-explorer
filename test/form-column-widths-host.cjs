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
        const fields=new Map([...root.querySelectorAll('[data-kind=InputField], [data-kind=CheckBoxField]')].map(field=>[field.dataset.element,field]));
        const controls={}, captions={}, locations={};
        for (const [name,key] of Object.entries(${JSON.stringify(keys)})) {
          const field=fields.get(key), control=field?.querySelector('.taxi-input,.taxi-checkbox');
          if (!control) continue;
          const r=control.getBoundingClientRect();
          controls[name]=[r.x-origin.x,r.y-origin.y,r.width,r.height];
          locations[name]=field.querySelector('.taxi-field-row').dataset.titleLocation;
          const label=field.querySelector('.taxi-field-label');
          if (!label) continue;
          const wrapped=[...label.querySelectorAll('.taxi-field-caption-line')].map(line=>line.textContent);
          captions[name]={accessible:label.getAttribute('aria-label'),lines:wrapped.length ? wrapped : [label.textContent]};
        }
        return {frame:[origin.width,origin.height],controls,captions,locations};
      })()`);
      const tolerance = expected.tolerancePx ?? 0;
      const aligned = expected.alignedY?.map(name => actual.controls[name]?.[1]);
      return actual.frame.every((value,index) => expected.frame[index] === null || value === expected.frame[index])
        && Object.entries(expected.locations ?? {}).every(([name, location]) => actual.locations[name] === location)
        && Object.entries(expected.controlSizes ?? {}).every(([name, size]) =>
          actual.controls[name]?.slice(2).every((value,index) => Math.abs(value-size[index]) <= tolerance))
        && (!aligned || Math.max(...aligned) - Math.min(...aligned) <= tolerance)
        && Object.entries(expected.controls ?? {}).every(([name, rect]) =>
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
  for (const [name, location] of Object.entries(edit.titleLocations ?? {})) {
    changed = editField(changed, name, properties =>
      '<TitleLocation>' + location + '</TitleLocation>' + properties.replace(/<TitleLocation>[^<]+<\/TitleLocation>/u, ''));
  }
  if (edit.hideTitle) {
    changed = editField(changed, edit.hideTitle, properties => properties.replace('<TitleLocation>Left</TitleLocation>', '<TitleLocation>None</TitleLocation>'));
  }
  if (edit.width) changed = editField(changed, 'B', properties => properties.replace(/<Width>\d+<\/Width>/, `<Width>${edit.width}</Width>`));
  if (edit.maximum) {
    changed = editField(changed, 'B', properties => `<AutoMaxWidth>false</AutoMaxWidth><MaxWidth>${edit.maximum}</MaxWidth>` + properties);
  }
  assert.notEqual(changed, xml);
  return changed;
}

async function verifyDetached(service, view, main, ui, identity, run) {
  await service.receive(view, main, {type:'select', identity});
  await until(() => view.selected?.key.value === identity.key.value, 'column field selected');
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'column layout detached');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true, state:{title:preview.panel.title}});
  assert.notEqual((await floating.nativeWindow({detached:true})).targetId, workbench.targetId);
  await floating.evaluate("globalThis.__widthInputs=[...document.querySelectorAll('.taxi-input,.taxi-checkbox')];true");
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
    const nodes = [...view.nodes.values()].filter(node => ['InputField', 'CheckBoxField'].includes(node.kind));
    const keys = Object.fromEntries(nodes.map(node => [node.name,`${node.identity.source}:current:${node.identity.key.value}`]));
    const replace = xml => editFormSource(document, view, xml);
    const checkbox = nodes.find(node => node.kind === 'CheckBoxField');
    if (process.platform === 'linux' && (form.cases[0]?.locations || checkbox)) {
      const identity = (checkbox ?? nodes.find(node => node.name === 'Currency')).identity;
      const observation = await verifyDetached(service, view, main, ui, identity, async floating => {
        const wide = checkbox ? form.cases[0] : {name:'wide captions',frame:[1180,250],
          locations:Object.fromEntries(Object.keys(form.cases[0].locations).map(name => [name, 'Left']))};
        const initial = await pose(floating, keys, wide);
        if (checkbox) results.push(initial);
        for (const expected of form.cases.slice(checkbox ? 1 : 0)) {
          await replace(expected.edit ? sourceVariant(original, expected.edit) : original);
          const revision = view.snapshot.revision;
          results.push(await pose(floating, keys, expected));
          if (checkbox && expected.viewport) {
            assert.equal(await floating.evaluate("document.querySelector('.preview-scroll').scrollWidth > document.querySelector('.preview-scroll').clientWidth"), true);
          }
          assert.equal(view.snapshot.revision, revision);
        }
        await replace(original);
        await pose(floating, keys, { ...wide, name: wide.name + ' restored', controls: initial.controls });
      });
      results.push({label:'detached-caption-placement-'+form.kind, ...observation});
    } else if (process.platform === 'linux') {
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
            const group = '<UsualGroup name="Left" id="11">';
            const noGrowth = original.replace(group, group + '<HorizontalStretch>false</HorizontalStretch>');
            assert.notEqual(noGrowth, original);
            await replace(noGrowth);
            results.push(await pose(floating, keys, { ...narrow, name:'automatic-width group shrinks without growing' }));
            const conditional = noGrowth.replace('<Group>Horizontal</Group>', '<Group>HorizontalIfPossible</Group>');
            assert.notEqual(conditional, noGrowth);
            await replace(conditional);
            await floating.rendered();
            await floating.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const preferred = await floating.evaluate(`(() => {
              const css = getComputedStyle(document.querySelector('.taxi-form-frame'));
              return ['width','height'].map(axis => parseFloat(css.getPropertyValue('--taxi-form-preferred-' + axis)));
            })()`);
            const [width, height] = preferred;
            await allocateFormViewport(floating, [Math.floor(width * .67), height]);
            await until(() => floating.evaluate(`(() => {
              const row = document.querySelector('.taxi-items[data-grouping=HorizontalIfPossible]');
              const area = document.querySelector('.preview-scroll');
              return row.classList.contains('taxi-items--vertical') && area.clientHeight < area.scrollHeight;
            })()`), 'a wrapped row makes the form scroll vertically');
            await allocateFormViewport(floating, preferred);
            await until(() => floating.evaluate(`(() => {
              const row = document.querySelector('.taxi-items[data-grouping=HorizontalIfPossible]');
              const area = document.querySelector('.preview-scroll');
              return row.classList.contains('taxi-items--horizontal') && area.clientHeight === area.scrollHeight;
            })()`), 'the row returns to horizontal at its preferred size');
            results.push({label:'conditional-group-restores-horizontal-at-preferred-width', frame:preferred});
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
