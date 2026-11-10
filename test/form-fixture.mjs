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
<Button name="Action" id="3"><CommandName>Form.StandardCommand.Close</CommandName><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Выполнить</v8:content></v8:item><v8:item><v8:lang>en</v8:lang><v8:content>Execute</v8:content></v8:item></Title></Button>
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

export async function createInspectorNavigationSource(fixture) {
  const form = await createFormSource(fixture), root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects><Document>InspectorReceipt</Document>'));
  const owner = join(fixture.source, 'Documents', 'InspectorReceipt.xml');
  await mkdir(dirname(owner), { recursive: true });
  const schema = 'http://www.w3.org/2001/XMLSchema', core = 'http://v8.1c.ru/8.1/data/core';
  const typed = (kind, qualifiers = '') => `<Type xmlns:v8="${core}" xmlns:xs="${schema}"><v8:Type>xs:${kind}</v8:Type>${qualifiers}</Type>`;
  const amount = typed('decimal', '<v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>2</v8:FractionDigits><v8:AllowedSign>Nonnegative</v8:AllowedSign></v8:NumberQualifiers>');
  const children = `<Attribute uuid="b-amount"><Properties><Name>Amount</Name>${amount}</Properties></Attribute>
    <TabularSection uuid="b-lines"><Properties><Name>Lines</Name></Properties><ChildObjects>
    <Attribute uuid="b-quantity"><Properties><Name>Quantity</Name>${typed('decimal')}</Properties></Attribute>
    </ChildObjects></TabularSection>`;
  await writeFile(owner, descriptor('Document', 'InspectorReceipt', children, '<NumberLength>11</NumberLength><NumberType>String</NumberType>'));
  const attributes = `<Attributes>
    <Attribute name="Date" id="4">${typed('string')}</Attribute>
    <Attribute name="Object" id="1"><Type xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config"><v8:Type>cfg:DocumentObject.InspectorReceipt</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute>
    <Attribute name="Amount" id="2">${typed('string', '<v8:StringQualifiers><v8:Length>100</v8:Length></v8:StringQualifiers>')}</Attribute>
    <Attribute name="MixedType" id="3"><Type xmlns:v8="${core}" xmlns:xs="${schema}" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">
    <v8:Type>xs:string</v8:Type><v8:Type>xs:dateTime</v8:Type><v8:Type>cfg:DocumentRef.InspectorReceipt</v8:Type>
    <v8:StringQualifiers><v8:Length>80</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers>
    <v8:DateQualifiers><v8:DateFractions>Time</v8:DateFractions></v8:DateQualifiers></Type></Attribute>
    </Attributes>`;
  const hints = `<Font xmlns:style="http://v8.1c.ru/8.1/data/ui/style" ref="style:normaltextfont" bold="true" italic="false"/>
    <FutureSettings xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="${schema}">
      <Enabled xsi:type="xs:boolean">true</Enabled><ReadOnly xsi:type="xs:boolean">false</ReadOnly>
      <Text xsi:type="xs:string">false</Text>
    </FutureSettings>`;
  const xml = form.text.replace('<DataPath>Name</DataPath>', `<DataPath>Object.Amount</DataPath>${hints}`)
    .replace('<LabelDecoration name="SecondLabel" id="8"><Title>Other page</Title></LabelDecoration>',
      '<InputField name="SecondAmount" id="8"><Title>Second amount</Title><DataPath>Object.Amount</DataPath></InputField>')
    .replace(/<Attributes>[\s\S]*?<\/Attributes>/u, attributes);
  await writeFile(form.path, xml);
  let deep = Array.from({length: 2250}, (_, index) => `<InputField name="DeepField${index}" id="${index + 1000}">
    <Visible>false</Visible><DataPath>Value${index % 1000}</DataPath></InputField>`).join('');
  for (let depth = 22; depth >= 0; depth--) deep = `<UsualGroup name="Branch${depth}" id="${depth + 1}">
    <Group>Vertical</Group><ShowTitle>false</ShowTitle><ChildItems>${deep}</ChildItems></UsualGroup>`;
  const text = typed('string', '<v8:StringQualifiers><v8:Length>100</v8:Length></v8:StringQualifiers>');
  const largeAttributes = Array.from({length: 1000}, (_, index) => `<Attribute name="Value${index}" id="${index + 1}">${text}</Attribute>`).join('');
  await writeFile(form.second, `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><CommandBarLocation>None</CommandBarLocation>
    <AutoCommandBar name="FormCommandBar" id="-1"/><ChildItems>${deep}</ChildItems><Attributes>${largeAttributes}</Attributes></Form>`);
  return { ...form, owner, text: xml };
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

export async function createInputBordersGallery(fixture, { recordedTimeFormat = false } = {}) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const reference = JSON.parse(await readFile(join(input,'metrics.json'),'utf8')), forms = [];
  for (const row of reference.forms) {
    const source = row.file.includes('/') ? join(input,'..',row.file) : join(input,row.file);
    const [form] = await createGallery(fixture,[basename(source,'.xml')],dirname(source));
    if (recordedTimeFormat) {
      // These Linux pixel references were recorded with the en-US 12-hour mask.
      const xml = await readFile(form.path, 'utf8');
      const authored = xml.replace(/<InputField name="([^"]+)"[^>]*>/gu, (opening, name) => {
        const type = row.fields.find(field => field.name === name)?.type;
        if (type?.kind !== 'date' || type.dateParts === 'Date') return opening;
        const date = type.dateParts === 'Time' ? '' : 'MM/dd/yyyy ';
        return opening + '<EditFormat><v8:item><v8:lang>en</v8:lang><v8:content>L=en_US; DF="' + date
          + 'hh:mm:ss tt"</v8:content></v8:item></EditFormat>';
      });
      if (authored !== xml) await writeFile(form.path, authored);
    }
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

