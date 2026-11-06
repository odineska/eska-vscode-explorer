import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { join, isAbsolute, dirname, basename } from 'node:path';
import { createTreeProject, descriptor } from './fixture.mjs';
export async function createFormSource(fixture) {
  const root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects><CommonForm>Preview</CommonForm><CommonForm>Second</CommonForm>'));
  const body = `<Title><v8:item><v8:lang>ru</v8:lang><v8:content>Просмотр</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Preview</v8:content></v8:item></Title>
<Width>50</Width><CommandBarLocation>None</CommandBarLocation><AutoCommandBar name="FormCommandBar" id="-1"/>
<ChildItems><UsualGroup name="Group" id="1"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Параметры</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Parameters</v8:content></v8:item></Title><Group>Vertical</Group><ShowTitle>true</ShowTitle><ChildItems>
<InputField name="Name" id="2"><DataPath>Name</DataPath><AutoMarkIncomplete>true</AutoMarkIncomplete><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Наименование</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Name</v8:content></v8:item></Title><Width>20</Width></InputField>
<Button name="Action" id="3"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Выполнить</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Execute</v8:content></v8:item></Title></Button>
</ChildItems></UsualGroup><Pages name="Pages" id="4"><ChildItems><Page name="First" id="5"><Title>First</Title><ChildItems><LabelDecoration name="Label" id="6"><Title>First page</Title></LabelDecoration></ChildItems></Page><Page name="Other" id="7"><Title>Other</Title><ChildItems><LabelDecoration name="SecondLabel" id="8"><Title>Other page</Title></LabelDecoration></ChildItems></Page></ChildItems></Pages></ChildItems><Attributes><Attribute name="Name" id="1"><Type><v8:Type xmlns:xs="http://www.w3.org/2001/XMLSchema">xs:string</v8:Type></Type></Attribute></Attributes>`;
  const text = `\ufeff<?xml version="1.0" encoding="UTF-8"?>\r\n<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">${body}</Form>\r\n`;
  for (const name of ['Preview', 'Second']) {
    await mkdir(join(fixture.source, 'CommonForms', name, 'Ext'), { recursive: true });
    await writeFile(join(fixture.source, 'CommonForms', `${name}.xml`), descriptor('CommonForm', name, '', '<FormType>Managed</FormType>'));
    await writeFile(join(fixture.source, 'CommonForms', name, 'Ext', 'Form.xml'), text.replace('Просмотр', name === 'Second' ? 'Вторая' : 'Просмотр'));
  }
  return { path: join(fixture.source, 'CommonForms', 'Preview', 'Ext', 'Form.xml'), second: join(fixture.source, 'CommonForms', 'Second', 'Ext', 'Form.xml'), text };
}

export async function createFormGallery(fixture) {
  const kinds = ['InputField', 'CheckBoxField', 'CalendarField', 'ChartField', 'FormattedDocumentField', 'HTMLDocumentField', 'LabelField',
    'ProgressBarField', 'TrackBarField', 'RadioButtonField', 'PictureField', 'SpreadSheetDocumentField', 'PlannerField',
    'TextDocumentField', 'PDFDocumentField', 'DendrogramField', 'GanttChartField', 'GeographicalSchemaField', 'GraphicalSchemaField', 'PeriodField'];
  return createGallery(fixture, kinds);
}

export async function createFormInspectorSource(fixture) {
  const form = await createFormSource(fixture);
  const input = form.text.match(/<InputField\b[\s\S]*?<\/InputField>/)[0];
  const changed = input.replace(/<Title>[\s\S]*?<\/Title>/, '<Title>true</Title>').replace('</InputField>', `
<Visible>true</Visible><ReadOnly>false</ReadOnly>
<Font faceName="Liberation Sans" height="12" bold="false"/>
<Width xmlns="urn:vendor">false</Width>
<Events><Event name="OnChange">NameChanged</Event><Event name="OnChange" callType="After">NameChangedAfter</Event></Events>
</InputField>`);
  await writeFile(form.path, form.text.replace(input, changed));
  return form;
}

