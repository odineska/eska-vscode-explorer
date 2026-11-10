const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vscode=require('vscode');
const {frame,until,editFormSource,allocateFormViewport}=require('./webview-host.cjs');

const read=`(() => {
  const root=document.querySelector('.taxi-form-frame');
  if(!root?.closest('[data-form-layout=allocated]'))return null;
  const body=root.querySelector('.taxi-form-scrollport'),bar=root.querySelector('.taxi-root-commands');
  const origin=root.getBoundingClientRect(),outer=root.closest('.preview-scroll');
  const box=element=>{
    const r=element?.getBoundingClientRect();
    return r?[r.x-origin.x,r.y-origin.y,r.width,r.height]:null;
  };
  const controls=[...body.querySelectorAll('.taxi-input')];
  const first=box(controls[0]),last=box(controls.at(-1)),button=bar?.querySelector('button');
  const b=button?.getBoundingClientRect(),hit=b&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
  return {frame:[origin.width,origin.height],bar:box(bar),scrollport:box(body),firstInputY:first?.[1],first,last,
    scrollTop:body.scrollTop,maxScroll:body.hasAttribute('data-scrollable')?body.scrollHeight-body.clientHeight:0,
    buttonHit:!!button&&(hit===button||button.contains(hit)),
    innerX:body.scrollWidth>body.clientWidth,
    outerScroll:[outer.scrollWidth>outer.clientWidth,outer.scrollHeight>outer.clientHeight],
    hasTable:!!body.querySelector('.taxi-table-field'),
    sameOwners:!globalThis.__scrollOwners||__scrollOwners.every(e=>e.isConnected)};
})()`;

const scrollport = "document.querySelector('.taxi-form-scrollport')";
const scrollTo = (ui, offset) => ui.evaluate(`${scrollport}.scrollTop=${offset};true`);

async function settled(ui) {
  let sample,previous,stable=0;
  await until(async()=>{
    sample=await ui.evaluate(read);const next=JSON.stringify(sample);stable=next===previous?stable+1:0;previous=next;
    return sample&&stable>=3;
  },'stable body scroll');
  return sample;
}

async function check(ui,view,selected,label,results) {
  await allocateFormViewport(ui,[800,300]);
  await ui.evaluate(`${scrollport}.scrollTop=0;globalThis.__scrollOwners=[...document.querySelectorAll('.taxi-input'),document.querySelector('.taxi-root-commands')];true`);
  const before=await settled(ui),snapshot=view.snapshot;
  assert.ok(before.maxScroll>0,label+' scrolls the body');
  assert.equal(before.bar[1],29,label+' preserves the original command inset');
  await scrollTo(ui, Math.min(80, before.maxScroll));
  const after=await settled(ui);
  assert.ok(after.scrollTop>0);
  assert.equal(after.bar[1],before.bar[1],label+' keeps root commands in place');
  assert.equal(after.firstInputY,before.firstInputY-after.scrollTop,label+' moves form content');
  assert.equal(after.buttonHit,true,label+' keeps commands hit-testable');
  assert.equal(after.sameOwners,true);assert.deepEqual(view.selected,selected);assert.equal(view.snapshot,snapshot);
  assert.deepEqual(ui.scriptErrors(),[]);results.push({name:label+'-scrolled',before,after});
  await ui.parkPointer();await ui.screenshot(label+'-scrolled.png');
  await allocateFormViewport(ui,[900,380]);
  const resized=await settled(ui);
  assert.equal(resized.bar[1],before.bar[1],label+' keeps commands after resize');
  assert.equal(resized.buttonHit,true);assert.equal(resized.sameOwners,true);
  assert.deepEqual(view.selected,selected);assert.equal(view.snapshot,snapshot);
  results.push({name:label+'-resized',...resized});
}

