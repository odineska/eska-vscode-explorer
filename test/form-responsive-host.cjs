const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const vscode = require('vscode');
const { until, frame, allocateFormViewport, editFormSource } = require('./webview-host.cjs');

const geometry = `(() => {
  const frame=document.querySelector('.taxi-form-frame'),css=getComputedStyle(frame),frameWidth=parseFloat(css.width)+(css.boxSizing==='content-box'?parseFloat(css.borderLeftWidth)+parseFloat(css.borderRightWidth):0),scale=frame.getBoundingClientRect().width/frameWidth;
  const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect(),z=scale;return {x:r.x/z,y:r.y/z,width:r.width/z,height:r.height/z,right:r.right/z,bottom:r.bottom/z}};
  const fixedGroup=[...document.querySelectorAll('.taxi-group-title')].find(node=>node.textContent==='Fixed group')?.closest('.taxi-element');
  const input=name=>document.querySelector('.taxi-input input[aria-label="'+name+'"]')?.closest('.taxi-input');
  const surface=document.querySelector('.taxi-special[data-native-field=ChartField]'),svg=surface?.querySelector('svg.taxi-chart'),canvas=surface?.querySelector('canvas');
  const viewport=document.querySelector('.preview-scroll'),body=frame.querySelector('.taxi-form-content');
  const innerScroll=frame.hasAttribute('data-native-form-scroll') && body.scrollHeight>body.clientHeight;
  const contentBottom=innerScroll?rect(body).y+body.scrollHeight-body.scrollTop:rect(frame).bottom;
  return {viewport:{width:viewport.clientWidth,height:viewport.clientHeight},frame:rect(frame),contentBottom,fixedGroup:rect(fixedGroup),code:rect(input('Code')),amount:rect(input('Amount')),name:rect(input('Name')),limited:rect(input('Limited')),memo:rect(document.querySelector('textarea[aria-label=Memo]')?.closest('.taxi-input')),
    table:rect(document.querySelector('.taxi-table-field')),grid:rect(document.querySelector('.taxi-table-scroll')),columns:{width:document.querySelector('.taxi-table-content').clientWidth,scrollWidth:document.querySelector('.taxi-table-content').scrollWidth},fixedTable:rect(document.querySelector('.taxi-element[data-kind=Table][data-stretch-x=false] > .taxi-table-field')),chart:rect(surface),
    chartVisible:!!surface&&getComputedStyle(surface).visibility==='visible',
    chartDrawing:svg?{width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height}:canvas&&getComputedStyle(canvas).display!=='none'?{width:canvas.width,height:canvas.height}:null,
    headerDirection:getComputedStyle(document.querySelector('.taxi-items[data-grouping=HorizontalIfPossible]')).display,
    selected:document.querySelector('.taxi-element.taxi-selected')?.dataset.element,
    page:document.querySelector('.taxi-tabs [aria-selected=true]')?.textContent,collapsed:document.querySelector('.taxi-group-title button')?.getAttribute('aria-expanded')==='false',
    close:rect([...document.querySelectorAll('.taxi-button')].find(button=>button.textContent==='Close')),
    scroll:{x:viewport.scrollWidth>viewport.clientWidth,y:viewport.scrollHeight>viewport.clientHeight,innerY:innerScroll},zoom:document.querySelector('.form-zoom select').value,
    sameNodes:!globalThis.__resizeNodes||__resizeNodes.every(node=>node.isConnected),liveObservers:globalThis.__resizeLive?.size??0,errors:globalThis.__resizeErrors??[]};
})()`;
async function observeResize(ui) {
  await ui.evaluate(`globalThis.__resizeLive=new Set();const OriginalResizeObserver=window.ResizeObserver;window.ResizeObserver=class extends OriginalResizeObserver{constructor(callback){super(callback);__resizeLive.add(this)}disconnect(){__resizeLive.delete(this);super.disconnect()}};
    globalThis.__resizeErrors=[];window.addEventListener('error',event=>__resizeErrors.push(event.message));window.addEventListener('unhandledrejection',event=>__resizeErrors.push(String(event.reason)));true`);
}
const chartFits = ({chart, chartDrawing}) => chart && chartDrawing
  && Math.abs(chartDrawing.width - (chart.width - 2)) < .1
  && Math.abs(chartDrawing.height - (chart.height - 2)) < .1;