export async function createFormHandlerSource(fixture) {
  const form=await createFormInspectorSource(fixture);
  const xml=await readFile(form.path,'utf8');
  await writeFile(form.path,xml.replace('</Form>','<Events><Event name="OnOpen">ПриОткрытии</Event></Events><Commands><Command name="Execute" id="100"><Action>ExecuteCommand</Action></Command></Commands></Form>'));
  const module=join(fixture.source,'CommonForms','Preview','Ext','Form','Module.bsl');
  await mkdir(join(module,'..'),{recursive:true});
  const bsl='\ufeff// 😀 Procedure NameChanged() EndProcedure\r\n&НаКлиенте\r\nПроцедура ПРИОТКРЫТИИ()\r\nКонецПроцедуры\r\nProcedure NameChanged(Element)\r\nEndProcedure\r\nProcedure NameChangedAfter(Element)\r\nEndProcedure\r\nProcedure ExecuteCommand(Command)\r\nEndProcedure\r\n';
  await writeFile(module,bsl);
  return {...form,module};
}

export async function createFormActivitySource(fixture) {
  await rm(fixture.source,{recursive:true});
  const base=await createTreeProject(join(fixture.root,'members','base'));
  const extension=await createTreeProject(join(fixture.root,'members','extension'),'extension');
  await writeFile(join(base.root,'eska.toml'),"[project]\nname='base'\ntype='configuration'\n");
  await writeFile(join(extension.root,'eska.toml'),"[project]\nname='extension'\ntype='extension'\n");
  const child=title=>`<ChildItems><LabelDecoration name="Caption" id="1"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>${title}</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>${title}</v8:content></v8:item></Title></LabelDecoration></ChildItems>`;
  const body='<CommandBarLocation>None</CommandBarLocation>'+child('Base caption');
  const form=content=>`<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">${content}</Form>`;
  for(const member of [base,extension]) {
    const root=join(member.source,'Configuration.xml');
    await writeFile(root,(await readFile(root,'utf8')).replace('<ChildObjects>','<ChildObjects><CommonForm>Preview</CommonForm>'));
    await mkdir(join(member.source,'CommonForms','Preview','Ext'),{recursive:true});
    await writeFile(join(member.source,'CommonForms','Preview.xml'),descriptor('CommonForm','Preview','', '<FormType>Managed</FormType>'));
    member.path=join(member.source,'CommonForms','Preview','Ext','Form.xml');
    await writeFile(member.path,form(member===base?body:body.replaceAll('Base caption','Extension caption')+`<BaseForm>${body}</BaseForm>`));
  }
  await writeFile(join(fixture.root,'eska.toml'),"[workspace]\n[analysis]\ndefault_application='app'\n[workspace.members.app]\nconfiguration='members/base'\nextensions=[{path='members/extension'}]\n");
  const configDir=join(fixture.root,'.machine-config');await mkdir(configDir);
  return {base,extension,configDir};
}

export async function createCompositionFormSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  await rm(fixture.source,{recursive:true});
  const matrix=JSON.parse(await readFile(join(input,'metrics.json'),'utf8'));
  const members={},sources=[];
  for(const [name,prefix,type]of [['base','Base','configuration'],['first','First','extension'],['second','Second','extension']]) {
    const root=join(fixture.root,'members',name),source=join(root,'src');
    const payload=join(source,'CommonForms','ProbeCompose','Ext','Form.xml');
    await mkdir(dirname(payload),{recursive:true});
    const manifest=join(root,'eska.toml');await writeFile(manifest,`[project]\nname='${name}'\ntype='${type}'\n`);sources.push(manifest);
    for(const [from,to]of [[name==='second'?'SecondAddonConfiguration.xml':prefix+'Configuration.xml','Configuration.xml'],[prefix+'Descriptor.xml','CommonForms/ProbeCompose.xml'],[prefix+'.xml','CommonForms/ProbeCompose/Ext/Form.xml']]) {
      const target=join(source,to);await cp(join(input,from),target);sources.push(target);
    }
    if(name==='base') {const target=join(source,'Languages','Русский.xml');await mkdir(dirname(target),{recursive:true});await cp(join(input,'Language.xml'),target);sources.push(target);}
    members[name]={root,source,path:payload,configuration:join(source,'Configuration.xml')};
  }
  const manifest=join(fixture.root,'eska.toml');
  await writeFile(manifest,"[workspace]\n[analysis]\ndefault_application='native'\n[workspace.members.native]\nconfiguration='members/base'\nextensions=[{path='members/second'},{path='members/first'}]\n");sources.push(manifest);
  return {members,sources,cases:matrix.cases,path:members.base.path};
}

