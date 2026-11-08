const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

function geometryExpression(keys, form, locale) {
  const expected = form.expected.locales[locale];
  return `(() => {
    const root=document.querySelector('.taxi-form-frame');if(!root)return null;
    const origin=root.getBoundingClientRect(),nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const keys=${JSON.stringify(keys)},control=name=>nodes.get(keys[name])?.querySelector('.taxi-input');
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return[r.x-origin.x,r.y-origin.y,r.width+Number(e.dataset.nativeOutset||0),r.height]};
    if(${process.platform === 'linux'}&&[...root.querySelectorAll('.taxi-input:not([data-native-spin])')].some(e=>e.dataset.nativeBorder!=='ready'))return null;
    const specs=${JSON.stringify(form.expected.controls)},controls=Object.fromEntries(Object.keys(specs).map(name=>{
      const e=control(name);return[name,{choice:!!e?.querySelector('.taxi-input-button--choice')}];
    }));
    const result={frame:[origin.width,origin.height],fields:Object.fromEntries(${JSON.stringify(Object.keys(expected.fields))}.map(name=>[name,box(control(name))])),controls};
    if(${Object.hasOwn(expected, 'dividerColumns')}){
      result.dividerColumns=Object.fromEntries(Object.keys(specs).map(name=>[name,[...control(name).querySelectorAll('.taxi-input-button')].map(e=>e.getBoundingClientRect().x-origin.x)]));
    }
    return result;
  })()`;
}

async function stableGeometry(ui, expression) {
  let actual, previous, stable = 0;
  await until(async () => {
    actual = await ui.evaluate(expression);
    const value = JSON.stringify(actual);
    stable = value === previous ? stable + 1 : 0;
    previous = value;
    return actual && stable >= 3;
  }, 'stable text input geometry');
  return actual;
}

function assertGeometry(actual, form, locale, label) {
  if (process.platform !== 'linux') return;
  const { screenshotSha256, ...expected } = form.expected.locales[locale];
  const { controls, ...geometry } = actual;
  assert.deepEqual(geometry, expected, label);
  assert.deepEqual(controls, Object.fromEntries(Object.entries(form.expected.controls).map(([name, control]) => [name, {choice:control.choice}])), label + '/buttons');
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const locale = vscode.env.language.startsWith('ru') ? 'ru' : 'en';
  const explorer = await vscode.extensions.all.find(e => e.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;
  for (const form of fixture.formGallery) {
    const disk = await fs.readFile(form.path), source = disk.toString('utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...service.views.values()].find(v => sameSourcePath(v.path, form.path))?.phase === 'ready', 'text model ready');
    const view = [...service.views.values()].find(v => sameSourcePath(v.path, form.path)), main = view.frames.get('main');
    const ui = await frame({ fixedFormArea: true, state: { title: main.panel.title } });
    const expression = current => geometryExpression(Object.fromEntries([...view.nodes.values()].map(n => [n.name, `${n.identity.source}:current:${n.identity.key.value}`])), current, locale);
    try {
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const actual = await stableGeometry(ui, expression(form));
      await fs.writeFile(path.join(fixture.root, 'text-input-current.json'), JSON.stringify({name:form.kind,actual,expected:form.expected.locales[locale]}));
      assertGeometry(actual, form, locale, form.kind);
      assert.deepEqual(ui.scriptErrors(), []);
      assert.deepEqual(view.snapshot.model.diagnostics.appearance, []);
      assert.deepEqual(view.snapshot.model.diagnostics.composition, []);
      results.push({ name: form.kind, ...actual, nativeGeometryCompared: process.platform === 'linux' });
      await ui.parkPointer();
      await ui.screenshot('text-inputs-' + form.kind + '-' + locale + '.png');
      const transitions = {
        StringAutoWide: { target: 'Value', dirty: ['StringMax12Wide', 'SmallMax12', 'ChoiceWidth3Max12', 'ChoiceMax1Font11', 'ChoiceMax1Font16', 'ChoiceMax1', 'StringAutoWide'], detached: ['ChoiceMax1', 'ChoiceMax2'] },
        RootOnlyMenu: { target: 'Above', dirty: ['RootNone', 'RootOnlyMenu'], detached: ['RootNone', 'RootOnlyMenu'] },
      }[form.kind];
      if (transitions) {
        const identity = [...view.nodes.values()].find(n => n.name === transitions.target).identity;
        await service.receive(view, main, { type: 'select', identity });
        const remember = target => target.evaluate("globalThis.__textControls=[...document.querySelectorAll('.taxi-input')];true");
        async function change(kind, target, allocated = false) {
          const next = fixture.formGallery.find(f => f.kind === kind);
          assert.ok(next);
          await editFormSource(doc, view, await fs.readFile(next.path, 'utf8'));
          await until(() => target.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'current text revision');
          if (allocated) await allocateFormViewport(target, next.expected.locales[locale].frame);
          const geometry = await stableGeometry(target, expression(next));
          assertGeometry(geometry, next, locale, 'dirty ' + kind);
          assert.deepEqual(view.selected, identity);
          assert.equal(await target.evaluate('__textControls.every(e=>e.isConnected)'), true);
          assert.deepEqual(target.scriptErrors(), []);
          results.push({ name: (allocated ? 'detached-' : 'dirty-') + kind, ...geometry });
        }
        await remember(ui);
        for (const kind of transitions.dirty) await change(kind, ui);
        const workbench = await ui.nativeWindow();
        await service.receive(view, main, { type: 'detach' });
        await until(() => view.frames.get('preview')?.ready, 'text detached');
        const preview = view.frames.get('preview'), floating = await frame({ detached: true, state: { title: preview.panel.title } });
        try {
          assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
          await remember(floating);
          for (const kind of transitions.detached) await change(kind, floating, true);
        } finally {
          try {
            await service.receive(view, preview, { type: 'dock' });
            await until(() => !view.frames.has('preview'), 'text docked');
          } finally { floating.close(); }
        }
      }
      assert.deepEqual(await fs.readFile(form.path), disk);
    } catch (error) {
      await ui.parkPointer().catch(() => {});
      await ui.screenshot('text-inputs-' + form.kind + '-failure-' + locale + '.png').catch(() => {});
      throw error;
    } finally {
      await editFormSource(doc, view, source);
      ui.close();
      main.panel.dispose();
      await until(() => service.views.size === 0, 'text view released');
      await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, locale, sourceWrites: false, fullNativeProfileAccepted: false, results }));
};