async function settled(ui) {
  let previous;
  await until(async () => {
    await ui.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const current = await ui.evaluate(geometry);
    const stable = (!current.chartVisible || chartFits(current)) && isDeepStrictEqual(current, previous);
    previous = current;
    return stable;
  }, 'resize reaches a stable geometry with the current chart drawing');
  return previous;
}
function check(sample, baseline, label) {
  assert.equal(sample.sameNodes, true, label+' keeps element owners');
  assert.deepEqual(sample.errors, [], label+' has no observer/render errors');
  assert.ok(Math.abs(sample.code.width-baseline.code.width)<.1, label+' keeps fixed string width');
  assert.ok(Math.abs(sample.amount.width-baseline.amount.width)<.1, label+' keeps fixed number width');
  assert.equal(sample.page, baseline.page); assert.equal(sample.selected, baseline.selected); assert.equal(sample.collapsed, true);
  assert.ok(Math.abs(sample.fixedTable.width-baseline.fixedTable.width)<.01,label+' keeps the non-stretch table width');
  assert.ok(sample.grid.height>0 && sample.chart.height>0);
  // Linux manual MaxWidth=25 includes the 10px allocation measured in native-text-inputs.
  const limitedMaximum = process.platform === 'linux' ? 260 : 250;
  assert.ok(sample.limited.width>=79.9&&sample.limited.width<=limitedMaximum+.1,label+' applies horizontal bounds');
  const memoMinimum = process.platform === 'linux' ? 51 : 40;
  assert.ok(sample.memo.height>=memoMinimum-.1&&sample.memo.height<=160.1,label+' applies vertical bounds');
  assert.ok(Math.abs(sample.close.height-baseline.close.height)<.001,label+' keeps fixed button height');
  const [groupWidth, groupHeight] = process.platform === 'linux' ? [350, 50] : [280, 60];
  assert.ok(Math.abs(sample.fixedGroup.width-groupWidth)<.01 && Math.abs(sample.fixedGroup.height-baseline.fixedGroup.height)<.01,label+' retains explicit non-stretch group dimensions');
  assert.ok(Math.abs(sample.fixedGroup.height-groupHeight)<.01,label+' retains the authored group height in its rendering profile');

  assert.ok(sample.table.right <= sample.chart.x + .5, label+' keeps table and chart separate');
  assert.ok(sample.close.bottom <= sample.contentBottom + .5, label+' keeps the last button in the scrollable form');
  assert.ok(chartFits(sample), label+' redraws the chart at its allocated size');
}
async function cssCycle(ui, service, view, label) {
  const snapshot=view.snapshot, session=view.client.current.formSessionId;
  const sourceVersion=view.client.current.dependencies.map(row=>row.version), messages=[], receive=service.receive;
  const connection=view.client.connection, requests=[], request=connection.request;
  connection.request=function(...args){if(args[1].startsWith('form/'))requests.push(args[1]);return request.apply(this,args);};
  service.receive=function(...args){messages.push(args[2]?.type);return receive.apply(this,args);};
  await ui.evaluate(`globalThis.__resizeStyle=document.querySelector('#root').style.cssText;
    globalThis.__resizeNodes=[...document.querySelectorAll('.taxi-form-frame,.taxi-element,.taxi-tabs button,.taxi-special,.taxi-table-header-cell')];true`);
  const baseline=await settled(ui), samples=[];
  try {
    for (const [width,height] of [[360,240],[640,360],[1000,680],[640,360]]) {
      await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
      const sample=await settled(ui);samples.push({label:`${label}-${width}-${height}`,width,height,...sample});
      if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,'responsive-progress.json'),JSON.stringify({baseline,samples}));
      await ui.screenshot(`responsive-${label}-${width}-${height}-${vscode.env.language}.png`);check(sample,baseline,label);
    }
  } finally {
    await ui.evaluate(`document.querySelector('#root').style.cssText=__resizeStyle;true`);
    await settled(ui);service.receive=receive;connection.request=request;
  }
  assert.equal(samples[0].headerDirection,'grid','HorizontalIfPossible becomes vertical below preferred widths');
  assert.equal(samples[2].headerDirection,'flex','HorizontalIfPossible returns to horizontal when it fits');
  const nativeScroll = process.platform === 'linux';
  assert.deepEqual(samples[0].scroll, {x:true,y:!nativeScroll,innerY:nativeScroll}, 'compact forms retain access on both axes');
  assert.ok(samples.at(-1).liveObservers<=samples[0].liveObservers,'repeated resize does not accumulate observers');
  const returned=await settled(ui);check(returned,baseline,label+' return');
  if(process.env.ESKA_SCREENSHOT_DIR)await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR,'responsive-return.json'),JSON.stringify({label,baseline,returned}));
  assert.ok(Math.abs(returned.frame.width-baseline.frame.width)<.1 && Math.abs(returned.frame.height-baseline.frame.height)<.1,'original form allocation returns');
  assert.equal(view.snapshot,snapshot);assert.equal(view.client.current.formSessionId,session);
  assert.deepEqual(view.client.current.dependencies.map(row=>row.version),sourceVersion);
  assert.deepEqual(messages,[],'resize alone sends no action to the host');
  assert.deepEqual(requests,[],'resize makes no form RPC request');
  return samples;
}
async function nativeCycle(ui, label) {
  const target=await ui.nativeWindow({detached:label==='detached'}), original=await ui.windowBounds(target.targetId), samples=[];
  const baseline=await settled(ui);
  try {
    for(const [width,height] of [[900,600],[1440,900],[1100,700]]) {
      await ui.resizeWindow(original.windowId,{width,height,windowState:'normal'});
      await until(async()=>{const now=await ui.windowBounds(target.targetId);return now.bounds.width===width&&now.bounds.height===height;},'native resize applied');
      const sample=await settled(ui);check(sample,baseline,label+' native');samples.push({label:`${label}-native-${width}-${height}`,window:{width,height},...sample});
    }
  } finally {
    await ui.resizeWindow(original.windowId,original.bounds);
    await until(async()=>{const now=await ui.windowBounds(target.targetId);return now.bounds.width===original.bounds.width&&now.bounds.height===original.bounds.height;},'original native size restored');
  }
  assert.ok(new Set(samples.map(sample=>Math.round(sample.grid.height))).size>1,'table vertical allocation follows native window height');
  const returned=await settled(ui);check(returned,baseline,label+' native return');
  assert.ok(Math.abs(returned.frame.width-baseline.frame.width)<.1 && Math.abs(returned.frame.height-baseline.frame.height)<.1);
  return samples;
}
function sourceTitle(value) { return `<v8:content>${value}</v8:content>`; }
async function replace(document, from, to, expectedCount = 2) {
  const text=document.getText(),edit=new vscode.WorkspaceEdit();let offset=text.indexOf(from),count=0;
  while(offset>=0) {
    edit.replace(document.uri,new vscode.Range(document.positionAt(offset),document.positionAt(offset+from.length)),to);
    count++;offset=text.indexOf(from,offset+from.length);
  }
  assert.equal(count, expectedCount, 'expected XML values found independently of surrounding whitespace');
  assert.equal(await vscode.workspace.applyEdit(edit),true);
}