export async function createOwnerFormSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  await rm(fixture.source,{recursive:true});
  const matrix=JSON.parse(await readFile(join(input,'metrics.json'),'utf8')),members={},sources=[];
  for(const name of ['base','first','second']) {
    const root=join(fixture.root,'members',name),source=join(root,'src');
    await cp(join(input,name),source,{recursive:true});
    const manifest=join(root,'eska.toml');
    await writeFile(manifest,`[project]\nname='${name}'\ntype='${name==='base'?'configuration':'extension'}'\n`);sources.push(manifest);
    for(const file of matrix.files.filter(file=>file.path.startsWith(name+'/')))sources.push(join(source,file.path.slice(name.length+1)));
    members[name]={root,source};
  }
  const manifest=join(fixture.root,'eska.toml');
  await writeFile(manifest,"[workspace]\n[analysis]\ndefault_application='native'\n[workspace.members.native]\nconfiguration='members/base'\nextensions=[{path='members/first'},{path='members/second'}]\n");sources.push(manifest);
  return {members,sources,cases:matrix.cases.filter(row=>row.activeExtensions.length===2)};
}

export async function createStyleCompositionSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  await rm(fixture.source,{recursive:true});
  const matrix=JSON.parse(await readFile(join(input,'metrics.json'),'utf8')),members={},sources=[];
  for(const name of ['base','first','second']) {
    const root=join(fixture.root,'members',name),source=join(root,'src');await cp(join(input,name),source,{recursive:true});
    const manifest=join(root,'eska.toml');await writeFile(manifest,`[project]\nname='${name}'\ntype='${name==='base'?'configuration':'extension'}'\n`);sources.push(manifest);
    for(const file of matrix.files.filter(file=>file.path.startsWith(name+'/')))sources.push(join(source,file.path.slice(name.length+1)));
    members[name]={root,source,configuration:join(source,'Configuration.xml')};
  }
  const manifest=join(fixture.root,'eska.toml');await writeFile(manifest,"[workspace]\n[analysis]\ndefault_application='native'\n[workspace.members.native]\nconfiguration='members/base'\nextensions=[{path='members/first'},{path='members/second'}]\n");sources.push(manifest);
  const fullStyle=await readFile(join(input,'variants/FirstBaseSelectedStyle.xml'),'utf8');
  const start=fullStyle.indexOf('<Item name="StyleItem.F_ProbeColor">'),end=fullStyle.indexOf('</Item>',start)+7;
  if(start<0||end<=start)throw new Error('Native owned color item is missing.');
  return {members,sources,cases:matrix.cases,fullStyle,ownColorItem:fullStyle.slice(start,end)};
}

export async function createStateGallery(fixture) {
  return createGallery(fixture, ['InputHidden', 'InputDisabled', 'InputReadOnly', 'InputColors', 'InputFont', 'InputNumber', 'InputDate', 'InputDateTime', 'InputTime',
    'Font10Bold', 'Font12Normal', 'Font14Normal', 'Font16Normal', 'Font14Number', 'TableHidden']);
}

export async function createPaletteGallery(fixture) {
  return createGallery(fixture,['Field','Button']);
}

