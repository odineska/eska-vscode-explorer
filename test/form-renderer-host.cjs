const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
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
    const checkboxModes = form.kind === 'CheckBoxField' ? await checkCheckboxModes(ui, service, view, document, fixture.source) : undefined;
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
    results.push({kind:form.kind,...geometry,...(checkboxModes && {checkboxModes})}); panel.panel.dispose();
    await until(()=>service.views.size===0,'release gallery form');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formRenderer:true,locale:vscode.env.language,results}));
};

async function checkCheckboxModes(ui, service, view, document, sourceRoot) {
  const original = document.getText();
  const field = original.match(/<CheckBoxField name="Control"[^>]*>[\s\S]*?<\/CheckBoxField>/)[0];
  const source = field.replace(/<Title>[\s\S]*?<\/Title>/,'');
  const labels = ['Истина','Ложь'];
  const format = value => '<EditFormat><v8:item><v8:lang>ru</v8:lang><v8:content>'+value+'</v8:content></v8:item></EditFormat>';
  const russian = format('БИ=Истина; БЛ=Ложь');
  const blank = format('BT=; BF='), blankLabels = ['', ''];
  const largeFont = '<Font ref="sys:DefaultGUIFont" height="16" bold="true" kind="WindowsFont"/>';
  const paint = '<BackColor>web:LightGreen</BackColor><BorderColor>web:Blue</BorderColor><TextColor>web:Red</TextColor>';
  const box = {name:'auto',mode:'CheckBox',xml:'',frame:[92,69],glyph:[55,40,15,15],
    markSha256:'9b9c8570a995e299cfc3729a3cfc7640c72753bd3e5f9a35b4d7e8729d1c54bb'};
  const switcher = {name:'switch',mode:'Switcher',xml:paint,frame:[112,73],glyph:[55,40,34,20],
    markSha256:'96d763ca4b5e42d4b8b8e2a680a548fb4304159eedec2262edb206635d477653'};
  const variants = [
    box,
    {...box,name:'right',xml:'<TitleLocation>Right</TitleLocation>',frame:[88,69],glyph:[14,40,15,15]},
    {...box,name:'box-read-only',inactive:true,xml:'<ReadOnly>true</ReadOnly>',
      markSha256:'1b66a0f5b52fc8382694de9ea37e19bbfcf606d08133a10f2ac981306a8c1a4e'},
    {name:'tumbler',mode:'Tumbler',xml:russian,frame:[200,76],glyph:[54,39,125,24],labels},
    {name:'tumbler-right',mode:'Tumbler',xml:russian+'<TitleLocation>Right</TitleLocation>',frame:[196,76],glyph:[13,39,125,24],labels},
    {name:'unequal',mode:'Tumbler',xml:format('БИ=Вкл; БЛ=Выключено')+'<EqualItemsWidth>false</EqualItemsWidth><ItemWidth>12</ItemWidth>',
      frame:[206,76],glyph:[54,39,131,24],labels:['Вкл','Выключено']},
    {name:'manual',mode:'Tumbler',xml:format('BT=On; BF=Off')+'<ItemWidth>12</ItemWidth><ItemHeight>2</ItemHeight><ItemTitleHeight>2</ItemTitleHeight>',
      frame:[318,98],glyph:[54,39,243,46],labels:['On','Off']},
    {name:'paint',mode:'Tumbler',xml:russian+paint+largeFont,
      frame:[288,90],glyph:[54,39,213,38],labels},
    {name:'face-blank',mode:'Tumbler',noTitle:true,labels:blankLabels,xml:blank+'<ItemWidth>12</ItemWidth>',dimensions:[243,24],
      markSha256:'c169cf96e4f28cd69a89b3027f9773cfa002767aa21cb52d73bf068547042a4d'},
    {name:'face-narrow',mode:'Tumbler',noTitle:true,labels:blankLabels,xml:blank+'<ItemWidth>1</ItemWidth>',dimensions:[23,24],
      markSha256:'258506e5ea18e44cb699c273b2f02629fef4f4317f936a99d81000c4a0d88a30'},
    {name:'face-tall',mode:'Tumbler',noTitle:true,labels:blankLabels,xml:blank+'<ItemWidth>12</ItemWidth>'+'<ItemHeight>2</ItemHeight>',dimensions:[243,46],
      markSha256:'71aeedd26653d0c54bbc86b69439d8725f6f7245944e0778c01b5e466702eb1b'},
    {name:'face-large-font',mode:'Tumbler',noTitle:true,labels:blankLabels,xml:blank+'<ItemWidth>12</ItemWidth>'+largeFont,dimensions:[243,38],
      markSha256:'fec83fe7616637c926945ab8f3ac3867b1c2ab91be57bc0c7d72fc2f5845d44b'},
    {name:'face-colors',mode:'Tumbler',noTitle:true,labels:blankLabels,xml:blank+'<ItemWidth>12</ItemWidth>'+'<BackColor>#2266CC</BackColor><BorderColor>web:Red</BorderColor>',dimensions:[243,24],
      markSha256:'db2714d266bf323fdb2338a815665f5905d024dddf0e301481323de7d290f52b'},
    switcher,
    {...switcher,name:'switch-top',xml:'<TitleLocation>Top</TitleLocation>',frame:[71,92],glyph:[14,59,34,20]},
    {name:'box-black',mode:'CheckBox',background:true,xml:'',dimensions:[15,15],
      markSha256:'62b439d05b9c6a0540e74c586965c9071485f460a4b87f454ca49c70ad927774'},
    {name:'box-black-disabled',mode:'CheckBox',background:true,xml:'<Enabled>false</Enabled>',inactive:true,dimensions:[15,15],
      markSha256:'2370f0b69ba9b59e37112b37bd60bc206993a6cbe1aeb989c0a9736bcac69ab7'},
    {name:'switch-black',mode:'Switcher',background:true,xml:'',dimensions:[34,20],
      markSha256:'e4022d513f5a1e503ab6b4d7b062fccb2d1b5d9cffaac60e90497d5b0a975e96'},
    {name:'switch-black-disabled',mode:'Switcher',background:true,xml:'<Enabled>false</Enabled>',inactive:true,dimensions:[34,20],
      markSha256:'488a708d0681636abca8901377af360136b95600cef2a850c0203f0012dd0f9f'},
  ];
  const change = async (xml, target = document) => {
    const revision = view.snapshot.revision;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(target.uri,new vscode.Range(target.positionAt(0),target.positionAt(target.getText().length)),xml);
    assert.equal(await vscode.workspace.applyEdit(edit),true);
    await until(() => view.phase==='ready' && view.snapshot.revision!==revision,'dirty checkbox properties applied');
  };
  const apply = variant => {
    const token = variant.name==='auto' ? 'Auto' : variant.mode;
    const settings = '<CheckBoxType>'+token+'</CheckBoxType>'+variant.xml;
    const content = source.replace('<CheckBoxType>Auto</CheckBoxType>', settings+(variant.noTitle || variant.background ? '<TitleLocation>None</TitleLocation>' : ''));
    const canvas = '<UsualGroup name="Canvas" id="44"><Group>Vertical</Group><Representation>None</Representation>'
      +'<ShowTitle>false</ShowTitle><BackColor>web:Black</BackColor><ChildItems>'+content+'</ChildItems></UsualGroup>';
    return change(original.replace(field,variant.background?canvas:content));
  };
  const measure = `(() => {
    const frame = document.querySelector('.taxi-form-frame');
    const mark = frame?.querySelector('.taxi-checkbox,.taxi-checkbox-switch,.taxi-checkbox-tumbler');
    if (!mark) return null;
    const form = frame.getBoundingClientRect(), glyph = mark.getBoundingClientRect();
    const dimensions = getComputedStyle(frame), css = getComputedStyle(mark);
    const settled = Math.abs(form.width - parseFloat(dimensions.getPropertyValue('--taxi-form-preferred-width'))) <= .5
      && Math.abs(form.height - parseFloat(dimensions.getPropertyValue('--taxi-form-preferred-height'))) <= .5;
    const canvas = mark.querySelector('canvas:not([hidden])'), raster = canvas?.getContext('2d');
    let pixels = null;
    if (raster) {
      const data = raster.getImageData(0,0,canvas.width,canvas.height).data;
      let bytes = '';
      for (let index = 0; index < data.length; index += 8192) {
        bytes += String.fromCharCode(...data.subarray(index,index+8192));
      }
      pixels = btoa(bytes);
    }
    const track = mark.querySelector('.taxi-checkbox-switch-track');
    const sample = raster && mark.classList.contains('taxi-checkbox-switch') ? [...raster.getImageData(25,9,1,1).data].slice(0,3).join(', ') : null;
    const clipped = [...mark.querySelectorAll('.taxi-checkbox-choice > span')].some(label => label.scrollWidth>label.clientWidth);
    return {settled,frame:[form.width,form.height],glyph:[glyph.x-form.x,glyph.y-form.y,glyph.width,glyph.height],clipped,
      role:mark.getAttribute('role'),disabled:mark.getAttribute('aria-disabled'),
      labels:[...mark.querySelectorAll('[role=radio]')].map(node=>node.getAttribute('aria-label')),
      checked:mark.querySelectorAll('[aria-checked=true]').length,color:css.color,border:css.borderTopColor,
      track:sample ? 'rgb('+sample+')' : track ? getComputedStyle(track).fill : null,pixels};
  })()`;
  const observe = async (target, variant, nativeTarget) => {
    const role = {CheckBox:'checkbox',Tumbler:'radiogroup',Switcher:'switch'}[variant.mode];
    await target.evaluate('document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))');
    await until(async () => {
      const result = await target.evaluate(measure);
      return result?.settled && result.role===role && (process.platform!=='linux' || !variant.markSha256 || result.pixels);
    },'checkbox layout for '+variant.name);
    const {pixels,...result} = await target.evaluate(measure);
    assert.deepEqual(result.labels,variant.labels ?? [],variant.name);
    if (process.platform==='linux') assert.equal(result.clipped,false,variant.name+' captions fit');
    assert.equal(result.checked,0,variant.name);
    assert.equal(result.disabled,variant.inactive?'true':'false',variant.name);
    if (process.platform==='linux') {
      if (variant.frame) assert.deepEqual(result.frame,variant.frame,variant.name+' frame');
      if (variant.glyph) assert.deepEqual(result.glyph,variant.glyph,variant.name+' glyph');
      if (variant.dimensions) assert.deepEqual(result.glyph.slice(2),variant.dimensions,variant.name+' glyph dimensions');
    }
    if (variant.name==='paint') {
      assert.equal(result.color,'rgb(255, 0, 0)');
      assert.equal(result.border,'rgb(0, 0, 255)');
    }
    if (variant.mode==='Switcher') assert.equal(result.track,variant.inactive?'rgb(216, 216, 216)':'rgb(177, 177, 177)');
    const markSha256 = pixels ? createHash('sha256').update(Buffer.from(pixels,'base64')).digest('hex') : null;
    if (process.platform==='linux' && variant.markSha256) assert.equal(markSha256,variant.markSha256,variant.name+' native glyph');
    const screenshot = `renderer-checkbox-${variant.name}-${vscode.env.language}.png`;
    if (nativeTarget) await target.captureTarget(nativeTarget, screenshot);
    else await target.screenshot(screenshot);
    return {name:variant.name,...result,markSha256};
  };
  const results = [];
  for (const variant of variants) {
    await apply(variant);
    results.push(await observe(ui,variant));
  }
  const configuration = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(sourceRoot,'Configuration.xml')));
  const configurationXml = configuration.getText();
  const configurationDisk = await fs.readFile(configuration.uri.fsPath);
  const scripts = [
    ['Russian',{name:'script-russian',mode:'Tumbler',xml:'',frame:[200,76],glyph:[54,39,125,24],labels}],
    ['English',{name:'script-english',mode:'Tumbler',xml:'',frame:[178,76],glyph:[54,39,103,24],labels:['True','False']}],
  ];
  for (const [script,variant] of scripts) {
    const xml = configurationXml.replace(/<ScriptVariant>[^<]*<\/ScriptVariant>/,'')
      .replace('<Properties>','<Properties><ScriptVariant>'+script+'</ScriptVariant>');
    await change(xml,configuration);
    assert.equal(view.snapshot.model.scriptVariant,script.toLowerCase());
    await apply(variant);
    results.push(await observe(ui,variant));
  }
  await change(configurationXml,configuration);
  assert.deepEqual(await fs.readFile(configuration.uri.fsPath),configurationDisk);
  const mainWindow = await ui.nativeWindow();
  await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
  await until(() => view.frames.get('preview')?.ready,'detached checkbox preview ready');
  const preview = view.frames.get('preview');
  const floating = await frame({detached:true,fixedFormArea:true,state:{title:preview.panel.title}});
  const detachedWindow = await floating.nativeWindow({detached:true});
  assert.notEqual(detachedWindow.targetId,mainWindow.targetId);
  const inactive = {...switcher,name:'switch-detached-read-only',inactive:true,xml:'<ReadOnly>true</ReadOnly>',
    markSha256:'b50db8a4d3329ceacc6f86d1e147cf382ec9b69beeb58b0779ed7515a9a5272e'};
  await apply(inactive);
  results.push(await observe(floating,inactive,detachedWindow.targetId));
  const darkFace = {name:'face-dark-detached',mode:'Tumbler',noTitle:true,labels:blankLabels,background:true,xml:blank+'<ItemWidth>12</ItemWidth>',dimensions:[243,24],
      markSha256:'a90ea9871b650848a27eee81ab65afd011ad498ec41405d0576ac7f6bd385eb1'};
  await apply(darkFace);
  results.push(await observe(floating,darkFace,detachedWindow.targetId));
  await service.receive(view,preview,{type:'dock'});
  await until(() => !view.frames.has('preview'),'checkbox preview docked');
  await change(original);
  await until(() => ui.evaluate("!!document.querySelector('.taxi-checkbox')"),'original checkbox restored');
  return results;
}

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
    const control = document.querySelector('.taxi-radios');
    if (!frame || !control) return null;
    const form = frame.getBoundingClientRect(), css = getComputedStyle(frame);
    const settled = Math.abs(form.width - parseFloat(css.getPropertyValue('--taxi-form-preferred-width'))) <= .5
      && Math.abs(form.height - parseFloat(css.getPropertyValue('--taxi-form-preferred-height'))) <= .5;
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
    return result?.settled && result.captions.length === labels.length;
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
  await until(() => floating.evaluate("!!document.querySelector('.taxi-radios')"), 'initial choices rendered in the detached window');
  await floating.evaluate("globalThis.__radioChoices = document.querySelector('.taxi-radios'); true");
  await change(editOptions('<RadioButtonType>Tumbler</RadioButtonType><ColumnsCount>1</ColumnsCount><Enabled>false</Enabled>', ['Update  ', 'Skip']));
  await until(async () => {
    const result = await floating.evaluate(measure);
    return result?.settled && result.mode === 'segments';
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
  await until(async () => (await ui.evaluate(measure))?.settled, 'docked radio geometry settled');
  assert.deepEqual(await ui.evaluate(measure), segments);
  await change(original);
  await until(async () => (await ui.evaluate(measure))?.glyphs.length === 3, 'automatic sample restored');
}
