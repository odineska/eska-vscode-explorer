const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

async function geometry(ui, keys, expected) {
  return ui.evaluate(`(() => {
    const root = document.querySelector('.taxi-form-frame');
    if (!root || root.closest('.taxi-preview').dataset.formLayout !== 'allocated') return null;
    const origin = root.getBoundingClientRect();
    const box = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return [r.x - origin.x, r.y - origin.y, r.width, r.height];
    };
    const nodes = new Map([...root.querySelectorAll('[data-element]')].map(element => [element.dataset.element, element]));
    const keys = ${JSON.stringify(keys)}, fields = ${JSON.stringify(Object.keys(expected.fields))};
    const groups = Object.entries(keys).flatMap(([name, key]) => {
      const element = nodes.get(key), surface = element?.querySelector(':scope > .taxi-group');
      return surface ? [[name, element, surface]] : [];
    });
    const fills = Object.fromEntries(groups.filter(([, , surface]) => surface.classList.contains('taxi-group--painted'))
      .map(([name, , surface]) => {
        const [x,y,w,h] = box(surface);
        return [name, surface.dataset.nativeGroupBackground === 'ready' ? [x,y+1,w,h-2] : null];
      }));
    return {
      frame: [origin.width, origin.height],
      fields: Object.fromEntries(fields.map(name => [name, box(nodes.get(keys[name])?.querySelector('.taxi-input'))])),
      groups: Object.fromEntries(groups.map(([name, element]) => [name, box(element)])),
      fills,
      headingLines: Object.fromEntries(${JSON.stringify(Object.keys(expected.headingLines ?? {}))}.map(name => {
        const title = nodes.get(keys[name])?.querySelector(':scope > .taxi-group > .taxi-group-title');
        return [name, title ? Math.round(title.offsetHeight / parseFloat(getComputedStyle(title).lineHeight)) : 0];
      })),
      captionLines: Object.fromEntries(${JSON.stringify(Object.keys(expected.captionLines ?? {}))}.map(name => {
        const label = nodes.get(keys[name])?.querySelector('.taxi-field-label');
        return [name, label ? label.querySelectorAll('.taxi-field-caption-line').length || 1 : 0];
      })),
    };
  })()`);
}

function matches(actual, expected, frame = true) {
  return actual && (process.platform !== 'linux'
    || (!frame || JSON.stringify(actual.frame) === JSON.stringify(expected.frame))
    && JSON.stringify(actual.fields) === JSON.stringify(expected.fields)
    && ['headingLines', 'captionLines'].every(key => expected[key] === undefined
      || JSON.stringify(actual[key]) === JSON.stringify(expected[key]))
    && (expected.fills === undefined || Object.keys(actual.fills).length === Object.keys(expected.fills).length
      && Object.entries(expected.fills).every(([name, box]) => JSON.stringify(actual.fills[name]) === JSON.stringify(box))));
}

const changes = {
  NormalMiddle: { control: 'ControlNone', select: 'Below', before: 'normal', after: 'none',
    from: '<Representation>NormalSeparation</Representation>', to: '<Representation>None</Representation>' },
  VerticalLeadingPaint: { control: 'VerticalBare', select: 'B', before: 'painted', after: 'bare',
    from: '<BackColor>#E7D6FF</BackColor>', to: '' },
};

async function inDetachedPreview(service, view, main, ui, verify) {
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'separation detached');
  const preview = view.frames.get('preview');
  const floating = await frame({ detached: true, state: { title: preview.panel.title } });
  try {
    assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
    await verify(floating);
  } finally {
    try {
      await service.receive(view, preview, { type: 'dock' });
      await until(() => !view.frames.has('preview'), 'separation docked');
    } finally {
      floating.close();
    }
  }
}

async function verifyUpdates({ document, service, view, main, ui, keys, original, expected, control, change }) {
  const changed = original.replace(change.from, change.to);
  assert.notEqual(changed, original);
  const identity = [...view.nodes.values()].find(node => node.name === change.select).identity;
  await service.receive(view, main, { type: 'select', identity });
  const results = [];
  async function update(xml, target, profile, name) {
    await editFormSource(document, view, xml);
    await until(() => target.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)),
      'current separation revision');
    let actual;
    await until(async () => {
      actual = await geometry(target, keys, profile);
      return matches(actual, profile, false);
    }, name);
    assert.deepEqual(view.selected, identity);
    assert.deepEqual(target.scriptErrors(), []);
    results.push({ name, fields: actual.fields, fills: actual.fills });
  }
  const remember = 'globalThis.__separationInputs = [...document.querySelectorAll(".taxi-input")]; true';
  const preserved = '__separationInputs.every(element => element.isConnected)';
  await ui.evaluate(remember);
  await update(changed, ui, control, 'main-dirty-' + change.after);
  await update(original, ui, expected, 'main-dirty-' + change.before);
  assert.equal(await ui.evaluate(preserved), true);

  await inDetachedPreview(service, view, main, ui, async floating => {
    await floating.evaluate(remember);
    for (const width of [400, 550, 400]) {
      await allocateFormViewport(floating, [width,300]);
      await update(changed, floating, control, 'detached-' + width + '-' + change.after);
      await update(original, floating, expected, 'detached-' + width + '-' + change.before);
      assert.equal(await floating.evaluate(preserved), true);
    }
  });
  return results;
}