export async function createStyleFormSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  for (const folder of ['Styles', 'StyleItems', 'CommonForms']) await cp(join(input, folder), join(fixture.source, folder), {recursive:true});
  const root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('</Properties>', '<DefaultStyle>Style.ProbeStyleValues</DefaultStyle></Properties>')
    .replace('<ChildObjects>', '<ChildObjects><Style>ProbeStyleValues</Style><StyleItem>ProbeColor</StyleItem><StyleItem>ProbeFont</StyleItem><CommonForm>ProbeStyleConsumer</CommonForm>'));
  return {path:join(fixture.source,'CommonForms','ProbeStyleConsumer','Ext','Form.xml'),style:join(fixture.source,'Styles','ProbeStyleValues','Ext','Style.xml')};
}

export async function createStylePaletteGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const { style } = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  await writeFile(style, await readFile(join(input, 'Style.xml')));
  const expected = JSON.parse(await readFile(join(input, 'manifest.json'), 'utf8'));
  const forms = await createGallery(fixture, [...Object.keys(expected.defaultColors), 'Group', 'GroupAccent', 'TabAccent']);
  return { forms, style, configuration:join(fixture.source, 'Configuration.xml'), expected };
}

export async function createStyleColorRolesSource(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const form = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  await writeFile(form.path, await readFile(join(input, 'Alias.xml')));
  await writeFile(form.style, await readFile(join(input, 'Style.xml')));
  const definition = join(fixture.source, 'StyleItems', 'TextColor.xml'), root = join(fixture.source, 'Configuration.xml');
  await writeFile(definition, await readFile(join(input, 'TextColor.xml')));
  await writeFile(root, (await readFile(root,'utf8')).replace('<ChildObjects>', '<ChildObjects><StyleItem>TextColor</StyleItem>'));
  return {...form,definition};
}

export async function createFontRolesGallery(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const form = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  await writeFile(form.style, await readFile(join(input, 'Style.xml')));
  const definition = join(fixture.source, 'StyleItems', 'TitleFont.xml'), root = join(fixture.source, 'Configuration.xml');
  await writeFile(definition, await readFile(join(input, 'TitleFont.xml')));
  await writeFile(root, (await readFile(root,'utf8')).replace('<ChildObjects>', '<ChildObjects><StyleItem>TitleFont</StyleItem>'));
  return {forms:await createMeasuredFormGallery(fixture,input),style:form.style,definition,overrides:await readFile(join(input,'StyleOverrides.xml'),'utf8')};
}

export async function createFrameCornersGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const reference = JSON.parse(await readFile(join(input,'corners.json'),'utf8'));
  const fonts = await createFontRolesGallery(fixture,join(input,'..','native-font-roles'));
  const metrics = await createMeasuredFormGallery(fixture,join(input,'..','native-button-metrics'));
  const pages = await createGallery(fixture,['PagesAuto'],join(input,'..','native-groups'));
  const forms = [ ...fonts.forms.map(form=>({...form,kind:'font-'+form.kind})),
    ...metrics.map(form=>({...form,kind:'button-'+form.kind})), ...pages ];
  return {forms:forms.map(form=>({...form,expected:reference.rows.find(row=>row.name===form.kind)})),referencePixels:reference.referencePixels};
}

export async function createInputBordersGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const reference = JSON.parse(await readFile(join(input,'metrics.json'),'utf8')), forms = [];
  for (const row of reference.forms) {
    const source = row.file.includes('/') ? join(input,'..',row.file) : join(input,row.file);
    const [form] = await createGallery(fixture,[basename(source,'.xml')],dirname(source));
    forms.push({...form,kind:row.name,expected:row});
  }
  return {forms};
}

export async function createTabBordersGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const reference = JSON.parse(await readFile(join(input,'metrics.json'),'utf8')), forms = [];
  for (const row of reference.forms) {
    const source = row.file.includes('/') ? join(input,'..',row.file) : join(input,row.file);
    const [form] = await createGallery(fixture,[basename(source,'.xml')],dirname(source));
    forms.push({...form,kind:row.name,expected:row});
  }
  return {forms};
}

