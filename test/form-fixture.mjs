import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
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

export async function createPrimaryAppearanceGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const form = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  await writeFile(form.style, await readFile(join(input, 'Style.xml')));
  return createMeasuredFormGallery(fixture);
}

export async function createMeasuredFormGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const metrics = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  return (await createGallery(fixture, metrics.rows.map(row => row.name))).map(form => ({...form, expected:metrics.rows.find(row => row.name === form.kind)}));
}

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
  if (process.env.ESKA_FORM_TABLE_COMMAND_FIXTURES) result.push(...await createGallery(fixture, ['TablePopup', 'TableButtonGroup'], process.env.ESKA_FORM_TABLE_COMMAND_FIXTURES));
  return result;
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
