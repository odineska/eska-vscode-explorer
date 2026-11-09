const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

function geometryExpression(keys, fields) {
  return `(() => {
    const root=document.querySelector('.taxi-form-frame');if(!root)return null;
    const origin=root.getBoundingClientRect(),nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const keys=${JSON.stringify(keys)},node=name=>nodes.get(keys[name]);
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return[r.x-origin.x,r.y-origin.y,r.width,r.height]};
    const marks=selected=>[...root.querySelectorAll('.taxi-radio'+(selected?'.checked':':not(.checked)'))].map(box).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
    const segment=root.querySelector('.taxi-radios[data-representation=segments]');
    if(${process.platform === 'linux'}&&([...root.querySelectorAll('.taxi-radio')].some(e=>e.dataset.nativeRadio!=='ready')||segment&&segment.dataset.nativeSegments!=='ready'))return null;
    return {frame:[origin.width,origin.height],fields:Object.fromEntries(${JSON.stringify(fields)}.map(name=>[name,box(node(name)?.querySelector('.taxi-input'))])),
      marks:{selected:marks(true),unselected:marks(false)},...(segment?{segmentsPaint:box(segment.querySelector('.taxi-radio-segments-face'))}:{})};
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
  }, 'stable radio geometry');
  return actual;
}

function assertGeometry(actual, expected, label) {
  if (process.platform !== 'linux') return;
  const { screenshotSha256, ...geometry } = expected;
  assert.deepEqual(actual, geometry, label);
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), results = [];
  const locale = vscode.env.language.startsWith('ru') ? 'ru' : 'en';
  const expected = form => form.expected.locales[locale];
  const explorer = await vscode.extensions.all.find(e => e.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;
  for (const form of fixture.formGallery) {
    const disk = await fs.readFile(form.path), source = disk.toString('utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...service.views.values()].find(v => sameSourcePath(v.path, form.path))?.phase === 'ready', 'radio model ready');
    const view = [...service.views.values()].find(v => sameSourcePath(v.path, form.path)), main = view.frames.get('main');
    const ui = await frame({ fixedFormArea: true, state: { title: main.panel.title } });
    try {
      const keys = Object.fromEntries([...view.nodes.values()].map(n => [n.name, `${n.identity.source}:current:${n.identity.key.value}`]));
      const expression = geometryExpression(keys, Object.keys(expected(form).fields));
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const actual = await stableGeometry(ui, expression);
      assertGeometry(actual, expected(form), form.kind);
      assert.deepEqual(ui.scriptErrors(), []);
      assert.deepEqual(view.snapshot.model.diagnostics.appearance, []);
      assert.deepEqual(view.snapshot.model.diagnostics.composition, []);
      results.push({ name: form.kind, ...actual, nativeGeometryCompared: process.platform === 'linux' });
      await ui.parkPointer();
      await ui.screenshot('radio-layout-' + form.kind + '-' + locale + '.png');
      if (form.kind === 'PairExact') {
        const identity = [...view.nodes.values()].find(n => n.name === 'ОбновлятьСуществующие').identity;
        await service.receive(view, main, { type: 'select', identity });
        const remember = target => target.evaluate("globalThis.__radioControls=[...document.querySelectorAll('.taxi-input,.taxi-radios,.taxi-radio')];true");
        async function change(kind, target, allocated = false) {
          const next = fixture.formGallery.find(f => f.kind === kind);
          assert.ok(next);
          await editFormSource(doc, view, await fs.readFile(next.path, 'utf8'));
          await until(() => target.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'current radio revision');
          if (allocated) await allocateFormViewport(target, expected(next).frame);
          const geometry = await stableGeometry(target, expression);
          assertGeometry(geometry, expected(next), 'dirty ' + kind);
          assert.deepEqual(view.selected, identity);
          assert.equal(await target.evaluate('__radioControls.every(e=>e.isConnected)'), true);
          assert.deepEqual(target.scriptErrors(), []);
          results.push({ name: (allocated ? 'detached-' : 'dirty-') + kind, ...geometry });
        }
        await remember(ui);
        await change('PairEnglishTitles', ui);
        await change('PairExact', ui);
        const workbench = await ui.nativeWindow();
        await service.receive(view, main, { type: 'detach' });
        await until(() => view.frames.get('preview')?.ready, 'radio detached');
        const preview = view.frames.get('preview'), floating = await frame({ detached: true, state: { title: preview.panel.title } });
        try {
          assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
          await remember(floating);
          await change('PairEnglishTitles', floating, true);
          await change('PairExact', floating, true);
        } finally {
          try {
            await service.receive(view, preview, { type: 'dock' });
            await until(() => !view.frames.has('preview'), 'radio docked');
          } finally { floating.close(); }
        }
      }
      assert.deepEqual(await fs.readFile(form.path), disk);
    } catch (error) {
      await ui.parkPointer().catch(() => {});
      await ui.screenshot('radio-layout-' + form.kind + '-failure-' + locale + '.png').catch(() => {});
      throw error;
    } finally {
      await editFormSource(doc, view, source);
      ui.close();
      main.panel.dispose();
      await until(() => service.views.size === 0, 'radio view released');
      await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, locale, sourceWrites: false, fullNativeProfileAccepted: false, results }));
};