async function readButtonPaintOrigins() {
  const input=process.env.ESKA_FORM_BUTTON_PAINT_ORIGINS;
  if(!input)return;
  if(!isAbsolute(input))throw new Error('ESKA_FORM_BUTTON_PAINT_ORIGINS must be absolute.');
  return JSON.parse(await readFile(join(input,'positioned.json'),'utf8'));
}

export async function createPrimaryButtonGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native fixture directory.');
  const style = await createStyleFormSource(fixture, join(input, '..', 'native-style-values'));
  const metrics = JSON.parse(await readFile(join(input,'metrics.json'),'utf8')), forms = [];
  const origins=await readButtonPaintOrigins();
  for (const row of metrics.rows) {
    const source = join(input,row.file), [form] = await createGallery(fixture,[basename(source,'.xml')],dirname(source));
    const poses=row.name===origins?.primaryButtonForm ? origins.buttonPoses.map(pose=>({
      ...row,paintOrigin:pose.paintFrameOrigin,pose:pose.pose,
      buttons:row.buttons.map((button,index)=>({...button,wholeRgbSha256:pose.buttons[index].wholeRgbSha256,
        bottomBorder:pose.buttons[index].bottom})),
    })) : undefined;
    forms.push({...form,kind:row.name,expected:row,poses,...(row.styleFile?{styleText:await readFile(join(input,row.styleFile),'utf8')}:{})});
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

async function addProbeStyleItems(fixture, input) {
  await mkdir(join(fixture.source, 'StyleItems'), { recursive: true });
  for (const name of ['ProbeColor', 'ProbeFont']) await writeFile(join(fixture.source, 'StyleItems', `${name}.xml`), await readFile(join(input, 'StyleItems', `${name}.xml`)));
  const root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>', '<ChildObjects><StyleItem>ProbeColor</StyleItem><StyleItem>ProbeFont</StyleItem>'));
}

export async function createGroupGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native fixture directory.');
  await addProbeStyleItems(fixture, input);
  const rows = await createGallery(fixture, ['GroupDefault', 'GroupNone', 'GroupStrong', 'GroupWeak', 'GroupBackColor', 'GroupTitleFont', 'GroupHidden', 'GroupCollapsible',
    'PagesTop', 'PagesBottom', 'PagesNone', 'PagesAuto', 'PagesLeft', 'PagesRight', 'PagesSwipe', 'CommandBar', 'ButtonGroup', 'Popup', 'BarWithButtonGroup', 'BarWithPopup', 'StyleReferences', 'Decorations']);
  const reference = JSON.parse(await readFile(join(input, 'frame-locales.json'), 'utf8'));
  return rows.map(row => ({ ...row, nativeFrameLocales: reference.rows.find(native => native.name === row.kind)?.locales }));
}

