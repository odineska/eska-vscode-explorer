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
    const ui = await frame({fixedFormArea:true, state: { title: panel.panel.title } });
    await until(async () => await ui.evaluate(`!!document.querySelector('[data-kind="${form.kind}"]')`), `render ${form.kind}`);
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    const geometry = await ui.evaluate(`(() => { const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}; const control=document.querySelector('.taxi-special') ?? document.querySelector('.taxi-field-control').firstElementChild;return {frame:rect(document.querySelector('.taxi-form-frame')),control:rect(control),title:document.querySelector('.taxi-field-row').dataset.titleLocation,font:getComputedStyle(control).fontFamily}; })()`);
    if (form.kind === 'InputField') assert.equal(geometry.control.width, 161);
    const sizes = { CheckBoxField: [15, 15], ProgressBarField: [320, 21], TrackBarField: [320, 28], PictureField: [122, 120], SpreadSheetDocumentField: [500, 243], PlannerField: [500, 243] };
    if (sizes[form.kind]) assert.deepEqual([geometry.control.width, geometry.control.height], sizes[form.kind]);
    const frameHeights = { InputField: 75, CheckBoxField: 69, ProgressBarField: 73, TrackBarField: 99, PictureField: 191, RadioButtonField: 69, LabelField: 69,
      TextDocumentField:314, PDFDocumentField:344, DendrogramField:314, GanttChartField:314, GeographicalSchemaField:314, GraphicalSchemaField:314, PeriodField:280 };
    if (frameHeights[form.kind]) assert.equal(geometry.frame.height, frameHeights[form.kind], `${form.kind} native auto form height`);
    if (form.kind === 'TrackBarField') assert.equal(geometry.title, 'Top');
    if (form.kind === 'RadioButtonField') await checkRadioChoices(ui, service, view, document);
    if (form.kind === 'SpreadSheetDocumentField') {
      assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-sheet th').length"), 0);
      assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-sheet-cell-selected').length"), 1);
    }
    if (form.kind === 'PlannerField') {
      if (process.platform==='linux' && await ui.evaluate("Intl.DateTimeFormat().resolvedOptions().locale==='en-US'")) {
        await until(()=>ui.evaluate("document.querySelector('[data-native-planner]')?.dataset.nativePlanner==='ready'"),'native planner paint');
      } else {
        assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-planner-hour').length"),24);
        assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-planner-meeting').length"),1);
      }
    }
    if (form.kind === 'InputField') {
      const inspect = `(() => { const node=document.querySelector('.taxi-input'),css=getComputedStyle(node),label=getComputedStyle(document.querySelector('.taxi-field-label'));return {width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,color:css.color,background:css.backgroundColor,border:css.borderColor,font:label.font}; })()`;
      const beforeTheme = await ui.evaluate(inspect), shellBefore = await ui.evaluate("getComputedStyle(document.querySelector('.form-shell')).color");
      const configuration = vscode.workspace.getConfiguration('workbench'), theme = configuration.get('colorTheme');
      await configuration.update('colorTheme', /light/i.test(theme ?? '') ? 'Default Dark Modern' : 'Default Light Modern', vscode.ConfigurationTarget.Global);
      await until(async()=>await ui.evaluate("getComputedStyle(document.querySelector('.form-shell')).color") !== shellBefore,'native theme changed');
      assert.deepEqual(await ui.evaluate(inspect),beforeTheme,'form profile is isolated from the IDE theme');
      await ui.screenshot(`renderer-theme-${vscode.env.language}.png`);
      await configuration.update('colorTheme',theme,vscode.ConfigurationTarget.Global);
    }
    if (form.kind === 'CalendarField') { assert.equal(geometry.control.width,338); assert.equal(geometry.control.height,300); assert.equal(geometry.title,'Top'); }
    if (['ChartField','HTMLDocumentField','FormattedDocumentField'].includes(form.kind)) {assert.equal(geometry.control.width,500);assert.equal(geometry.control.height,243);assert.equal(geometry.title,'Top');}
    if (form.kind === 'FormattedDocumentField') assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-document-toolbar').length"),0);
    if(form.kind==='ChartField'){
      if(process.platform==='linux'&&await ui.evaluate("Intl.DateTimeFormat().resolvedOptions().locale==='en-US'"))await until(()=>ui.evaluate("document.querySelector('[data-native-chart]')?.dataset.nativeChart==='ready'"),'native Chart paint');
      else assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-chart rect').length"),20);
    }
    if (['TextDocumentField','PDFDocumentField','DendrogramField','GanttChartField','GeographicalSchemaField','GraphicalSchemaField'].includes(form.kind)) {
      assert.deepEqual([geometry.control.width,geometry.control.height],[500,243]);assert.equal(geometry.title,'Top');
    }
    if (form.kind === 'PeriodField') {
      assert.deepEqual([geometry.control.width,geometry.control.height],[500,209]);assert.equal(geometry.title,'Top');
      if(process.platform==='linux'&&Intl.DateTimeFormat().resolvedOptions().locale==='en-US'){
        await until(()=>ui.evaluate("document.querySelector('[data-native-period]')?.dataset.nativePeriod==='ready'"),'period native surface painted');
      }else{
        assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-period-months > span').length"),36);
        assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-period-months > .current').length"),1);
      }
    }
    if (form.kind==='DendrogramField') {
      if(process.platform==='linux'&&await ui.evaluate("Intl.DateTimeFormat().resolvedOptions().locale==='en-US'"))await until(()=>ui.evaluate("document.querySelector('[data-native-dendrogram]')?.dataset.nativeDendrogram==='ready'"),'native dendrogram paint');
      else assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-dendrogram-label').length"),4);
    }
    if (form.kind==='GanttChartField') {
      if(process.platform==='linux'&&await ui.evaluate("Intl.DateTimeFormat().resolvedOptions().locale==='en-US'"))await until(()=>ui.evaluate("document.querySelector('[data-native-gantt]')?.dataset.nativeGantt==='ready'"),'native Gantt paint');
      else assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-gantt-interval').length"),vscode.env.language.startsWith('ru')?3:5);
    }
    if (form.kind === 'GraphicalSchemaField') assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.taxi-graphical-schema')).backgroundSize"),'20px 20px, 20px 20px');
    if (form.kind === 'TextDocumentField') assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.taxi-text-document'),'::before').width"),'16px');
    if (form.kind === 'PDFDocumentField') {
      assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-document-toolbar').length"),0);
      assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-table-search-controls').length"),1);
      const original = document.getText();
      const change = async value => { const edit = new vscode.WorkspaceEdit();edit.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),value);assert.equal(await vscode.workspace.applyEdit(edit),true); };
      await change(original.replace(/(<ViewStatusAddition\b[^>]*>)/,'$1<Visible>false</Visible>'));
      await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-table-search-controls').length") === 0,'PDF view-status hidden from dirty XML');
      assert.equal(await ui.evaluate("document.querySelector('.taxi-form-frame').getBoundingClientRect().height"),314);
      await change(original);
      await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-table-search-controls').length") === 1,'PDF view-status restored from dirty XML');
    }
    await ui.screenshot(`renderer-${form.kind}-${vscode.env.language}.png`);
    assert.deepEqual(await fs.readFile(form.path),before);
    results.push({kind:form.kind,...geometry}); panel.panel.dispose();
    await until(()=>service.views.size===0,'release gallery form');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formRenderer:true,locale:vscode.env.language,results}));
};