async function verifyReflow({ service, view, main, ui, keys, expected, gallery, plan, document, original }) {
  const profiles = plan.cases.map(name => gallery.find(sample => sample.kind === name).expected);
  const identity = [...view.nodes.values()].find(node => node.name === (plan.selected ?? 'B')).identity;
  const changed = plan.edit && original.replace(plan.edit.from, plan.edit.to);
  if (plan.edit) assert.notEqual(changed, original);
  await service.receive(view, main, { type: 'select', identity });
  const results = [];
  async function observe(target, profile, name) {
    let actual, preferredWidth;
    try {
      await until(async () => {
        actual = await geometry(target, keys, profile);
        preferredWidth = await target.evaluate(
          "parseFloat(document.querySelector('.taxi-form-frame').style.getPropertyValue('--taxi-form-preferred-width'))");
        return matches(actual, profile) && preferredWidth === expected.frame[0];
      }, name);
    } catch (error) {
      throw new Error(name + ' ' + JSON.stringify({ actual, preferredWidth }), { cause: error });
    }
    assert.equal(await target.evaluate('__resizedFormInputs.every(element => element.isConnected)'), true);
    assert.deepEqual(view.selected, identity);
    assert.deepEqual(target.scriptErrors(), []);
    results.push({ name, ...actual });
  }
  async function resize(target, mode) {
    await target.evaluate('globalThis.__resizedFormInputs = [...document.querySelectorAll(".taxi-input")]; true');
    try {
      for (const [index, profile] of profiles.entries()) {
        await allocateFormViewport(target, profile.frame);
        const width = await target.evaluate(`(() => {
          const area = document.querySelector('.preview-scroll'), style = getComputedStyle(area);
          return area.offsetWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 8;
        })()`);
        assert.equal(width, profile.frame[0]);
        await observe(target, profile, mode + '-resize-' + width);
        if (changed && index === 0) {
          await editFormSource(document, view, changed);
          await until(() => target.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)),
            'resized form received the dirty edit');
          await target.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await observe(target, profile, mode + '-folded-dirty-' + width);
        }
      }
    } finally {
      if (changed) await editFormSource(document, view, original);
    }
  }
  await resize(ui, 'main');
  await inDetachedPreview(service, view, main, ui, floating => resize(floating, 'detached'));
  return results;
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const explorer = await vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;
  for (const form of fixture.formGallery) {
    const disk = await fs.readFile(form.path), original = disk.toString('utf8');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const current = () => [...service.views.values()].find(view => sameSourcePath(view.path, form.path));
    await until(() => current()?.phase === 'ready', 'separation model ready');
    const view = current(), main = view.frames.get('main');
    const manualViewport = process.env.ESKA_FORM_MANUAL_VIEWPORT === '1' || form.kind.startsWith('ConditionalWidth');
    const frameOptions = { fixedFormArea: !manualViewport, state: { title: main.panel.title } };
    const ui = await frame(frameOptions);
    try {
      const keys = Object.fromEntries([...view.nodes.values()].map(node =>
        [node.name, `${node.identity.source}:current:${node.identity.key.value}`]));
      const expected = form.expected;
      if (manualViewport) await allocateFormViewport(ui, expected.frame);
      await ui.evaluate('document.fonts.ready.then(() => true)');
      let actual, previous, stable = 0;
      await until(async () => {
        actual = await geometry(ui, keys, expected);
        const value = JSON.stringify(actual);
        stable = value === previous ? stable + 1 : 0;
        previous = value;
        return stable >= 3 && matches(actual, expected);
      }, 'stable separation geometry ' + form.kind);
      assert.deepEqual(ui.scriptErrors(), []);
      results.push({ name: form.kind, ...actual });
      await ui.parkPointer();
      await ui.screenshot('separation-' + form.kind + '-' + vscode.env.language + '.png');
      const change = changes[form.kind];
      if (change) {
        const control = fixture.formGallery.find(sample => sample.kind === change.control).expected;
        results.push(...await verifyUpdates({ document, service, view, main, ui, keys, original, expected, control, change }));
      }
      const reflow = expected.reflow ?? (form.kind === 'ConditionalPaint'
        ? { cases: ['ConditionalWidth29', 'ConditionalWidth24', 'ConditionalWidth35', 'ConditionalPaint'] } : undefined);
      if (reflow && process.platform === 'linux') {
        frameOptions.fixedFormArea = false;
        results.push(...await verifyReflow({ service, view, main, ui, keys, expected, plan: reflow,
          gallery: fixture.formGallery, document, original }));
      }
      assert.deepEqual(await fs.readFile(form.path), disk);
    } finally {
      await editFormSource(document, view, original);
      ui.close();
      main.panel.dispose();
      await until(() => service.views.size === 0, 'separation view released');
      await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({
    passed: true, locale: vscode.env.language, sourceWrites: false, results,
  }));
};