export async function createPrimaryButtonGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const style = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  const metrics = JSON.parse(await readFile(join(input,'metrics.json'),'utf8')), forms = [];
  for (const row of metrics.rows) {
    const source = join(input,row.file), [form] = await createGallery(fixture,[basename(source,'.xml')],dirname(source));
    forms.push({...form,kind:row.name,expected:row,...(row.styleFile?{styleText:await readFile(join(input,row.styleFile),'utf8')}:{})});
  }
  return {forms,style:style.style,configuration:join(fixture.source,'Configuration.xml')};
}

export async function createPrimaryAppearanceGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const form = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  await writeFile(form.style, await readFile(join(input, 'Style.xml')));
  return createMeasuredFormGallery(fixture);
}

export async function createMeasuredFormGallery(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const metrics = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  return (await createGallery(fixture, metrics.rows.map(row => row.name), input)).map(form => ({...form, expected:metrics.rows.find(row => row.name === form.kind)}));
}

export async function createResponsiveFormGallery(fixture) { return createGallery(fixture, ['Main']); }

export async function createGroupGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native fixture directory.');
  await mkdir(join(fixture.source, 'StyleItems'), { recursive: true });
  for (const name of ['ProbeColor', 'ProbeFont']) await writeFile(join(fixture.source, 'StyleItems', `${name}.xml`), await readFile(join(input, 'StyleItems', `${name}.xml`)));
  const root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects><StyleItem>ProbeColor</StyleItem><StyleItem>ProbeFont</StyleItem>'));
  return createGallery(fixture, ['GroupDefault', 'GroupNone', 'GroupStrong', 'GroupWeak', 'GroupBackColor', 'GroupTitleFont', 'GroupHidden', 'GroupCollapsible',
    'PagesTop', 'PagesBottom', 'PagesNone', 'PagesAuto', 'PagesLeft', 'PagesRight', 'PagesSwipe', 'CommandBar', 'ButtonGroup', 'Popup', 'BarWithButtonGroup', 'BarWithPopup', 'StyleReferences', 'Decorations']);
}

export async function createTableGallery(fixture) {
  const result = await createGallery(fixture, ['Default', 'GridFooter', 'Horizontal', 'HorizontalTitled', 'Vertical', 'InCell', 'Marked', 'ReadOnly', 'NoAutoFill']);
  if (process.env.ESKA_FORM_CONTEXT_FIXTURES) {
    const input = process.env.ESKA_FORM_CONTEXT_FIXTURES;
    if (!isAbsolute(input)) throw new Error('ESKA_FORM_CONTEXT_FIXTURES must be absolute.');
    await mkdir(join(fixture.source, 'Catalogs'), { recursive: true });
    await writeFile(join(fixture.source, 'Catalogs', 'NativeGoods.xml'), await readFile(join(input, 'Catalog.xml')));
    const root = join(fixture.source, 'Configuration.xml');
    await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects><Catalog>NativeGoods</Catalog>'));
    result.push(...await createGallery(fixture, ['MetadataTable', 'DynamicList'], input));
  }
  if (process.env.ESKA_FORM_ADDITION_FIXTURES) result.push(...await createGallery(fixture, ['NoViewStatus', 'NoSearchControl'], process.env.ESKA_FORM_ADDITION_FIXTURES));
  if (process.env.ESKA_FORM_STATE_FIXTURES) result.push(...await createGallery(fixture, ['ColumnHidden'], process.env.ESKA_FORM_STATE_FIXTURES));
  if (process.env.ESKA_FORM_TABLE_COMMAND_FIXTURES) result.push(...await createGallery(fixture, ['TablePopup', 'TableButtonGroup', 'SourceBarEmpty'], process.env.ESKA_FORM_TABLE_COMMAND_FIXTURES));
  return result;
}

export function createUnitedGallery(fixture) {
  return createGallery(fixture, ['ColumnsFF', 'ColumnsFT', 'ColumnsTF', 'ColumnsTT', 'NestedFF', 'NestedFT', 'RowsF', 'RowsT']);
}

export function createThroughAlignGallery(fixture) {
  return createGallery(fixture, ['Labels']);
}