async function addNativeGoods(fixture, catalog) {
  await mkdir(join(fixture.source, 'Catalogs'), {recursive:true});
  await writeFile(join(fixture.source, 'Catalogs', 'NativeGoods.xml'), await readFile(catalog));
  const configuration = join(fixture.source, 'Configuration.xml');
  const xml = await readFile(configuration, 'utf8');
  await writeFile(configuration, xml.replace('<ChildObjects>', '<ChildObjects><Catalog>NativeGoods</Catalog>'));
}

async function addNativeUsers(fixture) {
  await writeFile(join(fixture.source, 'Catalogs', 'NativeUsers.xml'), descriptor('Catalog', 'NativeUsers'));
  const configuration = join(fixture.source, 'Configuration.xml');
  await writeFile(configuration, (await readFile(configuration, 'utf8')).replace('<ChildObjects>', '<ChildObjects><Catalog>NativeUsers</Catalog>'));
}

async function addNativeChoices(fixture, descriptor) {
  await mkdir(join(fixture.source, 'Enums'), { recursive: true });
  await writeFile(join(fixture.source, 'Enums', 'NativeChoices.xml'), await readFile(descriptor));
  const configuration = join(fixture.source, 'Configuration.xml');
  await writeFile(configuration, (await readFile(configuration, 'utf8')).replace('<ChildObjects>', '<ChildObjects><Enum>NativeChoices</Enum>'));
}

export async function createReferenceWidthGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native reference directory.');
  await addNativeGoods(fixture, join(input, 'Catalog.xml'));
  await addNativeChoices(fixture, join(input, 'Enum.xml'));
  return createMeasuredFormGallery(fixture, input);
}

export async function createReferenceButtonGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native reference button directory.');
  const reference = join(input, '..', 'native-reference-widths');
  await addNativeGoods(fixture, join(reference, 'Catalog.xml'));
  await addNativeUsers(fixture);
  await addNativeChoices(fixture, join(reference, 'Enum.xml'));
  return createInputBordersGallery(fixture);
}

export async function createChoicePictureGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute choice picture fixture directory.');
  const { pictures } = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  await addNativeUsers(fixture);
  await addNativeChoices(fixture, join(input, '..', 'native-reference-widths', 'Enum.xml'));
  await cp(join(input, 'CommonPictures'), join(fixture.source, 'CommonPictures'), { recursive: true });
  const configuration = join(fixture.source, 'Configuration.xml');
  const entries = pictures.map(name => `<CommonPicture>${name}</CommonPicture>`).join('');
  await writeFile(configuration, (await readFile(configuration, 'utf8')).replace('<ChildObjects>', '<ChildObjects>' + entries));
  return createInputBordersGallery(fixture);
}

export async function createTableHeightGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native table height directory.');
  await addNativeGoods(fixture, join(input, 'Catalog.xml'));
  return createMeasuredFormGallery(fixture, input);
}

export async function createCommandPaletteGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native command palette directory.');
  const { rows, profiles, captions, additionSourceMembers } = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  const cases = new Map(rows.map(row => [row.name, row.selections]));
  await addNativeGoods(fixture, join(input, '..', 'native-context-tables', 'Catalog.xml'));
  const configuration = join(fixture.source, 'Configuration.xml');
  const config = await readFile(configuration, 'utf8');
  await writeFile(configuration, config.replace('</Properties>', '<ScriptVariant>English</ScriptVariant></Properties>'));
  const forms = await createGallery(fixture, [...cases.keys()], input);
  const formGallery = forms.map(form => ({
    ...form, expected: { selections: cases.get(form.kind).map(({ name, profile, unavailable }) => ({ name, profile, unavailable })) },
  }));
  return { formGallery, profiles, captions, additionSourceMembers };
}

