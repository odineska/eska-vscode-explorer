const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const {frame, until, allocateFormViewport, editFormSource, sameSourcePath } = require('./webview-host.cjs');

async function pressDivider(ui, key) {
  await ui.evaluate(`document.querySelector('.taxi-column-divider').dispatchEvent(
    new KeyboardEvent('keydown', {key:${JSON.stringify(key)}, bubbles:true}));true`);
}

function matchesBoxes(actual, expected, tolerance) {
  return Object.entries(expected ?? {}).every(([name, rect]) =>
    rect === null ? !actual[name] : actual[name]?.every((value, index) =>
      rect[index] === null || Math.abs(value - rect[index]) <= tolerance));
}

async function pose(ui, keys, expected) {
  await allocateFormViewport(ui, expected.viewport ?? expected.frame);
  if (expected.dividerKey) {
    await until(() => ui.evaluate(`(() => {
      const width = document.querySelector('.taxi-form-frame').getBoundingClientRect().width;
      return width === ${expected.frame[0]} && !!document.querySelector('.taxi-column-divider');
    })()`), 'divider appears at the measured width');
    await pressDivider(ui, expected.dividerKey);
  }
  let actual, previousControls;
  try {
    await until(async () => {
      actual = await ui.evaluate(`(() => {
        const root=document.querySelector('.taxi-form-frame'), origin=root.getBoundingClientRect();
        const fields=new Map([...root.querySelectorAll('.taxi-element--field')].map(field=>[field.dataset.element,field]));
        const nodeKeys = ${JSON.stringify(keys)};
        const groupNames = ${JSON.stringify(Object.keys(expected.groupBoxes ?? {}))};
        const groupBoxes = {};
        if (groupNames.length) {
          const groups = new Map([...root.querySelectorAll('.taxi-element[data-kind=UsualGroup]')]
            .map(group => [group.dataset.element, group]));
          for (const name of groupNames) {
            const rect = groups.get(nodeKeys[name])?.getBoundingClientRect();
            if (rect) groupBoxes[name] = [rect.x-origin.x, rect.y-origin.y, rect.width, rect.height];
          }
        }
        const controls={}, captions={}, locations={};
        for (const [name,key] of Object.entries(nodeKeys)) {
          const field=fields.get(key), control=field?.querySelector('.taxi-input,.taxi-checkbox,.taxi-picture-field,.taxi-label-field');
          if (!control) continue;
          const r=control.getBoundingClientRect();
          controls[name]=[r.x-origin.x,r.y-origin.y,r.width,r.height];
          locations[name]=field.querySelector('.taxi-field-row').dataset.titleLocation;
          const label=field.querySelector('.taxi-field-label');
          if (!label) continue;
          const wrapped=[...label.querySelectorAll('.taxi-field-caption-line')].map(line=>line.textContent);
          const lines = field.dataset.kind === 'LabelField' ? label.textContent.split('\\n') : [label.textContent];
          captions[name]={accessible:label.getAttribute('aria-label'),lines:wrapped.length ? wrapped : lines};
        }
        return {frame:[origin.width,origin.height],preferredWidth:parseFloat(root.style.getPropertyValue('--taxi-form-preferred-width')),controls,captions,locations,groupBoxes,layout:root.closest('.taxi-preview').dataset.formLayout,viewport:{client:[document.querySelector('.preview-scroll').clientWidth,document.querySelector('.preview-scroll').clientHeight],style:document.querySelector('.preview-scroll').getAttribute('style')},errors:globalThis.__columnErrors??[]};
      })()`);
      actual.browserErrors=ui.scriptErrors();
      // The viewport can reach its target before the allocator updates the controls.
      const signature = JSON.stringify([actual.controls, actual.groupBoxes]);
      const settled = signature === previousControls;
      previousControls = signature;
      const tolerance = expected.tolerancePx ?? 0;
      const aligned = expected.alignedY?.map(name => actual.controls[name]?.[1]);
      const trailing = expected.alignedEndX?.map(name => {
        const [x, , width] = actual.controls[name] ?? [];
        return x + width;
      });
      return settled && actual.layout === 'allocated' && actual.browserErrors.length === 0
        && actual.frame.every((value,index) => expected.frame[index] === null || value === expected.frame[index])
        && (expected.preferredWidth === undefined || actual.preferredWidth === expected.preferredWidth)
        && Object.entries(expected.locations ?? {}).every(([name, location]) => actual.locations[name] === location)
        && Object.entries(expected.controlSizes ?? {}).every(([name, size]) =>
          actual.controls[name]?.slice(2).every((value,index) => Math.abs(value-size[index]) <= tolerance))
        && (!aligned || Math.max(...aligned) - Math.min(...aligned) <= tolerance)
        && (!trailing || Math.max(...trailing) - Math.min(...trailing) <= tolerance)
        && matchesBoxes(actual.controls, expected.controls, tolerance)
        && matchesBoxes(actual.groupBoxes, expected.groupBoxes, tolerance)
        && Object.entries(expected.captions ?? {}).every(([name, lines]) => {
          const caption = actual.captions[name];
          return caption?.accessible === lines.join(' ') && caption.lines.length === lines.length
            && lines.every((line,index) => line === caption.lines[index]);
        });
    }, expected.name);
  } catch (error) {
    throw new Error(JSON.stringify({case:expected.name,actual,expected}), {cause:error});
  }
  if (expected.viewport?.[0] < expected.frame[0]) {
    assert.equal(await ui.evaluate("document.querySelector('.preview-scroll').scrollWidth > document.querySelector('.preview-scroll').clientWidth"), true);
  }
  return {label:expected.name,...actual};
}

