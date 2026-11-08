const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { frame, until, sameSourcePath, editFormSource, allocateFormViewport } = require('./webview-host.cjs');

function geometryExpression(view) {
  const keys = Object.fromEntries([...view.nodes.values()].map(node =>
    [node.name, `${node.identity.source}:current:${node.identity.key.value}`]));
  return `(() => {
    const root=document.querySelector('.taxi-form-frame');if(!root)return null;
    const origin=root.getBoundingClientRect(),nodes=new Map([...root.querySelectorAll('[data-element]')].map(e=>[e.dataset.element,e]));
    const keys=${JSON.stringify(keys)},control=name=>nodes.get(keys[name])?.querySelector(name==='Rows'?'.taxi-table-scroll':'.taxi-input');
    if(${process.platform === 'linux'}&&[...root.querySelectorAll('.taxi-input')].some(e=>e.dataset.nativeBorder!=='ready'))return null;
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return[r.x-origin.x,r.y-origin.y,r.width+Number(e.dataset.nativeOutset||0),r.height]};
    const grid=control('Rows'),pager=grid?.parentElement.querySelector('.taxi-table-pagination');if(!grid)return null;
    const fields=Object.fromEntries(['Above','Below','Rows'].map(name=>[name,box(control(name))]));
    const paginationBandHeight=pager?.getBoundingClientRect().height||0;
    return {frame:[origin.width,origin.height],fields,
      combinedGrid:[...fields.Rows.slice(0,3),fields.Rows[3]+paginationBandHeight],paginationBandHeight};
  })()`;
}

async function prepareCaptureWindow(ui, detached = false) {
  if (process.platform !== 'linux') return;
  const target = await ui.nativeWindow({detached}), current = await ui.windowBounds(target.targetId);
  if (current.bounds.width===1450 && current.bounds.height===1450) return;
  await ui.resizeWindow(current.windowId, {width:1450,height:1450,windowState:'normal'});
  await until(async () => {
    const {bounds} = await ui.windowBounds(target.targetId);
    return bounds.width===1450 && bounds.height===1450;
  }, 'complete table capture window');
}

async function assertVisible(ui) {
  if (process.platform !== 'linux') return;
  const bounds = await ui.evaluate(`(() => {
    const r=document.querySelector('.taxi-form-frame').getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};
  })()`);
  assert.ok(bounds.left>=0 && bounds.top>=0 && bounds.right<=bounds.width && bounds.bottom<=bounds.height,
    'complete installed frame is visible: '+JSON.stringify(bounds));
}

async function stableGeometry(ui, view) {
  let actual, previous, stable = 0;
  await until(async () => {
    actual = await ui.evaluate(geometryExpression(view));
    const value = JSON.stringify(actual);
    stable = value === previous ? stable + 1 : 0;
    previous = value;
    return actual && stable >= 3;
  }, 'stable table height and complete frame');
  return actual;
}

function assertGeometry(actual, form, locale, label) {
  if (process.platform !== 'linux') return;
  const { screenshotSha256, ...expected } = form.expected.locales[locale];
  assert.deepEqual(actual, expected, label);
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
    await until(() => [...service.views.values()].find(v => sameSourcePath(v.path, form.path))?.phase === 'ready', 'table model ready');
    const view = [...service.views.values()].find(v => sameSourcePath(v.path, form.path)), main = view.frames.get('main');
    const ui = await frame({ fixedFormArea: true, state: { title: main.panel.title } });
    try {
      await prepareCaptureWindow(ui);
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const actual = await stableGeometry(ui, view);
      await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR ?? fixture.root, 'table-height-current.json'), JSON.stringify({name:form.kind,actual,expected:form.expected.locales[locale]}));
      assertGeometry(actual, form, locale, form.kind);
      await assertVisible(ui);
      assert.deepEqual(ui.scriptErrors(), []);
      assert.deepEqual(view.snapshot.model.diagnostics.appearance, []);
      assert.deepEqual(view.snapshot.model.diagnostics.composition, []);
      results.push({ name: form.kind, ...actual, nativeGeometryCompared: process.platform === 'linux' });
      await ui.parkPointer();
      await ui.screenshot('table-height-' + form.kind + '-' + locale + '.png');
      if (['StaticDefault', 'DynamicDefault', 'StatusOnly'].includes(form.kind)) {
        const identity = [...view.nodes.values()].find(node => node.name === 'Rows').identity;
        await service.receive(view, main, { type: 'select', identity });
        const remember = target => target.evaluate("globalThis.__tableGrid=document.querySelector('.taxi-table-scroll');true");
        async function change(kind, target, allocated = false) {
          const next = fixture.formGallery.find(f => f.kind === kind);
          assert.ok(next);
          await editFormSource(doc, view, await fs.readFile(next.path, 'utf8'));
          await until(() => target.evaluate('globalThis.__eskaNativeFormRevision === ' + JSON.stringify(view.snapshot.revision)), 'current table revision');
          if (allocated) await allocateFormViewport(target, next.expected.locales[locale].frame);
          const geometry = await stableGeometry(target, view);
          assertGeometry(geometry, next, locale, 'dirty ' + kind);
          await assertVisible(target);
          assert.deepEqual(view.selected, identity);
          assert.equal(await target.evaluate('__tableGrid.isConnected'), true);
          assert.deepEqual(target.scriptErrors(), []);
          results.push({ name: (allocated ? 'detached-' : 'dirty-') + kind, ...geometry });
        }
        const dynamic = form.kind === 'DynamicDefault';
        const status = form.kind === 'StatusOnly';
        await remember(ui);
        const changes = status
          ? ['StatusNone', 'StatusSearch', 'StatusCommands', 'StatusFixed', 'StatusOnly']
          : dynamic
          ? ['DynamicManual7', 'DynamicManual1', 'DynamicHeight4Max7', 'DynamicFont16Max7', 'DynamicDefault']
          : ['StaticManual7', 'StaticAuto1', 'StaticHeight9Max7', 'StaticRows9Max7', 'StaticTallHeader7', 'StaticFont16Max7', 'StaticDefault'];
        for (const kind of changes) await change(kind, ui);
        const workbench = await ui.nativeWindow();
        await service.receive(view, main, { type: 'detach' });
        await until(() => view.frames.get('preview')?.ready, 'table detached');
        const preview = view.frames.get('preview'), floating = await frame({ detached: true, state: { title: preview.panel.title } });
        try {
          assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
          await prepareCaptureWindow(floating, true);
          await remember(floating);
          const floatingChanges = status ? ['StatusSearch', 'StatusFixed', 'StatusOnly']
            : dynamic ? ['DynamicFont16Max7', 'DynamicDefault'] : ['StaticManual7', 'StaticRows9Max7'];
          for (const kind of floatingChanges) await change(kind, floating, true);
        } finally {
          try {
            await service.receive(view, preview, { type: 'dock' });
            await until(() => !view.frames.has('preview'), 'table docked');
          } finally { floating.close(); }
        }
      }
      assert.deepEqual(await fs.readFile(form.path), disk);
    } catch (error) {
      await ui.parkPointer().catch(() => {});
      await ui.screenshot('table-height-' + form.kind + '-failure-' + locale + '.png').catch(() => {});
      throw error;
    } finally {
      await editFormSource(doc, view, source);
      ui.close();
      main.panel.dispose();
      await until(() => service.views.size === 0, 'table height view released');
      await Promise.all([...service.closing]);
    }
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, locale, sourceWrites: false, fullNativeProfileAccepted: false, results }));
};