export async function createTablePaletteGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the native table palette directory.');
  const { rows, profiles, captions } = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  // The RPC test uses separate projects for both variants of the same catalog.
  const cases = new Map(rows.filter(row => !row.hierarchical).map(row => [row.name, row.selections]));
  await addNativeGoods(fixture, join(input, '..', 'native-context-tables', 'Catalog.xml'));
  const configuration = join(fixture.source, 'Configuration.xml');
  await mkdir(join(fixture.source, 'Documents'), { recursive: true });
  await writeFile(join(fixture.source, 'Documents', 'NativeSale.xml'), await readFile(join(input, 'NativeSale.xml')));
  await writeFile(configuration, (await readFile(configuration, 'utf8')).replace('<ChildObjects>', '<ChildObjects><Document>NativeSale</Document>'));
  const forms = await createGallery(fixture, [...cases.keys()], input);
  const formGallery = forms.map(form => ({
    ...form, expected: { selections: cases.get(form.kind).map(({ name, profile, unavailable }) => ({ name, profile, unavailable })) },
  }));
  return { formGallery, profiles, captions };
}

export async function createTableGallery(fixture) {
  const frames = JSON.parse(await readFile(join(process.env.ESKA_FORM_FIXTURES, 'frame-metrics.json'), 'utf8'));
  const result = (await createGallery(fixture, frames.rows.map(row => row.name)))
    .map(form => ({ ...form, nativeFrame: frames.rows.find(row => row.name === form.kind).locales }));
  if (process.env.ESKA_FORM_CONTEXT_FIXTURES) {
    const input = process.env.ESKA_FORM_CONTEXT_FIXTURES;
    if (!isAbsolute(input)) throw new Error('ESKA_FORM_CONTEXT_FIXTURES must be absolute.');
    await addNativeGoods(fixture, join(input, 'Catalog.xml'));
    result.push(...await createGallery(fixture, ['MetadataTable', 'DynamicList'], input));
  }
  if (process.env.ESKA_FORM_ADDITION_FIXTURES) result.push(...await createGallery(fixture, ['NoViewStatus', 'NoSearchControl'], process.env.ESKA_FORM_ADDITION_FIXTURES));
  if (process.env.ESKA_FORM_STATE_FIXTURES) result.push(...await createGallery(fixture, ['ColumnHidden'], process.env.ESKA_FORM_STATE_FIXTURES));
  if (process.env.ESKA_FORM_TABLE_COMMAND_FIXTURES) result.push(...await createGallery(fixture, ['TablePopup', 'TableButtonGroup', 'SourceBarEmpty'], process.env.ESKA_FORM_TABLE_COMMAND_FIXTURES));
  return result;
}

export async function createUnitedGallery(fixture) {
  const forms = await createGallery(fixture, ['ColumnsFF', 'ColumnsFT', 'ColumnsTF', 'ColumnsTT', 'NestedFF', 'NestedFT', 'RowsF', 'RowsT']);
  if (process.platform === 'linux') {
    await addNativeGoods(fixture, join(process.env.ESKA_FORM_FIXTURES, '..', 'native-context-tables', 'Catalog.xml'));
  }
  return forms;
}

export async function createColumnWidthGallery(fixture, locale) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute native column widths directory.');
  await addNativeGoods(fixture, join(input, '..', 'native-context-tables', 'Catalog.xml'));
  await addNativeChoices(fixture, join(input, '..', 'native-reference-widths', 'Enum.xml'));
  await addNativeUsers(fixture);
  const measurements = await Promise.all(['metrics.json', 'automatic-metrics.json', 'narrow-metrics.json', 'fixed-sibling-metrics.json',
    'title-location-metrics.json', 'checkbox-metrics.json', 'mixed-title-metrics.json', 'group-alignment-metrics.json',
    'footer-allocation-metrics.json', 'footer-wrapped-metrics.json', 'input-stack-metrics.json',
    'vertical-amount-title-metrics.json', 'vertical-reference-title-metrics.json',
    'compact-header-metrics.json', 'compact-footer-title-metrics.json']
    .map(async file => JSON.parse(await readFile(join(input, file), 'utf8'))));
  const cases = new Map();
  for (const { fixtures } of measurements) {
    for (const [kind, profiles] of Object.entries(fixtures)) {
      const samples = profiles.cases ?? profiles[locale] ?? [];
      if (samples.length) cases.set(kind, [...(cases.get(kind) ?? []), ...samples]);
    }
  }
  const forms = await createGallery(fixture, [...cases.keys()], input);
  return forms.map(form => ({ ...form, cases: cases.get(form.kind) }));
}