function fieldsOnly(source, bar, declared, position, count = 28) {
  const children = /<ChildItems>[\s\S]*<\/ChildItems>(?=\s*<Attributes>)/u;
  assert.ok(children.test(source));
  const rows = Array.from({ length: count }, (_, index) =>
    `<InputField name="Entry${index + 1}" id="${index + 21}"><DataPath>Name</DataPath><TitleLocation>None</TitleLocation>`
      + '<Width>16</Width><HorizontalStretch>false</HorizontalStretch></InputField>');
  return source.replace(children, '<ChildItems>' + rows.join('') + '</ChildItems>')
    .replace('<Width>80</Width>', '<Width>42</Width>')
    .replace('<CommandBarLocation>None</CommandBarLocation>', `<CommandBarLocation>${position}</CommandBarLocation>`)
    .replace(bar, position === 'None' ? bar : declared);
}

async function checkFieldsOnly(ui, view, document, source, bar, declared, role, results) {
  const native = {
    Auto: { height: 760, first: 66, last: 724 },
    Bottom: { height: 769, first: 39, last: 697 },
    None: { height: 769, first: 39, last: 733 },
  };
  for (const position of ['Auto', 'Bottom', 'None']) {
    const xml = fieldsOnly(source, bar, declared, position);
    await editFormSource(document, view, xml);
    const { height, first, last } = native[position];
    await allocateFormViewport(ui, [454, height]);
    await scrollTo(ui, 0);
    const before = await settled(ui);
    assert.deepEqual(before.frame, [454, height]);
    assert.deepEqual(before.first, [13, first, 171, 23]);
    assert.deepEqual(before.outerScroll, [false, false]);
    assert.equal(before.hasTable, false);
    assert.ok(before.maxScroll > 0);
    if (position === 'Auto') assert.ok(before.bar[1] + before.bar[3] < before.scrollport[1]);
    if (position === 'Bottom') assert.ok(before.scrollport[1] + before.scrollport[3] < before.bar[1]);
    if (position === 'None') assert.equal(before.bar, null);
    await ui.evaluate("document.querySelector('.taxi-form-scrollport .taxi-element').click();true");
    await until(() => view.selected?.key?.value === '21', 'the first field is selected before scrolling');
    await ui.evaluate("globalThis.__scrollOwners=[...document.querySelectorAll('.taxi-input')];true");
    const selected = view.selected, snapshot = view.snapshot;
    await scrollTo(ui, 1e6);
    const end = await settled(ui);
    assert.equal(end.scrollTop, end.maxScroll);
    assert.deepEqual(end.last, [13, last, 171, 23], JSON.stringify(end));
    assert.deepEqual(end.outerScroll, [false, false]);
    assert.equal(end.innerX, false);
    assert.ok(end.last[1] + end.last[3] <= end.scrollport[1] + end.scrollport[3]);
    assert.deepEqual(end.bar, before.bar);
    assert.equal(end.first[2], before.first[2]);
    assert.equal(end.first[1], before.first[1] - end.scrollTop);
    assert.equal(end.sameOwners, true);
    assert.deepEqual(view.selected, selected);
    assert.equal(view.snapshot, snapshot);

    await scrollTo(ui, 80);
    await editFormSource(document, view, xml.replace('<Width>16</Width>', '<Width>17</Width>'));
    const dirty = await settled(ui);
    assert.equal(dirty.first[2], before.first[2] + 10);
    assert.equal(dirty.scrollTop, 80);
    assert.equal(dirty.sameOwners, true);
    assert.deepEqual(view.selected, selected);
    results.push({ name: role + '-fields-' + position.toLowerCase(), before, end, dirty });
    await editFormSource(document, view, fieldsOnly(source, bar, declared, position, 6));
    const short = await settled(ui);
    assert.equal(short.maxScroll, 0);
    assert.equal(short.scrollTop, 0);
    assert.deepEqual(short.outerScroll, [false, false]);
  }
  await ui.evaluate("delete globalThis.__scrollOwners;true");
}

