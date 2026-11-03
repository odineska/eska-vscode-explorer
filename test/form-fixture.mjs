import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { descriptor } from './fixture.mjs';
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
    'ProgressBarField', 'TrackBarField', 'RadioButtonField', 'PictureField', 'SpreadSheetDocumentField', 'PlannerField'];
  return createGallery(fixture, kinds);
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