async function checkCappedHeader(ui, document) {
  const fixed = '<Width>35</Width>\n        </InputField>';
  const capped = '<AutoMaxWidth>false</AutoMaxWidth><MaxWidth>14</MaxWidth>\n        </InputField>';
  await replace(document, fixed, capped, 1);
  let gap;
  for (const width of [1000, 1250]) {
    await ui.evaluate(`document.querySelector('#root').style.width = '${width}px';true`);
    await until(async () => {
      const sample = await ui.evaluate(geometry);
      return sample?.name?.width === 151 && sample.headerDirection === 'flex';
    }, 'the capped field keeps its native width in a horizontal row');
    const sample = await settled(ui);
    const next = sample.amount.x - sample.name.right;
    assert.ok(next >= 0 && next < 80, 'the second field follows the cap and its own caption');
    assert.equal(sample.amount.y, sample.name.y);
    const preferred = await ui.evaluate(`(() => {
      const field = document.querySelector('input[aria-label=Name]').closest('[data-horizontal-input-limit]');
      const width = parseFloat(field.style.getPropertyValue('--taxi-preferred-width'));
      const caption = parseFloat(field.style.getPropertyValue('--taxi-horizontal-input-reserve'));
      return width - caption;
    })()`);
    assert.equal(preferred, sample.name.width, 'the preferred row reserves the capped input width');
    if (gap !== undefined) assert.equal(next, gap, 'spare row width stays after the capped fields');
    gap = next;
  }
  await replace(document, capped, fixed, 1);
}