async function createGallery(fixture, kinds, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native fixture directory.');
  const forms = [];
  for (const kind of kinds) {
    const name = `Gallery${kind}`, path = join(fixture.source, 'CommonForms', name, 'Ext', 'Form.xml');
    await mkdir(join(fixture.source, 'CommonForms', name, 'Ext'), { recursive: true });
    await writeFile(join(fixture.source, 'CommonForms', `${name}.xml`), descriptor('CommonForm', name, '', '<FormType>Managed</FormType>'));
    await writeFile(path, await readFile(join(input, `${kind}.xml`)));
    forms.push({ kind, path });
  }
  const root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects>' + kinds.map(kind => `<CommonForm>Gallery${kind}</CommonForm>`).join('')));
  return forms;
}

export async function createPictureFormSource(fixture) {
  const form = await createFormSource(fixture), root = join(fixture.source,'Configuration.xml');
  await writeFile(root,(await readFile(root,'utf8')).replace('<ChildObjects>','<ChildObjects><CommonPicture>Icon</CommonPicture>'));
  const folder=join(fixture.source,'CommonPictures','Icon','Ext'), imageFolder=join(folder,'Picture');
  await mkdir(imageFolder,{recursive:true});
  await writeFile(join(fixture.source,'CommonPictures','Icon.xml'),descriptor('CommonPicture','Icon'));
  const pictureXml=join(folder,'Picture.xml');
  await writeFile(pictureXml,'<ExtPicture xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"><Picture><xr:Abs>One.svg</xr:Abs></Picture></ExtPicture>');
  const svg=color=>`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`;
  const one=join(imageFolder,'One.svg'),two=join(imageFolder,'Two.svg');
  await writeFile(one,svg('red'));await writeFile(two,svg('blue'));
  await writeFile(form.path,form.text.replace('<ChildItems>','<ChildItems><PictureDecoration name="Logo" id="99"><Picture xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"><xr:Ref>CommonPicture.Icon</xr:Ref><xr:LoadTransparent>false</xr:LoadTransparent></Picture></PictureDecoration>'));
  return {...form,pictureXml,one,two};
}

export async function createDependencyFormSource(fixture) {
  const form = await createFormSource(fixture), root = join(fixture.source, 'Configuration.xml');
  const names = ['FontA', 'FontB', 'FontC'];
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects>' + names.map(name => `<StyleItem>${name}</StyleItem>`).join('')));
  await mkdir(join(fixture.source, 'StyleItems'), { recursive: true });
  const styles = {};
  for (const name of names) {
    styles[name] = join(fixture.source, 'StyleItems', `${name}.xml`);
    await writeFile(styles[name], descriptor('StyleItem', name, '', '<Type>Font</Type><Value xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xsi:type="v8ui:Font" ref="sys:DefaultGUIFont" height="12" kind="WindowsFont"/>'));
  }
  await writeFile(form.path, form.text.replace('<Width>20</Width>', '<Width>20</Width><Font xmlns:style="http://v8.1c.ru/8.1/data/ui/style" ref="style:FontA" kind="StyleItem"/>'));
  return { ...form, styles };
}

