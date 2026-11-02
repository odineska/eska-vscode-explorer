const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'eska-explorer');
  const explorer = await extension.activate(); await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results = [];
  for (const form of fixture.formGallery) {
    const before = await fs.readFile(form.path);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    const service = explorer.formPreview;
    await until(() => [...service.views.values()].some(view => view.path === form.path && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => view.path === form.path), panel = view.frames.get('main');
    const ui = await frame({ state: { title: panel.panel.title } });
    await until(async () => await ui.evaluate("!!document.querySelector('.taxi-table-scroll')"), `render ${form.kind}`);
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    const geometry = await ui.evaluate(`(() => {
      const rect = node => {const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      return {frame:rect(document.querySelector('.taxi-form-frame')),control:rect(document.querySelector('.taxi-table-scroll')),
        header:rect(document.querySelector('.taxi-table-head')),headerColor:getComputedStyle(document.querySelector('.taxi-table-head')).backgroundColor,
        columns:[...document.querySelectorAll('[data-column]')].map(node=>({label:node.textContent,...rect(node)})),
        bar:!!document.querySelector('.taxi-table-command-bar'),chips:document.querySelector('.taxi-table-search-controls')?.textContent,
        mark:!!document.querySelector('.taxi-table-incomplete'),footer:document.querySelector('.taxi-table-footer')?.textContent,
        fabricatedRows:document.querySelectorAll('.taxi-table-empty [role=row], .taxi-table-empty [role=cell]').length};
    })()`);
    assert.equal(geometry.control.width, ['GridFooter', 'NoAutoFill'].includes(form.kind) ? 400 : 415, `${form.kind} width`);
    assert.equal(geometry.control.height, form.kind === 'GridFooter' ? 145 : form.kind === 'Vertical' ? 228 : 227, `${form.kind} height`);
    assert.equal(geometry.header.height, form.kind === 'Vertical' ? 90 : ['HorizontalTitled', 'InCell'].includes(form.kind) ? 60 : 30);
    assert.equal(geometry.bar, !['GridFooter', 'NoAutoFill'].includes(form.kind));
    assert.equal(geometry.mark, form.kind === 'Marked');
    assert.equal(geometry.fabricatedRows, 0);
    assert.equal(geometry.headerColor, 'rgb(242, 242, 242)');
    assert.equal(geometry.frame.height, form.kind === 'GridFooter' ? 225 : form.kind === 'NoAutoFill' ? 307 : form.kind === 'Vertical' ? 343 : 342);
    if (form.kind === 'GridFooter') assert.equal(geometry.footer, 'Total');
    if (['Default', 'ReadOnly', 'Marked'].includes(form.kind)) {
      assert.equal(geometry.columns[1].width, form.kind === 'ReadOnly' ? 108 : 129);
      assert.equal(geometry.columns[2].width, 54);
    }
    if (form.kind === 'Default') {
      const searchWidth = "document.querySelector('.taxi-table-search').getBoundingClientRect().width";
      if (vscode.env.language.startsWith('ru')) assert.equal(Math.round(await ui.evaluate(searchWidth)), 172);
      await ui.evaluate("document.querySelector('.taxi-form-frame').style.width='1000px'");
      assert.equal(await ui.evaluate(searchWidth), 260, 'search stays bounded in a wide table');
      await ui.evaluate("document.querySelector('.taxi-form-frame').style.width='max-content'");
    }
    await ui.screenshot(`table-${form.kind}-${vscode.env.language}.png`);
    assert.deepEqual(await fs.readFile(form.path), before);
    results.push({kind:form.kind,...geometry}); panel.panel.dispose();
    await until(() => service.views.size === 0, 'release gallery form'); await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({passed:true,formTables:true,locale:vscode.env.language,results}));
};
