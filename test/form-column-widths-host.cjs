const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const {frame, until} = require('./webview-host.cjs');

async function pose(ui, keys, expected) {
  await ui.evaluate(`(() => {
    const [width,height]=${JSON.stringify(expected.frame)}, viewport=document.querySelector('.preview-scroll');
    const css=getComputedStyle(viewport);
    Object.assign(viewport.style,{
      width:(width+8+parseFloat(css.paddingLeft)+parseFloat(css.paddingRight))+'px',
      height:(height+8+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom))+'px',
      minHeight:'0',flex:'0 0 auto'
    });
  })()`);
  let actual;
  try {
    await until(async () => {
      actual = await ui.evaluate(`(() => {
        const root=document.querySelector('.taxi-form-frame'), origin=root.getBoundingClientRect();
        const fields=[...root.querySelectorAll('[data-kind=InputField]')];
        const controls=Object.fromEntries(Object.entries(${JSON.stringify(keys)}).map(([name,key]) => {
          const input=fields.find(field=>field.dataset.element===key)?.querySelector('.taxi-input');
          if(!input)return [name,null];
          const r=input.getBoundingClientRect();return [name,[r.x-origin.x,r.y-origin.y,r.width,r.height]];
        }));
        return {frame:[origin.width,origin.height],controls};
      })()`);
      const tolerance = expected.tolerancePx ?? 0;
      return actual.frame.every((v,i) => v === expected.frame[i])
        && Object.entries(expected.controls).every(([name, rect]) =>
          actual.controls[name]?.every((value,i) => Math.abs(value-rect[i]) <= tolerance));
    }, expected.name);
  } catch (error) {
    throw new Error(JSON.stringify({case:expected.name,actual,expected}), {cause:error});
  }
  return {label:expected.name,...actual};
}

function sourceVariant(xml, edit) {
  if (edit === 'automatic') return xml.replace('<Width>30</Width>', '');
  const name = edit === 'fixLeft' ? 'A' : 'B';
  const start = new RegExp(`<InputField name="${name}" id="\\d+">`);
  assert.match(xml,start);
  return xml.replace(start, match => match + '<HorizontalStretch>false</HorizontalStretch>');
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
    async function replace(xml) {
      if (document.getText() === xml) return;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),xml);
      assert.equal(await vscode.workspace.applyEdit(edit),true);
      await until(() => view.phase === 'ready' && !view.running && !view.timer
        && view.snapshot.dependencies.some(dep => dep.role === 'form' && dep.version === String(document.version)), 'column width XML updated');
    }
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
      if (form.kind === 'Columns') {
        await replace(original);
        const identity = nodes.find(node => node.name === 'B').identity;
        await service.receive(view,main,{type:'select',identity});
        await until(() => view.selected?.key.value === identity.key.value, 'right column field selected');
        const workbench = await ui.nativeWindow();
        await service.receive(view,main,{type:'detach'});
        await until(() => view.frames.get('preview')?.ready, 'column layout detached');
        const preview = view.frames.get('preview');
        const floating = await frame({detached:true,state:{title:preview.panel.title}});
        assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
        await floating.evaluate("globalThis.__widthInputs=[...document.querySelectorAll('.taxi-input')];true");
        const wide = form.cases.find(sample => sample.name === 'LeftWideLarge');
        const narrow = form.cases.find(sample => sample.name === 'Shrink20');
        const changed = original.replace('<Group>Horizontal</Group>',
          '<Group>Horizontal</Group><ChildItemsWidth>LeftWidest</ChildItemsWidth>');
        assert.notEqual(changed,original);
        await replace(changed);
        for (const expected of [wide,narrow,wide]) await pose(floating,keys,expected);
        await replace(sourceVariant(changed,'fixRight'));
        await pose(floating,keys,form.cases.find(sample => sample.edit === 'fixRight'));
        await replace(original);
        await pose(floating,keys,wide);
        assert.deepEqual(view.selected,identity);
        assert.equal(await floating.evaluate('__widthInputs.every(input=>input.isConnected)'),true);
        await service.receive(view,preview,{type:'dock'});
        await until(() => !view.frames.has('preview'), 'column layout returned');
        results.push({label:'detached-column-resize-dirty',sameDom:true,sameSelection:true});
      }
    }
    assert.equal(await fs.readFile(form.path,'utf8'),original);
    main.panel.dispose();
    await until(() => service.views.size === 0, 'column width form closed');
    await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({
    passed:true,locale:vscode.env.language,results,sourceWritesDuringViewing:false,
  }));
};