async function checkRadioChoices(ui, service, view, document) {
  assert.equal(await ui.evaluate("document.querySelectorAll('.taxi-radio').length"), 3);
  const original = document.getText();
  const options = labels => '<ChoiceList>' + labels.map((label, index) =>
    `<xr:Item><xr:Presentation/><xr:CheckState>0</xr:CheckState><xr:Value xsi:type="FormChoiceListDesTimeValue"><Presentation><v8:item><v8:lang>en</v8:lang><v8:content>${label}</v8:content></v8:item></Presentation><Value xsi:type="xs:string">Choice${index}</Value></xr:Value></xr:Item>`
  ).join('') + '</ChoiceList>';
  async function change(xml) {
    const edit = new vscode.WorkspaceEdit();
    const revision = view.snapshot.revision;
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), xml);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await until(() => view.snapshot.revision !== revision, 'dirty radio properties applied');
  }
  const editOptions = (properties, labels) => original.replace('<RadioButtonType>Auto</RadioButtonType>',
    properties + '<TitleLocation>None</TitleLocation>' + options(labels));
  const measure = `(() => {
    const frame = document.querySelector('.taxi-form-frame');
    const form = frame.getBoundingClientRect(), css = getComputedStyle(frame);
    const settled = Math.abs(form.width - parseFloat(css.getPropertyValue('--taxi-form-preferred-width'))) <= .5
      && Math.abs(form.height - parseFloat(css.getPropertyValue('--taxi-form-preferred-height'))) <= .5;
    const control = document.querySelector('.taxi-radios');
    const origin = control.getBoundingClientRect();
    const glyphs = [...control.querySelectorAll('.taxi-radio')].map(glyph => {
      const box = glyph.getBoundingClientRect();
      return [box.x - origin.x, box.y - origin.y, box.width, box.height];
    });
    return { settled, size: [form.width, form.height], mode: control.dataset.representation, glyphs,
      disabled: control.getAttribute('aria-disabled'), captions: [...control.children].map(option => option.getAttribute('aria-label')),
      checked: [...control.children].filter(option => option.getAttribute('aria-checked') === 'true').length };
  })()`;
  const labels = ['First', 'Second long', 'Third', 'Fourth', 'Fifth'];
  await change(editOptions('<RadioButtonType>RadioButtons</RadioButtonType><ColumnsCount>3</ColumnsCount>', labels));
  await until(async () => {
    const result = await ui.evaluate(measure);
    return result.settled && result.captions.length === labels.length;
  }, 'radio columns rendered at the preferred size');
  const buttons = await ui.evaluate(measure);
  assert.deepEqual(buttons.captions, labels);
  assert.equal(buttons.checked, 1);
  assert.equal(buttons.mode, 'buttons');
  if (process.platform === 'linux') {
    assert.deepEqual(buttons.size, [255, 95]);
    assert.deepEqual(buttons.glyphs, [[1, 2, 15, 15], [1, 28, 15, 15], [105, 2, 15, 15], [105, 28, 15, 15], [174, 2, 15, 15]]);
  }
  const workbench = await ui.nativeWindow();
  await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
  await until(() => view.frames.get('preview')?.ready, 'detached radio preview ready');
  const detached = view.frames.get('preview');
  const floating = await frame({ detached: true, fixedFormArea: true, state: { title: detached.panel.title } });
  assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
  await floating.evaluate("globalThis.__radioChoices = document.querySelector('.taxi-radios'); true");
  await change(editOptions('<RadioButtonType>Tumbler</RadioButtonType><ColumnsCount>1</ColumnsCount><Enabled>false</Enabled>', ['Update  ', 'Skip']));
  await until(async () => {
    const result = await floating.evaluate(measure);
    return result.settled && result.mode === 'segments';
  }, 'segments rendered at the preferred size in detached preview');
  const segments = await floating.evaluate(measure);
  assert.deepEqual(segments.captions, ['Update', 'Skip']);
  assert.equal(segments.checked, 0);
  assert.equal(segments.disabled, 'true');
  assert.deepEqual(segments.glyphs, []);
  assert.equal(await floating.evaluate("__radioChoices === document.querySelector('.taxi-radios')"), true);
  if (process.platform === 'linux') assert.deepEqual(segments.size, [95, 99]);
  await service.receive(view, detached, { type: 'dock' });
  await until(() => !view.frames.has('preview'), 'radio preview docked');
  await until(async () => (await ui.evaluate(measure)).settled, 'docked radio geometry settled');
  assert.deepEqual(await ui.evaluate(measure), segments);
  await change(original);
  await until(async () => (await ui.evaluate(measure)).glyphs.length === 3, 'automatic sample restored');
}