export async function createPictureCompositionSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  await rm(fixture.source,{recursive:true});
  const matrix=JSON.parse(await readFile(join(input,'metrics.json'),'utf8')),members={},sources=[];
  for(const name of ['base','first','second']) {
    const root=join(fixture.root,'members',name),source=join(root,'src');await cp(join(input,name),source,{recursive:true});
    const manifest=join(root,'eska.toml');await writeFile(manifest,`[project]\nname='${name}'\ntype='${name==='base'?'configuration':'extension'}'\n`);sources.push(manifest);
    for(const file of matrix.files.filter(file=>file.path.startsWith(name+'/')&&!file.path.startsWith('second/CommonPictures/ProbeIcon/Ext/')))sources.push(join(source,file.path.slice(name.length+1)));
    members[name]={root,source};
  }
  const second=join(members.second.source,'CommonPictures','ProbeIcon'),secondDescriptor=second+'.xml';
  await rm(join(second,'Ext'),{recursive:true});
  const borrowedDescriptor=await readFile(join(input,'variants','SecondBorrowedPicture.xml'),'utf8');await writeFile(secondDescriptor,borrowedDescriptor);
  const manifest=join(fixture.root,'eska.toml');await writeFile(manifest,"[workspace]\n[analysis]\ndefault_application='native'\n[workspace.members.native]\nconfiguration='members/base'\nextensions=[{path='members/first'},{path='members/second'}]\n");sources.push(manifest);
  return {members,sources,baseForm:join(members.base.source,'CommonForms','ProbePicture','Ext','Form.xml'),ownForm:join(members.first.source,'CommonForms','F_PictureOwn','Ext','Form.xml'),
    firstImage:join(members.first.source,'CommonPictures','ProbeIcon','Ext','Picture','Picture.svg'),secondDescriptor,borrowedDescriptor,
    extendedDescriptor:await readFile(join(input,'second','CommonPictures','ProbeIcon.xml'),'utf8'),emptyDescription:await readFile(join(input,'variants','SecondEmptyPicture.xml'),'utf8'),
    secondDescription:await readFile(join(input,'second','CommonPictures','ProbeIcon','Ext','Picture.xml'),'utf8'),secondImage:(await readFile(join(input,'second','CommonPictures','ProbeIcon','Ext','Picture','Picture.svg'))).toString('base64'),
    secondPictureXml:join(second,'Ext','Picture.xml'),secondPayload:join(second,'Ext','Picture','Picture.zip'),secondSvg:join(second,'Ext','Picture','Picture.svg')};
}

export async function createButtonTypesSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  await rm(fixture.source,{recursive:true});await cp(join(input,'source'),fixture.source,{recursive:true});
  const matrix=JSON.parse(await readFile(join(input,'metrics.json'),'utf8'));
  return {path:join(fixture.source,'CommonForms','ProbeButtons','Ext','Form.xml'),controls:matrix.controls,sources:matrix.files.map(file=>join(fixture.source,file.path.slice('source/'.length)))};
}

export async function createButtonLinksSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  const result=await createButtonTypesSource(fixture,input);
  return {...result,linkPixels:JSON.parse(await readFile(join(input,'link-pixels.json'),'utf8'))};
}

export async function createButtonRowsSource(fixture, input = process.env.ESKA_FORM_FIXTURES) {
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  await rm(fixture.source,{recursive:true});await cp(join(input,'source'),fixture.source,{recursive:true});
  const matrix=JSON.parse(await readFile(join(input,'metrics.json'),'utf8'));
  return {cases:matrix.cases.map(row=>({...row,path:join(fixture.source,row.path)})),sources:matrix.files.map(row=>join(fixture.source,row.path.slice('source/'.length)))};
}