function editField(xml, name, transform) {
  const field = new RegExp(`(<(?:InputField|LabelField|PictureField) name="${name}" id="\\d+">)([\\s\\S]*?)(</(?:InputField|LabelField|PictureField)>)`);
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

function editProperties(properties, settings) {
  for (const [tag, value] of Object.entries(settings)) {
    properties = properties.replace(new RegExp(`<${tag}>[^<]*</${tag}>`, 'u'), '');
    if (value !== null) properties = `<${tag}>${value}</${tag}>` + properties;
  }
  return properties;
}

function sourceVariant(xml, edit) {
  if (edit === 'automatic') return xml.replace('<Width>30</Width>', '');
  if (typeof edit === 'string') {
    assert.ok(['fixLeft','fixRight'].includes(edit));
    return editField(xml, edit === 'fixLeft' ? 'A' : 'B', properties => '<HorizontalStretch>false</HorizontalStretch>' + properties);
  }
  let changed = edit.form
    ? xml.replace(/(<Form\b[^>]*>)([\s\S]*?)(?=<ChildItems>)/u, (_, open, properties) => open + editProperties(properties, edit.form))
    : xml;
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
  for (const name of edit.fixedFields ?? []) {
    changed = editField(changed, name, properties =>
      '<HorizontalStretch>false</HorizontalStretch>' + properties.replace(/<HorizontalStretch>[^<]*<\/HorizontalStretch>/u, ''));
  }
  for (const name of edit.hiddenFields ?? []) {
    changed = editField(changed, name, properties => '<Visible>false</Visible>' + properties);
  }
  if (edit.united) changed = changed.replaceAll('<United>false</United>', '<United>true</United>');
  for (const [name, settings] of Object.entries(edit.groups ?? {})) {
    const group = new RegExp(`(<UsualGroup name="${name}" id="\\d+">)([\\s\\S]*?)(<ChildItems>)`, 'u');
    assert.match(changed, group);
    changed = changed.replace(group, (_, open, properties, items) => open + editProperties(properties, settings) + items);
  }
  for (const [name, settings] of Object.entries(edit.fields ?? {})) {
    changed = editField(changed, name, properties => editProperties(properties, settings));
  }
  if (edit.maximum) {
    changed = editField(changed, 'B', properties => `<AutoMaxWidth>false</AutoMaxWidth><MaxWidth>${edit.maximum}</MaxWidth>` + properties);
  }
  assert.notEqual(changed, xml);
  return changed;
}

async function verifyColumnDivider(ui, original, replace) {
  const read = () => ui.evaluate(`(() => {
    const owner = document.querySelector('.taxi-items[data-layout-owner$=":current:1"]');
    const separator = owner.querySelector(':scope > .taxi-column-divider');
    const visible = separator?.getBoundingClientRect().height > 0;
    return {
      horizontal: owner.classList.contains('taxi-items--horizontal'),
      tracks: getComputedStyle(owner).gridTemplateColumns.split(' ').map(parseFloat),
      range: visible ? ['min', 'now', 'max'].map(name => Number(separator.getAttribute('aria-value'+name))) : null,
      x: visible ? separator.getBoundingClientRect().left - owner.getBoundingClientRect().left : null,
      label: visible ? separator.getAttribute('aria-label') : null,
    };
  })()`);
  async function observe(predicate, label) {
    let result;
    await until(async () => { result = await read(); return predicate(result); }, label);
    return result;
  }
  async function press(key, bound) {
    await pressDivider(ui, key);
    return observe(result => result.range && result.range[1] === result.range[bound], 'divider reaches '+key);
  }

  const [wide, narrow] = [[974, 250], [540, 250]];
  await allocateFormViewport(ui, wide);
  const initial = await observe(result => result.horizontal && !result.range, 'wide columns fit without a divider');
  await allocateFormViewport(ui, narrow);
  const automatic = await observe(result => result.range?.[0] < result.range?.[2], 'compressed columns show a movable divider');
  assert.equal(automatic.label, vscode.env.language.startsWith('ru') ? 'Изменить ширину колонок формы' : 'Resize form columns');
  const [minimum, current, maximum] = automatic.range;
  const delta = maximum - current >= current - minimum ? Math.min(12, maximum - current) : -Math.min(12, current - minimum);
  await ui.dragHorizontally('.taxi-column-divider', delta);
  const dragged = await observe(result => result.range?.[1] === current + delta, 'pointer drag moves the divider');
  assert.ok(Math.abs(dragged.x - automatic.x - delta) < 1);

  const right = await press('End', 2);
  await allocateFormViewport(ui, [narrow[0] + 20, narrow[1]]);
  await observe(result => result.range?.[2] > right.range[2] && result.range[1] === result.range[2], 'End follows the resized maximum');
  await allocateFormViewport(ui, narrow);
  await observe(result => result.range?.[2] === right.range[2] && result.range[1] === result.range[2], 'End follows the original maximum');
  const left = await press('Home', 0);
  assert.ok(right.x - left.x > 10);
  assert.ok(right.tracks[0] > left.tracks[0] && right.tracks[1] < left.tracks[1]);
  assert.ok(Math.abs(right.tracks[0] + right.tracks[1] - left.tracks[0] - left.tracks[1]) < .1);

  await allocateFormViewport(ui, wide);
  const restored = await observe(result => result.horizontal && !result.range, 'divider leaves a wide viewport');
  assert.deepEqual(restored.tracks, initial.tracks);
  await allocateFormViewport(ui, narrow);
  await observe(result => result.range?.[1] === left.range[1], 'narrow viewport restores the local position');
  await allocateFormViewport(ui, [narrow[0] - (maximum - minimum), narrow[1]]);
  const collapsed = await observe(result => result.horizontal && !result.range, 'divider hides when both columns reach their minima');
  assert.ok(collapsed.tracks[0] + collapsed.tracks[1] < left.tracks[0] + left.tracks[1]);
  await allocateFormViewport(ui, narrow);
  await observe(result => result.range?.[1] === left.range[1], 'expansion restores the position after reaching minimum widths');
  const uncombined = original.replace('<UsualGroup name="Column1" id="11">', '$&<United>false</United>');
  assert.notEqual(uncombined, original);
  await replace(uncombined);
  await observe(result => result.horizontal && !result.range, 'exposed rows have no column divider');
  await replace(original);
  await observe(result => result.range?.[1] === left.range[1], 'dirty undo restores the column divider');
  return {label:'detached-column-divider', automatic, dragged, left, right, collapsed, wide:restored};
}

async function verifyDetached(service, view, main, ui, identity, run, retainedKey) {
  await service.receive(view, main, {type:'select', identity});
  await until(() => view.selected?.key.value === identity.key.value, 'column field selected');
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, {type:'detach'});
  await until(() => view.frames.get('preview')?.ready, 'column layout detached');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true, state:{title:preview.panel.title}});
  assert.notEqual((await floating.nativeWindow({detached:true})).targetId, workbench.targetId);
  await floating.evaluate("globalThis.__columnErrors=[];window.addEventListener('error',event=>__columnErrors.push({message:event.message,stack:event.error?.stack}));true");
  const controls = '.taxi-input,.taxi-checkbox,.taxi-picture-field,.taxi-label-field';
  const retained = retainedKey ? `[data-element=${JSON.stringify(retainedKey)}] :is(${controls})` : controls;
  await floating.evaluate(`globalThis.__widthInputs=[...document.querySelectorAll(${JSON.stringify(retained)})];true`);
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
    await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), 'column width form opened');
    const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path)), main=view.frames.get('main');
    const ui = await frame({state:{title:main.panel.title}});
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await ui.evaluate("globalThis.__columnErrors=[];window.addEventListener('error',event=>__columnErrors.push({message:event.message,stack:event.error?.stack}));true");
    const nodes = [...view.nodes.values()].filter(node => ['InputField', 'CheckBoxField', 'PictureField', 'LabelField', 'UsualGroup'].includes(node.kind));
    const keys = Object.fromEntries(nodes.map(node => [node.name,`${node.identity.source}:current:${node.identity.key.value}`]));
    const replace = xml => editFormSource(document, view, xml);
    const checkbox = nodes.find(node => node.kind === 'CheckBoxField');
    const placements = form.cases[0]?.locations;
    if (process.platform === 'linux' && ['FooterWrapped', 'CompactFooterTitles', 'MixedInputStack'].includes(form.kind)) {
      const stack = form.kind === 'MixedInputStack';
      const field = stack ? 'Trace' : 'Memo';
      const identity = nodes.find(node => node.name === field).identity;
      // Hiding the neighboring groups unmounts their controls and keeps the selected input.
      const retainedKey = stack ? keys[field] : undefined;
      const observation = await verifyDetached(service, view, main, ui, identity, async floating => {
        for (const expected of form.cases) {
          await replace(expected.edit ? sourceVariant(original, expected.edit) : original);
          const revision = view.snapshot.revision;
          results.push(await pose(floating, keys, expected));
          assert.equal(view.snapshot.revision, revision);
        }
        await replace(original);
        const name = stack ? 'input stack restores wide captions' : 'mixed row restores wide captions';
        results.push(await pose(floating, keys, { ...form.cases[0], name }));
      }, retainedKey);
      const label = form.kind === 'CompactFooterTitles' ? 'detached-compact-footer-resize-and-dirty'
        : stack ? 'detached-input-stack-resize-and-dirty' : 'detached-mixed-row-resize-and-dirty';
      results.push({label, ...observation});
    } else if (process.platform === 'linux' && (placements || checkbox)) {
      const identity = (checkbox ?? nodes.find(node => Object.hasOwn(placements, node.name))).identity;
      const observation = await verifyDetached(service, view, main, ui, identity, async floating => {
        const explicitWide = checkbox || ['VerticalAmountTitles', 'VerticalReferenceTitles'].includes(form.kind);
        const wide = explicitWide ? form.cases[0] : {name:'wide captions',frame:[1180,250],
          locations:Object.fromEntries(Object.keys(placements).map(name => [name, 'Left']))};
        const initial = await pose(floating, keys, wide);
        if (explicitWide) results.push(initial);
        for (const expected of form.cases.slice(explicitWide ? 1 : 0)) {
          await replace(expected.edit ? sourceVariant(original, expected.edit) : original);
          const revision = view.snapshot.revision;
          results.push(await pose(floating, keys, expected));
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
      if (form.kind === 'FooterAllocation') {
        await replace(original);
        results.push(await pose(ui, keys, { ...form.cases[0], name:'footer allocation restored' }));
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
              const outer = document.querySelector('.preview-scroll');
              const body = document.querySelector('.taxi-form-scrollport');
              const linux = !!row.closest('[data-os=linux]');
              const scrolls = linux ? body.hasAttribute('data-scrollable') && body.clientHeight < body.scrollHeight
                : outer.clientHeight < outer.scrollHeight;
              return row.classList.contains('taxi-items--vertical') && scrolls
                && (!linux || outer.clientHeight === outer.scrollHeight);
            })()`), 'a wrapped row makes the form scroll vertically');
            await allocateFormViewport(floating, preferred);
            const conditionalGeometry = () => floating.evaluate(`(() => {
              const row = document.querySelector('.taxi-items[data-grouping=HorizontalIfPossible]');
              const root = row.closest('.taxi-form-frame');
              const outer = document.querySelector('.preview-scroll');
              const body = document.querySelector('.taxi-form-scrollport');
              return { horizontal: row.classList.contains('taxi-items--horizontal'),
                outer: [outer.clientHeight, outer.scrollHeight], body: [body.clientHeight, body.scrollHeight],
                scrollable: body.hasAttribute('data-scrollable'),
                frame: root.getBoundingClientRect().height, rowHeight: row.getBoundingClientRect().height,
                items: root.style.getPropertyValue('--taxi-form-items-min-height') };
            })()`);
            await until(async () => {
              const { horizontal, outer, scrollable } = await conditionalGeometry();
              return horizontal && outer[0] === outer[1] && !scrollable;
            }, 'the row returns to horizontal at its preferred size').catch(async error => {
              throw new Error(`At ${preferred.join(' × ')}: ${JSON.stringify(await conditionalGeometry())}`, { cause: error });
            });
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
            results.push(await verifyColumnDivider(floating, original, replace));
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