export async function createNumericLabelGallery(fixture, locale) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the absolute numeric labels directory.');
  await addNativeGoods(fixture, join(input, 'NativeGoods.xml'));
  const {fixtures} = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  const wraps = JSON.parse(await readFile(join(input, 'wrap-metrics.json'), 'utf8'));
  const kinds = [...new Set([...Object.keys(fixtures), ...Object.keys(wraps.fixtures)])];
  const forms = await createGallery(fixture, kinds, input);
  return forms.map(form => {
    const base = fixtures[form.kind]?.[locale], narrow = wraps.fixtures[form.kind]?.[locale];
    const cases = [...(base?.cases ?? []), ...(narrow ?? [])];
    return {...form, captions:base?.captions ?? wraps.captions[locale], cases};
  });
}

export async function createThroughAlignGallery(fixture) {
  const forms = await createGallery(fixture, ['Labels']);
  const rows = process.env.ESKA_FORM_THROUGH_ROWS;
  if (!rows) return forms;
  if (!isAbsolute(rows)) throw new Error('ESKA_FORM_THROUGH_ROWS must be absolute.');
  const { cases, boundaryCases = [], valueCases = [], representationCases = [] } = JSON.parse(await readFile(join(rows, 'metrics.json'), 'utf8'));
  const inputs = [...new Set([...cases, ...boundaryCases, ...valueCases, ...representationCases].flatMap(sample => sample.fixture ? [sample.fixture] : []))];
  const wrapped = await createGallery(fixture, inputs, rows);
  return forms.concat(wrapped.map(form => ({...form, cases:cases.filter(sample => sample.fixture === form.kind),
    boundaryCases:boundaryCases.filter(sample => sample.fixture === form.kind),
    valueCases:valueCases.filter(sample => sample.fixture === form.kind),
    representationCases:representationCases.filter(sample => sample.fixture === form.kind)})));
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
  const form = await createFormSource(fixture);
  const root = join(fixture.source, 'Configuration.xml');
  await writeFile(root, (await readFile(root, 'utf8')).replace('<ChildObjects>',
    '<ChildObjects><CommonPicture>Icon</CommonPicture><CommonPicture>GeneratedIcon</CommonPicture><CommonPicture>MenuIcon</CommonPicture><CommandGroup>PrintProbe</CommandGroup><Document>GenerateTarget</Document>'));

  const readable = 'http://v8.1c.ru/8.3/xcf/readable';
  const reference = name => `<Picture xmlns:xr="${readable}"><xr:Ref>CommonPicture.${name}</xr:Ref></Picture>`;
  async function icon(name, file, data) {
    const folder = join(fixture.source, 'CommonPictures', name, 'Ext');
    const pictureXml = join(folder, 'Picture.xml');
    const payload = join(folder, 'Picture', file);
    await mkdir(join(folder, 'Picture'), { recursive: true });
    await writeFile(join(fixture.source, 'CommonPictures', `${name}.xml`), descriptor('CommonPicture', name));
    await writeFile(pictureXml, `<ExtPicture xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xr="${readable}"><Picture><xr:Abs>${file}</xr:Abs></Picture></ExtPicture>`);
    await writeFile(payload, data);
    return { pictureXml, payload };
  }
  const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`;
  const { pictureXml, payload: one } = await icon('Icon', 'One.svg', svg('red'));
  const { pictureXml: generatedPictureXml, payload: generated } = await icon('GeneratedIcon', 'Generated.svg', svg('yellow'));
  const template = await readFile(new URL('./fixtures/form-template-picture.zip', import.meta.url));
  await writeFile(join(dirname(generated), 'Template.zip'), template);
  const two = join(dirname(one), 'Two.svg');
  await writeFile(two, svg('blue'));
  await icon('MenuIcon', 'Menu.zip', template);
  const group = join(fixture.source, 'CommandGroups', 'PrintProbe.xml');
  await mkdir(dirname(group), { recursive: true });
  await writeFile(group, descriptor('CommandGroup', 'PrintProbe', '', '<Category>FormCommandBar</Category>'));
  const target = join(fixture.source, 'Documents', 'GenerateTarget.xml');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, descriptor('Document', 'GenerateTarget', '',
    `<BasedOn xmlns:xr="${readable}"><xr:Item>Catalog.Покупатели</xr:Item></BasedOn>`));

  const owner = join(fixture.source, 'Catalogs', 'Товары.xml');
  const generatedCommand = `<Command uuid="657d01bd-aad7-4076-9864-ce2aa659793b"><Properties><Name>GeneratedIcon</Name>
    <Group>FormCommandBarImportant</Group><CommandParameterType><v8:Type>cfg:CatalogRef.Товары</v8:Type></CommandParameterType>
    <Representation>Picture</Representation>${reference('GeneratedIcon')}</Properties></Command>`;
  const menuCommand = `<Command uuid="a7de123c-e8f2-49dd-9bc2-1978769c1038"><Properties><Name>Invoice</Name>
    <Group>CommandGroup.PrintProbe</Group><CommandParameterType><v8:Type>cfg:CatalogRef.Товары</v8:Type></CommandParameterType>
    ${reference('MenuIcon')}</Properties></Command>`;
  await writeFile(owner, (await readFile(owner, 'utf8'))
    .replace('<MetaDataObject ', '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" ')
    .replace('<ChildObjects>', `<ChildObjects>${generatedCommand}${menuCommand}`));

  const button = (name, id, mode, title = '', command = 'LocalIcon') => `<Button name="${name}" id="${id}"><Type>CommandBarButton</Type>
    <CommandName>Form.Command.${command}</CommandName><Representation>${mode}</Representation>${title ? `<Title>${title}</Title>` : ''}</Button>`;
  const bar = `<AutoCommandBar name="FormCommandBar" id="-1"><ChildItems>
    ${button('AutoIcon', 91, 'Auto')}
    ${button('TextIcon', 92, 'Text', 'Text command')}
    ${button('MixedIcon', 93, 'PictureAndText', 'Mixed command')}
    ${button('NoIcon', 94, 'Picture', '', 'NoIcon')}
    </ChildItems></AutoCommandBar>`;
  const localCommands = `<Commands><Command name="LocalIcon" id="101"><Title>Local icon</Title>${reference('Icon')}</Command>
    <Command name="NoIcon" id="102"><Title>No icon</Title></Command>
    <Command name="LocalReceipt" id="103"><Title>Local receipt</Title></Command></Commands>`;
  const commandInterface = `<CommandInterface><CommandBar><Item><Command>Form.Command.LocalReceipt</Command>
    <Type>Added</Type><CommandGroup>CommandGroup.PrintProbe</CommandGroup></Item></CommandBar></CommandInterface>`;
  await writeFile(form.path, form.text
    .replace('<CommandBarLocation>None</CommandBarLocation><AutoCommandBar name="FormCommandBar" id="-1"/>', bar)
    .replace('<ChildItems><UsualGroup', `<ChildItems><PictureDecoration name="Logo" id="99">${reference('Icon')}</PictureDecoration><UsualGroup`)
    .replace('</Attributes>', '<Attribute name="Object" id="10"><Type><v8:Type xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">cfg:CatalogObject.Товары</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>')
    .replace('</Form>', `${localCommands}${commandInterface}</Form>`));
  return { ...form, pictureXml, one, two, owner, generated, generatedPictureXml, group, target };
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
  const origins=await readButtonPaintOrigins();
  const cases=matrix.cases.map(row=>({...row,path:join(fixture.source,row.path),
    frameRaster:origins?.formFrames.find(frame=>frame.form===row.name)}));
  return {cases,sources:matrix.files.map(row=>join(fixture.source,row.path.slice('source/'.length)))};
}

export async function createTablePixelsGallery(fixture) {
  const input=process.env.ESKA_FORM_TABLE_PIXELS;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_TABLE_PIXELS must identify the native pixel fixture directory.');
  const reference=JSON.parse(await readFile(join(input,'metrics.json'),'utf8')),forms=await createTableGallery(fixture);
  const bands = process.env.ESKA_FORM_TABLE_BAND_FIXTURES;
  if (bands) {
    if (!isAbsolute(bands)) throw new Error('ESKA_FORM_TABLE_BAND_FIXTURES must be absolute.');
    const { rows } = JSON.parse(await readFile(join(bands, 'metrics.json'), 'utf8'));
    await addProbeStyleItems(fixture, join(bands, '..', 'native-groups'));
    forms.push(...await createGallery(fixture, rows.map(row => row.name), bands));
    reference.rows.push(...rows);
  }
  const context=process.env.ESKA_FORM_CONTEXT_PIXELS;
  if(context){
    if(!isAbsolute(context))throw new Error('ESKA_FORM_CONTEXT_PIXELS must be absolute.');
    reference.rows.push(...JSON.parse(await readFile(join(context,'metrics.json'),'utf8')).rows);
  }
  const bars=process.env.ESKA_FORM_TABLE_BARS;
  if(bars){
    if(!isAbsolute(bars))throw new Error('ESKA_FORM_TABLE_BARS must be absolute.');
    const {rows,movedTable}=JSON.parse(await readFile(join(bars,'metrics.json'),'utf8'));
    for(const toolbar of rows){
      const row=reference.rows.find(row=>row.name===toolbar.name);
      if(!row)throw new Error(`Missing table for native toolbar ${toolbar.name}.`);
      for(const [locale,region]of Object.entries(toolbar.locales))row.locales[locale].wholeToolbar=region;
    }
    if(movedTable){
      const row=reference.rows.find(row=>row.name===movedTable.name);
      if(!row)throw new Error(`Missing table for moved native toolbar ${movedTable.name}.`);
      for(const [locale,region]of Object.entries(movedTable.locales))row.locales[locale].movedToolbar=region;
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
  const reflow=process.env.ESKA_FORM_TABLE_SEARCH_REFLOW;
  if(reflow){
    if(!isAbsolute(reflow))throw new Error('ESKA_FORM_TABLE_SEARCH_REFLOW must be absolute.');
    for(const field of JSON.parse(await readFile(join(reflow,'metrics.json'),'utf8')).rows){
      const row=reference.rows.find(row=>row.name===field.name);
      if(!row||row.sourceSha256!==field.sourceSha256)throw new Error(`Missing matching table for native search reflow ${field.name}.`);
      for(const [locale,regions]of Object.entries(field.locales))row.locales[locale].searchReflow=regions;
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
    const defaultTable=reference.rows.find(row=>row.name==='Default');
    for(const table of JSON.parse(await readFile(join(movement,'metrics.json'),'utf8')).rows){
      const row=reference.rows.find(row=>row.name===table.name);
      if(!row)throw new Error(`Missing table for native movement ${table.name}.`);
      for(const [locale,region]of Object.entries(table.locales)){
        const expected=row.locales[locale];expected.additionalRegions??=[];
        // These default and detached poses use the moved group measurements.
        const moved=defaultTable?.locales[locale]?.movedToolbar;
        expected.additionalRegions.push(moved?{...region,rgbSha256:moved.movementRgbSha256}:region);
      }
    }
  }
  return forms.map(form=>{
    const row=reference.rows.find(row=>row.name===form.kind);
    if(!row)throw new Error(`Missing native table pixel reference for ${form.kind}.`);
    return {...form,expectedTablePixels:row.locales};
  });
}

export async function createStandaloneAdditionGallery(fixture) {
  const input = process.env.ESKA_FORM_FIXTURES;
  if (!input || !isAbsolute(input)) throw new Error('ESKA_FORM_FIXTURES must identify the standalone additions directory.');
  const { rows } = JSON.parse(await readFile(join(input, 'metrics.json'), 'utf8'));
  await addNativeGoods(fixture, join(input, '..', 'native-context-tables', 'Catalog.xml'));
  const forms = await createGallery(fixture, rows.map(row => row.name), input);
  return forms.map((form, index) => ({ ...form, expected: rows[index].locales }));
}