async function checkTallHeader(ui, document, view) {
  const source = document.getText();
  const group = '<Group>HorizontalIfPossible</Group>';
  const field = '<InputField name="Name" id="2">';
  const tall = source.replace(group, group + '<Height>6</Height><VerticalStretch>false</VerticalStretch>')
    .replace(field, field + '<MultiLine>true</MultiLine>');
  assert.ok(source.includes(group) && source.includes(field));
  const amount = '<InputField name="Amount" id="3">';
  assert.ok(tall.includes(amount));
  async function measured(xml) {
    await editFormSource(document, view, xml);
    await ui.rendered();
    await ui.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    return ui.evaluate(`(() => {
      const control = document.querySelector('textarea[aria-label=Name]').closest('.taxi-input');
      const row = control.closest('.taxi-field-row');
      const parent = row.closest('.taxi-element').parentElement;
      const header = parent.getBoundingClientRect();
      const sibling = document.querySelector('input[aria-label=Amount]').closest('.taxi-element').getBoundingClientRect();
      return { title: row.dataset.titleLocation, direction: getComputedStyle(parent).display,
        input: control.getBoundingClientRect().height, height: header.height,
        offset: sibling.y - header.y, spare: header.height - sibling.height };
    })()`);
  }
  try {
    const result = await measured(tall);
    assert.equal(result.title, 'Top');
    assert.equal(result.direction, 'flex');
    assert.ok(result.height >= 96);
    assert.equal(result.input, result.height - 21, 'automatic multiline input fills the height left by its caption');
    for (const [alignment, fraction] of [['Top', 0], ['Center', .5], ['Bottom', 1]]) {
      const xml = tall.replace(amount, amount + '<GroupVerticalAlign>' + alignment + '</GroupVerticalAlign>')
        .replace(field, field + '<GroupVerticalAlign>Bottom</GroupVerticalAlign>');
      const {offset, spare, input, height} = await measured(xml);
      assert.ok(spare > 40, 'the row has space for vertical alignment');
      assert.ok(Math.abs(offset - fraction * spare) < .01, alignment + ' aligns the field in the horizontal row');
      assert.equal(input, height - 21, 'alignment keeps the stretched field at its allocated height');
    }
  } finally {
    await editFormSource(document, view, source);
  }
}