export async function createTablePixelsGallery(fixture) {
  const input=process.env.ESKA_FORM_TABLE_PIXELS;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_TABLE_PIXELS must identify the native pixel fixture directory.');
  const reference=JSON.parse(await readFile(join(input,'metrics.json'),'utf8')),forms=await createTableGallery(fixture);
  const context=process.env.ESKA_FORM_CONTEXT_PIXELS;
  if(context){
    if(!isAbsolute(context))throw new Error('ESKA_FORM_CONTEXT_PIXELS must be absolute.');
    reference.rows.push(...JSON.parse(await readFile(join(context,'metrics.json'),'utf8')).rows);
  }
  const bars=process.env.ESKA_FORM_TABLE_BARS;
  if(bars){
    if(!isAbsolute(bars))throw new Error('ESKA_FORM_TABLE_BARS must be absolute.');
    for(const toolbar of JSON.parse(await readFile(join(bars,'metrics.json'),'utf8')).rows){
      const row=reference.rows.find(row=>row.name===toolbar.name);
      if(!row)throw new Error(`Missing table for native toolbar ${toolbar.name}.`);
      for(const [locale,region]of Object.entries(toolbar.locales))row.locales[locale].wholeToolbar=region;
    }
  }
  const menus=process.env.ESKA_FORM_TABLE_MENU_PIXELS;
  if(menus){
    if(!isAbsolute(menus))throw new Error('ESKA_FORM_TABLE_MENU_PIXELS must be absolute.');
    for(const menu of JSON.parse(await readFile(join(menus,'metrics.json'),'utf8')).menuCaptions.rows){
      const row=reference.rows.find(row=>row.name===menu.form);
      if(!row)throw new Error(`Missing table for native menu ${menu.form}.`);
      row.locales[menu.locale].additionalRegions=[
        {name:'menu-caption',offset:[menu.region[0],-65+menu.region[1]],width:menu.region[2],height:menu.region[3],rgbSha256:menu.rgbSha256},
        {name:'menu-arrow',offset:[menu.arrowRegion[0],-65+menu.arrowRegion[1]],width:6,height:3,rgbSha256:menu.arrowRgbSha256}
      ];
    }
  }
  const searches=process.env.ESKA_FORM_TABLE_SEARCH_PIXELS;
  if(searches){
    if(!isAbsolute(searches))throw new Error('ESKA_FORM_TABLE_SEARCH_PIXELS must be absolute.');
    for(const search of JSON.parse(await readFile(join(searches,'metrics.json'),'utf8')).rows){
      const row=reference.rows.find(row=>row.name===search.name);
      if(!row)throw new Error(`Missing table for native search ${search.name}.`);
      for(const [locale,region]of Object.entries(search.locales)){
        const expected=row.locales[locale];expected.additionalRegions??=[];
        expected.additionalRegions.push({name:'search-placeholder',offset:region.offset,width:region.nativeRegion[2],height:region.nativeRegion[3],rgbSha256:region.rgbSha256});
      }
    }
  }
  const searchFields=process.env.ESKA_FORM_TABLE_SEARCH_FIELDS;
  if(searchFields){
    if(!isAbsolute(searchFields))throw new Error('ESKA_FORM_TABLE_SEARCH_FIELDS must be absolute.');
    for(const field of JSON.parse(await readFile(join(searchFields,'metrics.json'),'utf8')).rows){
      const row=reference.rows.find(row=>row.name===field.name);
      if(!row)throw new Error(`Missing table for native search field ${field.name}.`);
      for(const [locale,region]of Object.entries(field.locales)){
        const expected=row.locales[locale];expected.additionalRegions??=[];expected.additionalRegions.push(region);
      }
    }
  }
  const pictures=process.env.ESKA_FORM_TABLE_PICTURE_PIXELS;
  if(pictures){
    if(!isAbsolute(pictures))throw new Error('ESKA_FORM_TABLE_PICTURE_PIXELS must be absolute.');
    for(const table of JSON.parse(await readFile(join(pictures,'metrics.json'),'utf8')).tableConsumers){
      const row=reference.rows.find(row=>row.name===table.name);
      if(!row)throw new Error(`Missing table for native pictures ${table.name}.`);
      for(const [locale,pictures]of Object.entries(table.locales)){
        const expected=row.locales[locale];expected.additionalRegions??=[];expected.additionalRegions.push(...pictures,table.toolbar[locale]);
      }
    }
  }
  const movement=process.env.ESKA_FORM_TABLE_MOVEMENT_PIXELS;
  if(movement){
    if(!isAbsolute(movement))throw new Error('ESKA_FORM_TABLE_MOVEMENT_PIXELS must be absolute.');
    for(const table of JSON.parse(await readFile(join(movement,'metrics.json'),'utf8')).rows){
      const row=reference.rows.find(row=>row.name===table.name);
      if(!row)throw new Error(`Missing table for native movement ${table.name}.`);
      for(const [locale,region]of Object.entries(table.locales)){
        const expected=row.locales[locale];expected.additionalRegions??=[];expected.additionalRegions.push(region);
      }
    }
  }
  return forms.map(form=>{
    const row=reference.rows.find(row=>row.name===form.kind);
    if(!row)throw new Error(`Missing native table pixel reference for ${form.kind}.`);
    return {...form,expectedTablePixels:row.locales};
  });
}
