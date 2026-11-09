const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame, sameSourcePath } = require('./webview-host.cjs');

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
    await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,form.path) && view.phase === 'ready'), `open ${form.kind}`);
    const view = [...service.views.values()].find(view => sameSourcePath(view.path,form.path)), panel = view.frames.get('main');
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
    const radio = form.kind === 'RadioButtonField' ? await checkRadioChoices(ui, service, view, document) : undefined;
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
      await until(async () => await ui.evaluate("document.querySelector('.taxi-form-frame').getBoundingClientRect().height") === 314,'PDF layout after hiding view-status');
      await change(original);
      await until(async () => await ui.evaluate("document.querySelectorAll('.taxi-table-search-controls').length") === 1,'PDF view-status restored from dirty XML');
    }
    await ui.screenshot(`renderer-${form.kind}-${vscode.env.language}.png`);
    assert.deepEqual(await fs.readFile(form.path),before);
    results.push({kind:form.kind,...geometry,...(checkboxModes && {checkboxModes}),...(radio && {radioModes:radio.segments,radioCircleModes:radio.circles})}); panel.panel.dispose();
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
    {name:'tumbler',mode:'Tumbler',xml:russian,frame:[200,76],glyph:[54,39,125,24],labels,
      markSha256:'8e642348eb44e72fe915ad4e1eb202263ffe09ddef0212dcfe29086e559c63f6'},
    {name:'tumbler-right',mode:'Tumbler',xml:russian+'<TitleLocation>Right</TitleLocation>',frame:[196,76],glyph:[13,39,125,24],labels,
      markSha256:'8e642348eb44e72fe915ad4e1eb202263ffe09ddef0212dcfe29086e559c63f6'},
    {name:'unequal',mode:'Tumbler',xml:format('БИ=Вкл; БЛ=Выключено')+'<EqualItemsWidth>false</EqualItemsWidth><ItemWidth>12</ItemWidth>',
      frame:[206,76],glyph:[54,39,131,24],labels:['Вкл','Выключено'],
      markSha256:'6c8f5a4e6fb965d621050aa2020820236a45a2b6d65ebc5c3079984ee361f3ab'},
    {name:'manual',mode:'Tumbler',xml:format('BT=On; BF=Off')+'<ItemWidth>12</ItemWidth><ItemHeight>2</ItemHeight><ItemTitleHeight>2</ItemTitleHeight>',
      frame:[318,98],glyph:[54,39,243,46],labels:['On','Off'],
      markSha256:'c7c554fa06955018c53628fc888ba8c9842420e89642c1740b2dc5ef6af7f8e3'},
    {name:'paint',mode:'Tumbler',xml:russian+paint+largeFont,
      frame:[288,90],glyph:[54,39,213,38],labels,
      markSha256:'0b427cd914c2d3179723796f8b7c10c17a415c6dee148210bd24c0b18f806751'},
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
    {name:'caption-language',mode:'Tumbler',noTitle:true,xml:format('L=en_US'),
      dimensions:[81,24],labels:['Yes','No'],markSha256:'645a5657eb03f61c95643afae093c4b795320abd0238e1c53cf15c89558c07a0'},
    {name:'caption-leading',mode:'Tumbler',noTitle:true,xml:format('BT=" Yes; really "; BF=No'),
      dimensions:[167,24],labels:[' Yes; really','No'],markSha256:'4f589afd340f48b7d3820a5ea7f9ab038be22c93036b8f45e0b5364afa138f4b'},
    {name:'caption-ellipsis',mode:'Tumbler',noTitle:true,xml:russian+'<ItemWidth>3</ItemWidth>',
      dimensions:[63,24],labels:labels,markSha256:'a4a56b557aaeb828333a8e316288f8df8e56705e47d3fc6fc4d162f64eb684b1'},
    {name:'caption-wrap-clipped',mode:'Tumbler',noTitle:true,xml:format('BT=Very long short; BF=Two lines here')+'<ItemWidth>3</ItemWidth><ItemHeight>2</ItemHeight><ItemTitleHeight>2</ItemTitleHeight>',
      dimensions:[63,46],labels:["Very long short", "Two lines here"],markSha256:'effa90787b8c16ae8b280b1c70c7434ece1b6410498dec8fe066aa7ffc7f0f4c'},
    {name:'caption-wrap-auto',mode:'Tumbler',noTitle:true,xml:format('BT=Long custom single phrase; BF=Small')+'<ItemWidth>4</ItemWidth><ItemTitleHeight>3</ItemTitleHeight>',
      dimensions:[83,54],labels:["Long custom single phrase", "Small"],markSha256:'153bb6c03947561b63135a3408809bafc78e4095670ea1aebc396d14bbffdf31'},
    {name:'caption-newline',mode:'Tumbler',noTitle:true,xml:format('BT="One&#10;Two&#10;Three"; BF=Short')+'<ItemWidth>6</ItemWidth><ItemHeight>1</ItemHeight><ItemTitleHeight>1</ItemTitleHeight>',
      dimensions:[123,23],labels:["One\nTwo\nThree", "Short"],markSha256:'36167a5a9deaca04fe236f37319e977212596ed90271d997110d30a111f2accc'},
    {name:'caption-disabled-fill',mode:'Tumbler',noTitle:true,inactive:true,xml:format('BT=XXX; BF=ШШШ')+'<ItemWidth>6</ItemWidth><TextColor>web:Red</TextColor><BackColor>web:LightGreen</BackColor><Enabled>false</Enabled>',
      dimensions:[123,24],labels:["XXX", "ШШШ"],markSha256:'9ec769f7f7cd1e22627ceafc951c544fe428d1fd7d5e794929b0730e0d9cc5a9'},
    {name:'caption-read-only',mode:'Tumbler',noTitle:true,inactive:true,xml:russian+'<ItemWidth>12</ItemWidth><TextColor>web:Red</TextColor><ReadOnly>true</ReadOnly>',
      dimensions:[243,24],labels:labels,markSha256:'6a00f2663b682d09bd4f950f69e243099a02d8460133e23195c3a2d79b5b788e'},
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
    const role = target === document ? 'form' : 'metadata';
    const file = path.basename(target.uri.fsPath), version = target.isDirty ? String(target.version) : null;
    await until(() => view.phase === 'ready' && !view.running && !view.timer && view.snapshot.revision !== revision
      && view.snapshot.dependencies.some(input => input.role === role && path.basename(input.path.value) === file && input.version === version),
      'dirty checkbox properties applied for the edited XML version');
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
    return {settled,nativeCaption:mark.dataset.nativeTumblerCaptions==='ready',frame:[form.width,form.height],glyph:[glyph.x-form.x,glyph.y-form.y,glyph.width,glyph.height],clipped,
      role:mark.getAttribute('role'),disabled:mark.getAttribute('aria-disabled'),
      labels:[...mark.querySelectorAll('[role=radio]')].map(node=>node.getAttribute('aria-label')),
      checked:mark.querySelectorAll('[aria-checked=true]').length,color:css.color,border:css.borderTopColor,
      track:sample ? 'rgb('+sample+')' : track ? getComputedStyle(track).fill : null,pixels};
  })()`;
  const observe = async (target, variant, nativeTarget) => {
    const role = {CheckBox:'checkbox',Tumbler:'radiogroup',Switcher:'switch'}[variant.mode];
    const caption = variant.mode === 'Tumbler' && variant.labels?.some(Boolean);
    await until(() => target.evaluate(`globalThis.__eskaNativeFormRevision === ${JSON.stringify(view.snapshot.revision)}`),
      'checkbox model revision reached the preview');
    await target.evaluate('document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))');
    await until(async () => {
      const result = await target.evaluate(measure);
      return result?.settled && result.role===role && (process.platform!=='linux'
        || (!variant.markSha256 || result.pixels) && (!caption || result.nativeCaption));
    },'checkbox layout for '+variant.name);
    const {pixels,...result} = await target.evaluate(measure);
    assert.deepEqual(result.labels,variant.labels ?? [],variant.name);
    if (process.platform==='linux' && !caption) assert.equal(result.clipped,false,variant.name+' captions fit');
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
    ['Russian',{name:'script-russian',mode:'Tumbler',xml:'',frame:[200,76],glyph:[54,39,125,24],labels,
      markSha256:'8e642348eb44e72fe915ad4e1eb202263ffe09ddef0212dcfe29086e559c63f6'}],
    ['English',{name:'script-english',mode:'Tumbler',xml:'',frame:[178,76],glyph:[54,39,103,24],labels:['True','False'],
      markSha256:'78c66e63abbb9b542b72d1a9850f51ce9187ffc7261e3c4639b8edcb80ce507b'}],
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
  const darkCaption = {name:'caption-dark-detached',mode:'Tumbler',noTitle:true,background:true,xml:russian,
      dimensions:[125,24],labels:labels,markSha256:'caac14caaed911aa43f41ead62e105ec2224213d61ea82e1443dcddc8f170c42'};
  await apply(darkCaption);
  results.push(await observe(floating,darkCaption,detachedWindow.targetId));
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
  const editOptions = (properties, labels, backdrop) => {
    const xml = original.replace('<RadioButtonType>Auto</RadioButtonType>',
      properties + '<TitleLocation>None</TitleLocation>' + options(labels));
    if (!backdrop) return xml;
    const group = '<UsualGroup name="Canvas" id="44"><Group>Vertical</Group><Representation>None</Representation>'
      +'<ShowTitle>false</ShowTitle><BackColor>'+backdrop+'</BackColor><ChildItems>';
    return xml.replace('<ChildItems>','<ChildItems>'+group).replace('</ChildItems>','</ChildItems></UsualGroup></ChildItems>');
  };
  const measure = `(async () => {
    const frame = document.querySelector('.taxi-form-frame');
    const control = document.querySelector('.taxi-radios');
    if (!frame || !control) return null;
    const form = frame.getBoundingClientRect(), css = getComputedStyle(frame);
    const settled = Math.abs(form.width - parseFloat(css.getPropertyValue('--taxi-form-preferred-width'))) <= .5
      && Math.abs(form.height - parseFloat(css.getPropertyValue('--taxi-form-preferred-height'))) <= .5;
    const origin = control.getBoundingClientRect();
    const marks = [...control.querySelectorAll('.taxi-radio')];
    const glyphs = marks.map(glyph => {
      const box = glyph.getBoundingClientRect();
      return [box.x - origin.x, box.y - origin.y, box.width, box.height];
    });
    const options = [...control.querySelectorAll(':scope > [role=radio]')];
    const read = async canvas => {
      const ctx = canvas?.getContext('2d');
      if (!ctx) return null;
      const bytes = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
      return {size:[canvas.width,canvas.height],sha256:[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
    };
    const raster = await read(control.querySelector('.taxi-radio-segments-face:not([hidden])'));
    const circles = await Promise.all(marks.map(mark=>read(mark.querySelector('canvas:not([hidden])'))));
    const captionColors = options.map(option=>getComputedStyle(option.querySelector('.taxi-radio-caption')).color);
    const nativeCaptions = options.every(option=>!!option.querySelector('[data-native-label=ready]'));
    return { settled, size: [form.width, form.height], mode: control.dataset.representation, glyphs, raster, circles,
      captionColors, nativeCaptions, disabled: control.getAttribute('aria-disabled'), captions: options.map(option => option.getAttribute('aria-label')),
      checked: options.filter(option => option.getAttribute('aria-checked') === 'true').length };
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

  const style = '<BackColor>web:LightGreen</BackColor><BorderColor>web:Blue</BorderColor><TextColor>web:Red</TextColor>';
  const largeFont = '<Font ref="sys:DefaultGUIFont" height="16" bold="true" kind="WindowsFont"/>';
  const variants = [
    {name:'unequal',labels:["A", "A much longer option"],columns:2,
      raster:{size:[171,24],sha256:'bf011cabd0804cd5c880742980a8e94a1ce2966c4c156400f92342cbeac82973'}},
    {name:'grid',labels:["First", "Second long", "Third", "Fourth", "Fifth"],columns:3,
      raster:{size:[196,46],sha256:'37a7e0cfc223491ad818a32f1e4deb34273cdb85b1c94703478c2a5b8437be23'}},
    {name:'tall',labels:["First", "Second long", "Third", "Fourth", "Fifth", "Sixth", "Seventh"],columns:3,
      raster:{size:[208,69],sha256:'3aa517d55b9b189c11217736a43eae720bc37555a58254edb3f346e35ec451b6'}},
    {name:'bold',labels:["Да", "Широкий вариант", "Третья кнопка", "Четвёртая", "Пятая"],columns:2,extra:largeFont,
      raster:{size:[402,111],sha256:'22730c965f7593aa8a730950aba2e39ea0cb953239366aac3082b457b0e440be'}},
    {name:'style',labels:["Update", "Skip", "More"],columns:2,extra:style,
      raster:{size:[106,46],sha256:'7238b179d2abd86542cc3cf62e17df5e81da8663325675d29a1e22e5de10fafc'}},
    {name:'disabled',labels:["Update", "Skip", "More"],columns:2,inactive:true,extra:style+'<Enabled>false</Enabled>',
      raster:{size:[106,46],sha256:'d8f9922354257dd078948952ad6dffe2f21d245b5bcbadbe7b5f8767e64375ae'}},
  ];
  const observe = async (target, variant, nativeTarget) => {
    const settings = '<RadioButtonType>Tumbler</RadioButtonType><ColumnsCount>'+variant.columns+'</ColumnsCount>'+(variant.extra ?? '');
    await change(editOptions(settings,variant.labels,variant.backdrop));
    await target.evaluate('document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))');
    await until(async () => {
      const result = await target.evaluate(measure);
      return result?.settled && result.mode==='segments' && (process.platform!=='linux' || result.raster);
    },'radio tumbler layout for '+variant.name);
    const result = await target.evaluate(measure);
    assert.deepEqual(result.captions,variant.labels,variant.name);
    assert.equal(result.checked,0,variant.name);
    assert.equal(result.disabled,variant.inactive?'true':'false',variant.name);
    if (process.platform==='linux') assert.deepEqual(result.raster,variant.raster,variant.name);
    const screenshot = `renderer-radio-tumbler-${variant.name}-${vscode.env.language}.png`;
    if (nativeTarget) await target.captureTarget(nativeTarget,screenshot);
    else await target.screenshot(screenshot);
    return {name:variant.name,...result};
  };
  const results = [];
  for (const variant of variants) results.push(await observe(ui,variant));
  const circleResults = [];
  const observeCircles = async (target, variant, nativeTarget) => {
    const labels = variant.labels ?? ['Update','Skip'];
    const columns = variant.columns ? '<ColumnsCount>'+variant.columns+'</ColumnsCount>' : '';
    await change(editOptions('<RadioButtonType>RadioButtons</RadioButtonType>'+columns+(variant.extra ?? ''),labels,variant.backdrop));
    await target.evaluate('document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))))');
    await until(async () => {
      const result = await target.evaluate(measure);
      return result?.settled && result.mode==='buttons' && result.glyphs.length===2
        && (process.platform!=='linux' || result.circles.every(Boolean) && result.nativeCaptions
          && (!variant.color || result.captionColors.every(color=>color===variant.color)));
    },'radio circles for '+variant.name);
    const result = await target.evaluate(measure);
    assert.deepEqual(result.captions,labels,variant.name);
    assert.equal(result.checked,1,variant.name);
    assert.equal(result.disabled,variant.inactive?'true':'false',variant.name);
    if (process.platform==='linux') assert.deepEqual(result.circles,variant.sha256.map(sha256=>({size:[15,15],sha256})),variant.name);
    const screenshot = `renderer-radio-circles-${variant.name}-${vscode.env.language}.png`;
    if (nativeTarget) await target.captureTarget(nativeTarget,screenshot);
    else await target.screenshot(screenshot);
    circleResults.push({name:variant.name,...result});
  };
  const circleCases = [
    {name:'white',sha256:["3743ea24120bc04b11630fabc1458119a8759ef589e5ce53ac4e662f3113d07e", "01511f7e1ef69ea6ab67d100c894b2238c41dbfc2b0adca63c094f4280eecfdf"]},
    {name:'black',backdrop:'web:Black',sha256:["9d9f5b730562fe6407cd43c914aa0475b6ccc81a889e3d81b7907d8508147713", "14735fb5dc4632a7aad8de5152eb10a47e48d60e472a02d6b5992113de06304a"]},
    {name:'blue-parent',backdrop:'#2266CC',sha256:["da2e7060787e453218ef569de34b8286c3a2f50ffeda4b39a720da701ae91633", "cf617e35974a4d59b564b3bd9db77e831dfa17cb9eea3adcfc56ddbb63a6ad9e"]},
    {name:'disabled-white',color:'rgb(166, 166, 166)',extra:'<Enabled>false</Enabled>',inactive:true,sha256:["5e386c042b8c28a8aeb98951931abd56c444f89587126557a5123cd426fe03c9", "6c710aae1722905e05c597c7f8bfa67d64d366ecbbcc099ab13914f2a8f99e96"]},
    {name:'disabled-blue',backdrop:'#2266CC',extra:'<Enabled>false</Enabled>',inactive:true,
      color:'rgb(154, 154, 154)',sha256:["0a5593a7e054b0ff0a40f11857ea2c467bc8f5655f15fce4a3278e4d801f8c50", "40adcf8527d1f21f63fbed48d4e9d5217470a95d9bb5fd15e8521ae67e26651e"]},
    {name:'disabled-paint-blue',backdrop:'#2266CC',extra:'<Enabled>false</Enabled><TextColor>web:Red</TextColor>',inactive:true,
      color:'rgb(243, 71, 71)',sha256:["0a5593a7e054b0ff0a40f11857ea2c467bc8f5655f15fce4a3278e4d801f8c50", "40adcf8527d1f21f63fbed48d4e9d5217470a95d9bb5fd15e8521ae67e26651e"]},
    {name:'paint',extra:style,sha256:["3743ea24120bc04b11630fabc1458119a8759ef589e5ce53ac4e662f3113d07e", "01511f7e1ef69ea6ab67d100c894b2238c41dbfc2b0adca63c094f4280eecfdf"]},
    {name:'bold',extra:largeFont+'<TextColor>web:Blue</TextColor>',columns:1,labels:['Обновлять','Пропускать'],sha256:["3743ea24120bc04b11630fabc1458119a8759ef589e5ce53ac4e662f3113d07e", "01511f7e1ef69ea6ab67d100c894b2238c41dbfc2b0adca63c094f4280eecfdf"]},
  ];
  for (const variant of circleCases) await observeCircles(ui,variant);
  await change(editOptions('<RadioButtonType>RadioButtons</RadioButtonType><ColumnsCount>3</ColumnsCount>', labels));
  await until(async () => (await ui.evaluate(measure))?.mode==='buttons','radio buttons restored before detaching');
  const workbench = await ui.nativeWindow();
  await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
  await until(() => view.frames.get('preview')?.ready, 'detached radio preview ready');
  const detached = view.frames.get('preview');
  const floating = await frame({ detached: true, fixedFormArea: true, state: { title: detached.panel.title } });
  const detachedWindow = await floating.nativeWindow({ detached: true });
  assert.notEqual(detachedWindow.targetId, workbench.targetId);
  await until(() => floating.evaluate("!!document.querySelector('.taxi-radios')"), 'initial choices rendered in the detached window');
  await floating.evaluate("globalThis.__radioChoices = document.querySelector('.taxi-radios'); true");
  await change(editOptions('<RadioButtonType>Tumbler</RadioButtonType><ColumnsCount>1</ColumnsCount><Enabled>false</Enabled>', ['Update  ', 'Skip']));
  await until(async () => {
    const result = await floating.evaluate(measure);
    return result?.settled && result.mode === 'segments' && (process.platform!=='linux' || result.raster);
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
  await until(async () => {
    const result = await ui.evaluate(measure);
    return result?.settled && result.mode==='segments' && (process.platform!=='linux' || result.raster);
  }, 'docked radio geometry settled');
  assert.deepEqual(await ui.evaluate(measure), segments);
  await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
  await until(() => view.frames.get('preview')?.ready, 'radio raster detached again');
  const finalFrame = view.frames.get('preview');
  const finalUi = await frame({ detached:true,fixedFormArea:true,state:{title:finalFrame.panel.title} });
  const finalWindow = await finalUi.nativeWindow({detached:true});
  assert.notEqual(finalWindow.targetId,workbench.targetId);
  const readOnly = {name:'read-only-detached',labels:["Update", "Skip", "More"],columns:2,inactive:true,extra:style+'<ReadOnly>true</ReadOnly>',
      raster:{size:[106,46],sha256:'d8f9922354257dd078948952ad6dffe2f21d245b5bcbadbe7b5f8767e64375ae'}};
  const dark = {name:'dark-detached',labels:["First", "Second long", "Third", "Fourth", "Fifth", "Sixth", "Seventh"],columns:3,backdrop:'web:Black',
      raster:{size:[208,69],sha256:'9b6e19e73467cf3a8d608856402a620f10afc669c831a78607fa839cda070b81'}};
  results.push(await observe(finalUi,readOnly,finalWindow.targetId));
  results.push(await observe(finalUi,dark,finalWindow.targetId));
  await observeCircles(finalUi,{name:'disabled-black-detached',color:'rgb(103, 103, 103)',backdrop:'web:Black',extra:'<Enabled>false</Enabled>',inactive:true,sha256:["9f8ad32a9f1760b7631476c86f2a06a5a5870fd73ec829c19d8e220d623f13d5", "ce076d7dde79a435be421a068301555f933a155b96d95784a15d79d4b1ae00ee"]},finalWindow.targetId);
  await observeCircles(finalUi,{name:'read-only-detached',color:'rgb(166, 166, 166)',extra:'<ReadOnly>true</ReadOnly>',inactive:true,sha256:["5e386c042b8c28a8aeb98951931abd56c444f89587126557a5123cd426fe03c9", "6c710aae1722905e05c597c7f8bfa67d64d366ecbbcc099ab13914f2a8f99e96"]},finalWindow.targetId);
  await service.receive(view,finalFrame,{type:'dock'});
  await until(() => !view.frames.has('preview'),'radio raster docked');
  await change(original);
  await until(async () => (await ui.evaluate(measure))?.glyphs.length === 3, 'automatic sample restored');
  return {segments:results,circles:circleResults};
}