async function checkCompactTable(ui, document, view) {
  const source = document.getText(), table = '<Table name="FixedRows" id="28">';
  assert.ok(source.includes(table));
  const viewportStyle = await ui.evaluate("document.querySelector('.preview-scroll').style.cssText");
  const grid = 'document.querySelector(\'.taxi-element[data-element$=":current:28"] .taxi-table-scroll\')';
  await ui.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.taxi-tabs button')].find(button => button.textContent === 'Fixed table');
    tab.click();
    globalThis.__compactGrid = ${grid};
  })()`);
  const read = async expected => {
    let sample;
    await until(async () => {
      sample = await ui.evaluate(`(() => {
        const frame = document.querySelector('.taxi-form-frame'), body = frame.querySelector('.taxi-form-content');
        const viewport = frame.closest('.preview-scroll'), title = frame.querySelector('.taxi-form-title');
        const last = [...frame.querySelectorAll('.taxi-button')].find(button => button.textContent === 'Close');
        const grid = ${grid}, box = grid.getBoundingClientRect();
        const group = frame.querySelector('[data-element$=":current:200"]');
        const memo = group?.querySelector('.taxi-input textarea')?.closest('.taxi-input');
        return { height: box.height, width: box.width, frame: frame.getBoundingClientRect().height,
          groupHeight: group?.getBoundingClientRect().height, memoHeight: memo?.getBoundingClientRect().height,
          title: title.getBoundingClientRect().y, offset: body.scrollTop, scrolls: body.scrollHeight > body.clientHeight,
          outerScrolls: viewport.scrollHeight > viewport.clientHeight, sameGrid: grid === __compactGrid,
          lastVisible: last.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom };
      })()`);
      const matches = typeof expected === 'function' ? expected(sample) : sample.height === expected;
      return matches && sample.frame === 240 && sample.scrolls;
    }, 'compact table height and frame settled');
    return sample;
  };
  const scroll = offset => ui.evaluate(`(() => {
    const body = document.querySelector('.taxi-form-content');
    body.scrollTop = ${offset};
    return body.scrollTop;
  })()`);
  await allocateFormViewport(ui, [850, 240]);
  try {
    const compact = await read(227);
    assert.equal(compact.outerScrolls, false, 'the preview fits the compact frame');
    assert.equal(compact.sameGrid, true);
    assert.ok(await scroll(1e6) > 0);
    const end = await read(227);
    assert.equal(end.title, compact.title, 'scroll keeps the form caption in place');
    assert.equal(end.lastVisible, true, 'the last control is reachable');
    const offset = await scroll(40);
    assert.equal(offset, 40);
    const resized = source.replace(table, table + '<Height>12</Height><HeightInTableRows>9</HeightInTableRows>');
    await editFormSource(document, view, resized);
    const dirty = await read(283);
    assert.equal(dirty.width, compact.width, 'vertical allocation preserves the grid width');
    assert.equal(dirty.offset, offset, 'a dirty geometry edit preserves the inner scroll');
    assert.equal(dirty.sameGrid, true, 'a dirty geometry edit keeps the grid owner');
    await editFormSource(document, view, source);
    const restored = await read(227);
    assert.equal(restored.offset, offset);
    assert.equal(restored.sameGrid, true);
    const bounded = source.replace(/(<Table name="FixedRows" id="28">[\s\S]*?<\/Table>)/u,
      '<UsualGroup name="DeclaredHeight" id="200"><Height>8</Height><Group>Vertical</Group><VerticalStretch>false</VerticalStretch><ChildItems>' +
      '$1<InputField name="MemoInGroup" id="201"><DataPath>Name</DataPath><TitleLocation>None</TitleLocation><MultiLine>true</MultiLine></InputField>' +
      '</ChildItems></UsualGroup>');
    assert.notEqual(bounded, source);
    await editFormSource(document, view, bounded);
    const limited = await read(sample => sample.groupHeight === 174 && sample.height === 117 && sample.memoHeight === 23);
    await ui.evaluate(`globalThis.__compactGrid=${grid};true`);
    await editFormSource(document, view, bounded.replace('id="200"><Height>8', 'id="200"><Height>12'));
    const shared = await read(sample => sample.groupHeight === 194 && sample.height + sample.memoHeight === 160);
    assert.ok(Math.abs(shared.height-130)<=3 && Math.abs(shared.memoHeight-30)<=3, 'controls share the group height');
    assert.equal(shared.sameGrid,true);
    return { compact, end, dirty, restored, limited, shared };
  } finally {
    await editFormSource(document, view, source);
    await ui.evaluate(`document.querySelector('.preview-scroll').style.cssText=${JSON.stringify(viewportStyle)};true`);
  }
}

exports.run=async function(){
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE), form=fixture.formGallery[0], original=await fs.readFile(form.path);
  const explorer=await vscode.extensions.all.find(extension=>extension.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));await vscode.window.showTextDocument(document,{preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>service.views.size===1&&[...service.views.values()][0].phase==='ready','responsive form opened');
  const view=[...service.views.values()][0],main=view.frames.get('main');let ui=await frame({state:{title:main.panel.title}});
  try { await until(async()=>await ui.evaluate("document.querySelector('.taxi-preview')?.dataset.formLayout==='allocated'&&!!document.querySelector('.taxi-chart')"),'responsive DOM ready'); }
  catch(error){error.message+=' '+JSON.stringify(await ui.evaluate("({mode:document.querySelector('.taxi-preview')?.dataset.formLayout,kinds:[...document.querySelectorAll('[data-kind]')].map(n=>n.dataset.kind),html:document.querySelector('.taxi-form-content')?.innerHTML.slice(-3000)})"));throw error;}
  await ui.evaluate('document.fonts.ready.then(()=>true)');
  // Overflow is a test condition, so establish it independently of the display/workbench size.
  const initialTarget = await ui.nativeWindow(), initialWindow = await ui.windowBounds(initialTarget.targetId);
  await ui.resizeWindow(initialWindow.windowId, {width:1200,height:900,windowState:'normal'});
  await until(async () => {
    const {bounds} = await ui.windowBounds(initialTarget.targetId);
    return bounds.width===1200 && bounds.height===900;
  }, 'initial responsive window allocation');
  if (process.platform === 'win32') {
    // Keep the conditional row wider than the Windows table minimum so both arrangements are exercised.
    const revision = view.snapshot.revision;
    await replace(document, '<Width>35</Width>\n        </InputField>', '<Width>60</Width>\n        </InputField>', 1);
    await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer, 'Windows conditional row fixture ready');
    await settled(ui);
  }
  await observeResize(ui);
  await ui.evaluate(`document.querySelector('.taxi-group-title button').click();document.querySelector('.taxi-input input[aria-label=Code]').click();true`);
  await until(()=>view.selected?.key?.value==='5','selected field retained by host');
  const weighted=await settled(ui);assert.ok(Math.abs(weighted.table.width-2*weighted.chart.width)<.1,'horizontal XML weights allocate 2:1 above minima');
  assert.ok(weighted.columns.scrollWidth>weighted.columns.width,'wide columns scroll inside their allocated table');
  const results=[...await cssCycle(ui,service,view,'main')];
  // Keep native windows within the display's work area; use the real splitter to expose tall form allocation.
  await ui.evaluate(`for(let i=0;i<14;i++)document.querySelector('.form-shell > .form-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));true`);
  results.push(...await nativeCycle(ui,'main'));
  await ui.evaluate(`for(let i=0;i<14;i++)document.querySelector('.form-shell > .form-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);
  // The actual splitter changes only the main preview's vertical allocation.
  const beforeSplitter=await settled(ui);
  await ui.evaluate(`const separator=document.querySelector('.form-shell > .form-splitter');separator.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));true`);
  const afterSplitter=await settled(ui);assert.ok(afterSplitter.viewport.height<beforeSplitter.viewport.height);check(afterSplitter,beforeSplitter,'inspector splitter');
  results.push({label:'splitter',...afterSplitter});
  await ui.evaluate(`document.querySelector('.form-shell > .form-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));true`);
  await ui.evaluate(`document.querySelector('.form-zoom select').value='125';document.querySelector('.form-zoom select').dispatchEvent(new Event('change',{bubbles:true}));true`);
  results.push(...await cssCycle(ui,service,view,'zoom125'));
  assert.equal((await settled(ui)).zoom,'125','resize keeps the user zoom');
  await ui.evaluate(`document.querySelector('.form-zoom select').value='100';document.querySelector('.form-zoom select').dispatchEvent(new Event('change',{bubbles:true}));true`);
  await replace(document,sourceTitle('Name'),sourceTitle('Name changed'));
  await until(()=>JSON.stringify(view.snapshot.model).includes('Name changed'),'dirty XML rendered');
  await until(async()=>await ui.evaluate("[...document.querySelectorAll('.taxi-field-label')].some(label=>label.textContent==='Name changed:')"),'dirty caption actually displayed');
  results.push(...await cssCycle(ui,service,view,'dirty'));
  await replace(document,sourceTitle('Name changed'),sourceTitle('Name'));
  await until(()=>!JSON.stringify(view.snapshot.model).includes('Name changed'),'dirty XML returned');
  for(const [direction,changed] of [['undo',true],['redo',false]]) {
    await ui.focusWorkbench();
    if(process.env.ESKA_HOST_FOCUS_HELPER){const bounds=await ui.workbench('({width:window.outerWidth,height:window.outerHeight})');require('node:child_process').execFileSync('python3',[process.env.ESKA_HOST_FOCUS_HELPER,process.env.VSCODE_PID,String(bounds.width),String(bounds.height)]);}
    await vscode.window.showTextDocument(document,{preview:false,viewColumn:vscode.ViewColumn.One});
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath,form.path);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await vscode.commands.executeCommand(direction);await until(()=>view.phase==='ready'&&JSON.stringify(view.snapshot.model).includes('Name changed')===changed,'XML '+direction);
    main.panel.reveal();ui=await frame({state:{title:main.panel.title}});results.push(...await cssCycle(ui,service,view,direction));
  }

  await service.receive(view,main,{type:'detach'});await until(()=>view.frames.get('preview')?.ready,'detached responsive window');
  const detached=view.frames.get('preview'), floating=await frame({detached:true,state:{title:detached.panel.title}});
  await until(async()=>await floating.evaluate("document.querySelector('.taxi-preview')?.dataset.formLayout==='allocated'"),'detached allocation ready');
  await observeResize(floating);
  results.push(...await cssCycle(floating,service,view,'detached'),...await nativeCycle(floating,'detached'));
  const floatingBefore=await settled(floating);
  main.panel.reveal(undefined,false);
  await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'510px',height:'340px'});true`);
  assert.deepEqual(await settled(floating),floatingBefore,'main window geometry is local to its preview');
  await ui.evaluate(`document.querySelector('#root').style.cssText='';true`);
  await service.receive(view,detached,{type:'dock'});await until(()=>!view.frames.has('preview'),'dock responsive preview');
  main.panel.reveal();ui=await frame({state:{title:main.panel.title}});
  await until(async()=>await ui.evaluate("document.querySelector('.taxi-preview')?.dataset.formLayout==='allocated'"),'docked allocation ready');
  await ui.evaluate(`[...document.querySelectorAll('.taxi-tabs button')].find(button=>button.textContent==='Canvas').click();globalThis.__sheetCanvas=document.querySelector('[data-native-spreadsheet] canvas');globalThis.__sheetTable=document.querySelector('[data-native-spreadsheet] table');true`);
  const canvasResults=[];
  for(const [width,height] of [[480,400],[900,650],[1250,800]]) {
    await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
    const sheetMode=process.platform==='linux'?'ready':'browser';
    await until(async()=>await ui.evaluate("document.querySelector('[data-native-spreadsheet]')?.dataset.nativeSpreadsheet==="+JSON.stringify(sheetMode)),'spreadsheet rendering mode ready');
    await settled(ui);
    const sample=await ui.evaluate(`(() => {const surface=document.querySelector('[data-native-field=SpreadSheetDocumentField]'),canvas=surface.querySelector('canvas'),table=surface.querySelector('table'),r=surface.getBoundingClientRect();return {width:r.width,height:r.height,pixels:[canvas.width,canvas.height],sameCanvas:canvas===__sheetCanvas,sameTable:table===__sheetTable,tableVisible:getComputedStyle(table.parentElement).display!=='none',cells:table.querySelectorAll('td').length,canvasVisible:getComputedStyle(canvas).display!=='none',page:document.querySelector('.taxi-tabs [aria-selected=true]').textContent}})()`);
    if(process.platform==='linux')assert.deepEqual(sample.pixels,[sample.width-2,sample.height-2],'canvas is rebuilt at the allocated size');
    else {
      assert.equal(sample.sameTable,true,'Windows resize keeps the spreadsheet table owner');
      assert.equal(sample.tableVisible,true);assert.equal(sample.canvasVisible,false);
      assert.equal(sample.cells,360,'the Windows spreadsheet grid remains available');
    }
    assert.equal(sample.sameCanvas,true);assert.equal(sample.page,'Canvas');canvasResults.push(sample);
  }
  if(process.platform==='linux')assert.ok(new Set(canvasResults.map(row=>row.pixels.join(':'))).size>1,'canvas buffer changes with allocation');
  else assert.ok(new Set(canvasResults.map(row=>[row.width,row.height].join(':'))).size>1,'Windows spreadsheet area follows allocation');
  await ui.evaluate(`[...document.querySelectorAll('.taxi-tabs button')].find(button=>button.textContent==='Other').click();true`);
  const otherBefore=await settled(ui);
  await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'480px',height:'400px'});true`);
  const other=await settled(ui);assert.equal(other.page,'Other');assert.ok(other.frame.width!==otherBefore.frame.width || other.scroll.x);
  await ui.evaluate(`document.querySelector('.taxi-group-title button').click();true`);
  const longCaptionResults=[];
  for(const [width,height] of [[360,240],[640,360],[1000,680]]) {
    await ui.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
    await settled(ui);
    const sample=await ui.evaluate(`(() => {const label=document.querySelector('.taxi-label'),r=label.getBoundingClientRect(),frame=document.querySelector('.taxi-form-frame'),root=frame.getBoundingClientRect(),body=frame.querySelector('.taxi-form-content'),bottom=frame.hasAttribute('data-native-form-scroll')?body.getBoundingClientRect().top+body.scrollHeight-body.scrollTop:root.bottom,close=[...document.querySelectorAll('.taxi-button')].find(button=>button.textContent==='Close').getBoundingClientRect();return {text:label.textContent,wrap:getComputedStyle(label).whiteSpace,width:r.width,height:r.height,inside:r.right<=root.right&&r.bottom<=bottom,followingControl:close.top>=r.bottom,expanded:document.querySelector('.taxi-group-title button').getAttribute('aria-expanded')==='true'}})()`);
    // Native decoration layout inserts line breaks before the CSS paint stage.
    assert.ok(sample.text.length>55&&sample.width>0&&sample.height>0);
    assert.equal(sample.inside,true,'expanded long caption stays within the scrollable form');assert.equal(sample.followingControl,true,'caption never overlaps the following button');assert.equal(sample.expanded,true);
    longCaptionResults.push({width,height,...sample});
  }
  const multilineCaption = 'First line\nSecond line';
  await replace(document, sourceTitle('Long caption remains available when the viewing area is narrow.'), sourceTitle(multilineCaption));
  const labelLineBreaks = [];
  for (const wrap of ['pre-wrap', 'pre']) {
    if (wrap === 'pre') await replace(document, '<Wrap>true</Wrap>', '<Wrap>false</Wrap>', 1);
    let lines;
    await until(async () => (lines = await ui.evaluate(`(() => {
      const label = document.querySelector('.taxi-label');
      if (label?.textContent !== ${JSON.stringify(multilineCaption)}) return false;
      const range = document.createRange();
      range.selectNodeContents(label);
      return [...new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.top))];
    })()`)) !== false, 'dirty XML label keeps explicit line break');
    assert.equal(lines.length, 2);
    assert.ok(lines[0] < lines[1]);
    labelLineBreaks.push({wrap, lines});
  }
  const authoredHeights = [];
  let compactTable;
  if (process.platform === 'linux') {
    const rootWidth = '<Width>80</Width>\n  <CommandBarLocation>None</CommandBarLocation>';
    let declaration = rootWidth;
    await ui.evaluate("globalThis.__heightOwners=[...document.querySelectorAll('.taxi-element')];true");
    for (const [units, height] of [[10, 212], [1, 68], [35, 612]]) {
      const next = `${rootWidth}\n  <Height>${units}</Height>`;
      await replace(document, declaration, next, 1);
      declaration = next;
      let measured;
      await until(async () => {
        measured = await ui.evaluate(`(() => {
          const frame = document.querySelector('.taxi-form-frame'), body = frame.querySelector('.taxi-form-content');
          return { height: frame.getBoundingClientRect().height, authored: frame.hasAttribute('data-authored-height'),
            scrolls: body.scrollHeight > body.clientHeight, sameOwners: __heightOwners.every(node => node.isConnected) };
        })()`);
        return measured.authored && measured.height === height;
      }, 'authored form height');
      assert.equal(measured.sameOwners, true);
      if (units === 1) {
        assert.equal(measured.scrolls, true);
        assert.ok(await ui.evaluate("(() => {const body=document.querySelector('.taxi-form-content');body.scrollTop=20;return body.scrollTop;})()") > 0);
      }
      authoredHeights.push({units, ...measured});
    }
    await replace(document, declaration, rootWidth + '\n  <Height>0</Height>', 1);
    await until(() => ui.evaluate("!document.querySelector('.taxi-form-frame').hasAttribute('data-authored-height')"), 'automatic form height restored');
    await checkCappedHeader(ui, document);
    await checkTallHeader(ui, document, view);
    compactTable = await checkCompactTable(ui, document, view);
  }
  assert.deepEqual(await fs.readFile(form.path),original,'resizing, zoom, navigation and dirty XML write no files');
  assert.equal(service.views.size,1);main.panel.dispose();await until(()=>service.views.size===0,'responsive session released');await Promise.all([...service.closing]);await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,formResponsive:true,locale:vscode.env.language,sourceWritesDuringViewing:false,canvasResults,longCaptionResults,labelLineBreaks,authoredHeights,compactTable,results}));
};