async function checkDeclaredHeight(ui, view, document, source, bar, declared, results) {
  const cases = [
    { name: 'auto-top-height', position: 'Auto', units: 18, height: 331, last: 295 },
    { name: 'explicit-top-height', position: 'Top', units: 10, height: 203, last: 167 },
    { name: 'hidden-command-height', position: 'Auto', units: 18, height: 340, last: 304, hidden: true },
    { name: 'bottom-height', position: 'Bottom', units: 18, height: 340, last: 268 },
  ];
  for (const { name, position, units, height, last, hidden } of cases) {
    const commands = hidden ? declared.replace('<CommandName>', '<Visible>false</Visible><CommandName>') : declared;
    const xml = fieldsOnly(source, bar, commands, position)
      .replace('<Width>42</Width>', `<Width>42</Width><Height>${units}</Height>`);
    await allocateFormViewport(ui, [454, height]);
    await editFormSource(document, view, xml);
    await scrollTo(ui, 0);
    const before = await settled(ui);
    assert.deepEqual(before.frame, [454, height], name);
    assert.deepEqual(before.outerScroll, [false, false]);
    assert.equal(!!before.bar, !hidden);
    await scrollTo(ui, 1e6);
    const end = await settled(ui);
    assert.deepEqual(end.last, [13, last, 171, 23], name);
    assert.deepEqual(end.bar, before.bar);
    results.push({ name, before, end });
  }
}

exports.run=async()=>{
  const fixture=JSON.parse(process.env.ESKA_HOST_FIXTURE),form=fixture.formGallery[0],disk=await fs.readFile(form.path);
  if(process.platform!=='linux'){await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,profileApplicable:false,profile:'linux-native-scroll',results:[]}));return;}
  const explorer=await vscode.extensions.all.find(e=>e.packageJSON.name==='eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const doc=await vscode.workspace.openTextDocument(vscode.Uri.file(form.path));await vscode.window.showTextDocument(doc,{preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');const service=explorer.formPreview;
  await until(()=>[...service.views.values()].find(v=>v.path===form.path)?.phase==='ready','body form ready');
  const view=[...service.views.values()].find(v=>v.path===form.path),main=view.frames.get('main'),ui=await frame({state:{title:main.panel.title}});
  const source=doc.getText(),bar='<AutoCommandBar name="FormCommandBar" id="-1"/>';
  const declared='<AutoCommandBar name="FormCommandBar" id="-1"><Autofill>false</Autofill><ChildItems><Button name="PinnedCommand" id="500"><CommandName>Form.StandardCommand.Close</CommandName><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Команда панели</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Panel command</v8:content></v8:item></Title></Button></ChildItems></AutoCommandBar>';
  assert.equal(source.split(bar).length,2);const results=[];
  const style=await ui.evaluate("document.querySelector('.preview-scroll').style.cssText");
  const withTable=source.replace('<CommandBarLocation>None</CommandBarLocation>','<CommandBarLocation>Auto</CommandBarLocation>').replace(bar,declared);
  try {
    await checkFieldsOnly(ui,view,doc,source,bar,declared,'main',results);
    await checkDeclaredHeight(ui,view,doc,source,bar,declared,results);
    await editFormSource(doc,view,withTable);
    const selected=[...view.nodes.values()].find(n=>n.name==='Code').identity;
    await service.receive(view,main,{type:'select',identity:selected});
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await check(ui,view,selected,'main',results);
    const workbench=await ui.nativeWindow();await service.receive(view,main,{type:'detach'});
    await until(()=>view.frames.get('preview')?.ready,'body detached');
    const preview=view.frames.get('preview'),floating=await frame({detached:true,state:{title:preview.panel.title}});
    try {
      assert.notEqual((await floating.nativeWindow({detached:true})).targetId,workbench.targetId);
      await check(floating,view,selected,'detached',results);
      await checkFieldsOnly(floating,view,doc,source,bar,declared,'detached',results);
    } finally {
      try {await service.receive(view,preview,{type:'dock'});await until(()=>!view.frames.has('preview'),'body docked');}
      finally {floating.close();}
    }
    assert.deepEqual(await fs.readFile(form.path),disk);
  } catch(error) {
    await ui.screenshot('body-scroll-failure.png').catch(()=>{});throw error;
  } finally {
    await editFormSource(doc,view,source);await ui.evaluate('document.querySelector(\'.preview-scroll\').style.cssText='+JSON.stringify(style));
    ui.close();main.panel.dispose();await until(()=>service.views.size===0,'body view released');await Promise.all([...service.closing]);
  }
  await explorer.shutdown();await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,sourceWrites:false,fullNativeProfileAccepted:false,results}));
};
