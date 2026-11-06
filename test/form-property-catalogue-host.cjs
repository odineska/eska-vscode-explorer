const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, frame } = require('./webview-host.cjs');

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), file = fixture.form.path;
  const expectedCatalogue = process.env.ESKA_HOST_PROPERTY_CATALOGUE !== 'legacy';
  const expectedInputCatalogue = process.env.ESKA_HOST_PROPERTY_CATALOGUE !== 'group-only';
  const before = await fs.readFile(file);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(document, {preview:false});
  await vscode.commands.executeCommand('eska.explorer.previewForm');
  const service = explorer.formPreview;
  await until(() => service.views.size === 1 && [...service.views.values()][0].phase === 'ready', 'catalogue form ready');
  const view = [...service.views.values()][0], main = view.frames.get('main');
  assert.equal(view.client.limits.propertyPalette === true, expectedCatalogue);
  const ui = await frame({fixedFormArea:true,state:{title:main.panel.title}});
  const ru = vscode.env.language.startsWith('ru');
  const group = view.snapshot.model.root.children.find(node => node.name === 'Group');
  const input = group.children.find(node => node.name === 'Name');
  const select = async node => {
    const identity = node.identity;
    const key = identity.key.kind === 'root' ? 'root' : identity.key.value;
    const id = `form-row-${identity.source}:current:${key}`;
    await ui.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    await until(() => view.selected?.source === identity.source && view.selected.key.kind === identity.key.kind
      && view.selected.key.value === identity.key.value, 'selected ' + (node.name ?? key));
  };
  await until(() => ui.evaluate("!!document.querySelector('.form-tree-row')"), 'element tree rendered');
  await select(group);
  const cases = [];
  if (!expectedCatalogue) {
    await until(() => ui.evaluate("!!document.querySelector('.form-properties [data-property-name=ShowTitle]')"), 'legacy XML properties');
    assert.equal(await ui.evaluate("document.querySelectorAll('.form-properties [data-palette-id]').length"), 0);
    cases.push('api-1.40-raw-properties');
    await select(view.snapshot.model.root);
    await until(() => ui.evaluate("!!document.querySelector('.form-properties [data-property-name=Title]') && !document.querySelector('[data-palette-id]')"), 'API 1.40 root XML');
    cases.push('api-1.40-root-xml-fallback');
  } else {
    await until(() => ui.evaluate("document.querySelectorAll('.form-properties [data-palette-id]').length===35"), '35 native rows');
    const baseline = await ui.evaluate(`(() => {
      const row = name => document.querySelector('[data-palette-id="platform:'+name+'"]');
      const checkbox = row('United').querySelector('input');
      return {categories:[...document.querySelectorAll('.form-property-category')].map(row=>row.textContent),
        type:row('Type').querySelector('td').textContent,width:row('Width').querySelector('td').textContent,
        through:row('ThroughAlign').querySelector('td').textContent,stretch:row('HorizontalStretch').querySelector('td').textContent,
        united:{checked:checkbox.checked,disabled:checkbox.disabled,source:row('United').dataset.paletteSource,
          tab:row('United').getAttribute('tabindex')}};})()`);
    assert.deepEqual(baseline, {
      categories:ru ? ['Основные','Использование','Оформление','Расположение'] : ['General','Use','Appearance','Layout'],
      type:ru ? 'Обычная группа' : 'Regular group',width:'0',through:ru?'Авто':'Auto',stretch:ru?'Авто':'Default',
      united:{checked:true,disabled:true,source:'absent',tab:null}
    });
    cases.push('native-order-categories-and-defaults');
    await ui.screenshot(`form-property-catalogue-${vscode.env.language}.png`);
    await ui.evaluate(`(() => {
      const title=document.querySelector('[data-palette-id="platform:Title"] details');
      globalThis.__catalogueTitle=title;
      title.querySelector('summary').click();
    })()`);
    await until(() => ui.evaluate("globalThis.__catalogueTitle.open"), 'localized title expanded');
    const original = document.getText();
    const override = original.replace('<UsualGroup name="Group" id="1">', '<UsualGroup name="Group" id="1" DisplayImportance="High">')
      .replace('<Group>Vertical</Group>', '<Group>Vertical</Group><United>false</United><GroupHorizontalAlign>Left</GroupHorizontalAlign><Width>0</Width><ToolTip/><f:United xmlns:f="urn:extra">first</f:United><f:United xmlns:f="urn:extra">second</f:United>');
    const edit = async text => {
      const change = new vscode.WorkspaceEdit();
      change.replace(document.uri,new vscode.Range(document.positionAt(0),document.positionAt(document.getText().length)),text);
      assert.equal(await vscode.workspace.applyEdit(change),true);
    };
    const revision = view.snapshot.revision;
    await edit(override);
    await until(async () => view.phase==='ready' && view.snapshot.revision!==revision && await ui.evaluate(`document.querySelector('[data-palette-id="platform:United"]')?.dataset.paletteSource==='form'`), 'dirty palette installed');
    const dirty = await ui.evaluate(`(() => {
      const row = name => document.querySelector('[data-palette-id="platform:'+name+'"]');
      return {united:row('United').querySelector('input').checked,alignment:row('HorizontalAlignInGroup').dataset.propertyName,
        width:[row('Width').dataset.paletteSource,row('Width').querySelector('td').textContent],
        tooltip:row('ToolTip').dataset.paletteSource, importance:row('DisplayImportance').querySelector('td').textContent,
        keptTitle:globalThis.__catalogueTitle===row('Title').querySelector('details') && globalThis.__catalogueTitle.open};})()`);
    assert.deepEqual(dirty,{united:false,alignment:'GroupHorizontalAlign',width:['form','0'],tooltip:'form',importance:'High',keptTitle:true});
    cases.push('dirty-aliases-and-stable-expanded-title');
    await ui.evaluate(`document.querySelector('[data-palette-id="platform:DisplayImportance"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
    await until(() => vscode.window.activeTextEditor?.document.uri.fsPath === file && !vscode.window.activeTextEditor.selection.isEmpty, 'attribute XML navigation');
    assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection), 'DisplayImportance="High"');
    main.panel.reveal();
    cases.push('exact-attribute-source');
    await ui.evaluate(`(() => {
      const repeated = document.querySelectorAll('[data-property-namespace="urn:extra"]');
      repeated[1].dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}));
    })()`);
    await until(() => {
      const editor = vscode.window.activeTextEditor;
      return editor?.document.uri.fsPath === file && editor.document.getText(editor.selection).includes('>second<');
    }, 'repeated XML navigation');
    assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection), '<f:United xmlns:f="urn:extra">second</f:United>');
    cases.push('exact-repeated-xml-source');
    main.panel.reveal();
    await edit(original);
    await until(async () => view.phase==='ready' && await ui.evaluate(`document.querySelector('[data-palette-id="platform:United"]')?.dataset.paletteSource==='absent'`), 'removed overrides revert to defaults');
    assert.equal(await ui.evaluate(`globalThis.__catalogueTitle===document.querySelector('[data-palette-id="platform:Title"] details') && globalThis.__catalogueTitle.open`),true);
    cases.push('removed-override-restores-default');
    await select(input);
    if (expectedInputCatalogue) {
      const inputRows = () => ui.evaluate(`(() => {
        const row = id => document.querySelector('[data-palette-id="platform:'+id+'"]');
        const text = id => row(id)?.querySelector('td').textContent;
        return {count:document.querySelectorAll('.form-properties [data-palette-id^="platform:"]').length,
          categories:[...document.querySelectorAll('.form-property-category')].map(category=>category.textContent),
          type:text('Type'),dataPath:text('DataPath'),mask:!!row('Mask'),min:!!row('MinValue'),wrap:row('Wrap')?.querySelector('input')?.checked,
          format:!!row('Format'),editFormat:!!row('EditFormat'),choiceLinks:!!row('ChoiceParameterLinks'),
          choiceForm:!!row('ChoiceForm'),listEdit:row('MultipleValuesExtendedEdit')?.querySelector('input')?.checked,
          listColor:text('MultipleValuesBackColor'),allowEmpty:row('AllowInputEmptyMultipleValues')?.querySelector('input')?.checked,
          choiceAvailable:row('ChoiceList')?.dataset.paletteAvailable !== 'false',choiceSource:row('ChoiceList')?.dataset.paletteSource,
          choiceTitle:row('ChoiceList')?.title,hyperlink:text('MultipleValuesHyperlink'),
          width:text('Width'),maxWidth:text('MaxWidth'),titleLocation:text('TitleLocation'),
          change:text('OnChange'),changeSource:row('OnChange')?.dataset.paletteSource,
          choiceTab:row('StartChoice')?.getAttribute('tabindex')};
      })()`);
      await until(async () => (await inputRows()).count===88, 'native string field catalogue');
      const baseline = await inputRows();
      assert.deepEqual(baseline.categories,ru?['Основные','Использование','Оформление','Расположение','События']
        :['General','Use','Appearance','Layout','Events']);
      assert.equal(baseline.type,ru?'Поле ввода':'Text box');
      assert.equal(baseline.mask,true);
      assert.equal(baseline.min,false);
      assert.equal(baseline.wrap,true);
      assert.equal(baseline.change,'');
      assert.equal(baseline.choiceTab,null);
      cases.push('native-field-catalogue-and-unbound-events');

      const eventXml = '<Events><Event name="OnChange">TestChange</Event></Events>';
      const dirty = original.replace('>xs:string</v8:Type>','>xs:decimal</v8:Type>')
        .replace('<Width>20</Width></InputField>',`<Width>0</Width><TitleLocation>Top</TitleLocation><AutoMaxWidth>false</AutoMaxWidth>${eventXml}</InputField>`);
      assert.ok(dirty.includes(eventXml));
      const selected = view.selected.key.value, previousRevision = view.snapshot.revision;
      await edit(dirty);
      await until(async () => view.phase==='ready' && view.snapshot.revision!==previousRevision
        && (await inputRows()).change==='TestChange', 'dirty field event and type');
      const numeric = await inputRows();
      assert.equal(numeric.count,88);
      assert.equal(numeric.mask,false);
      assert.equal(numeric.min,true);
      assert.equal(numeric.maxWidth,'0');
      assert.equal(numeric.width,'0');
      assert.equal(numeric.titleLocation,ru?'Верх':'Top');
      assert.equal(numeric.changeSource,'form');
      assert.equal(numeric.choiceTab,null);
      assert.equal(view.selected.key.value,selected);
      cases.push('dirty-type-maximum-and-event-rows');
      await ui.evaluate(`document.querySelector('[data-palette-id="platform:OnChange"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
      await until(() => vscode.window.activeTextEditor?.document.uri.fsPath===file
        && vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection)===eventXml, 'event XML wrapper selected');
      main.panel.reveal();
      cases.push('event-row-navigates-existing-xml');
      const xs = value => `<v8:Type xmlns:xs="http://www.w3.org/2001/XMLSchema">xs:${value}</v8:Type>`;
      const reference = '<v8:Type xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">cfg:CatalogRef.Товары</v8:Type>';
      const withTypes = types => original.replace(xs('string'),types);
      assert.ok(original.includes(xs('string')));
      const list = withTypes('<v8:Type>v8:ValueListType</v8:Type>');
      const choiceXml = '<ChoiceList xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema"><xr:Item><xr:Value xsi:type="xs:string">Existing</xr:Value></xr:Item></ChoiceList>';
      const extendedList = list.replace('<DataPath>Name</DataPath>',
        '<DataPath>Name</DataPath><ExtendedEditMultipleValues>true</ExtendedEditMultipleValues>'+choiceXml);
      const bindings = [
        {name:'unbound',xml:original.replace('<DataPath>Name</DataPath>',''),expect:{count:92,type:'',dataPath:'',mask:true,min:true}},
        {name:'mixed-number',xml:withTypes(xs('string')+xs('decimal')),expect:{count:92,type:baseline.type,mask:true,min:true,editFormat:true,choiceForm:false}},
        {name:'catalog-reference',xml:withTypes(reference),expect:{count:87,type:baseline.type,mask:false,min:false,choiceLinks:true,choiceForm:true}},
        {name:'mixed-reference',xml:withTypes(xs('string')+reference),expect:{count:94,type:baseline.type,mask:true,min:true,choiceLinks:true,choiceForm:false}},
        {name:'value-list',xml:list,expect:{count:101,type:baseline.type,format:true,listEdit:false,listColor:ru?'Авто':'Auto',choiceAvailable:true}},
        {name:'value-list-extended',xml:extendedList,expect:{count:105,type:baseline.type,listEdit:true,allowEmpty:false,
          choiceAvailable:false,choiceSource:'form',hyperlink:ru?'Авто':'Default'}},
      ];
      for (const {name,xml,expect} of bindings) {
        const revision = view.snapshot.revision;
        await edit(xml);
        await until(async () => {
          if (view.phase!=='ready' || view.snapshot.revision===revision) return false;
          const rows = await inputRows();
          return rows.count===expect.count && rows.type===expect.type;
        }, 'input catalogue for '+name);
        const rows = await inputRows();
        for (const [key,value] of Object.entries(expect)) assert.equal(rows[key],value,`${name}: ${key}`);
        assert.equal(view.selected.key.value,selected);
        cases.push('dirty-binding-'+name);
      }
      const unavailable = await inputRows();
      assert.ok(unavailable.choiceTitle.endsWith(ru?'Недоступно в этом режиме':'Unavailable in this mode'));
      await ui.evaluate(`document.querySelector('[data-palette-id="platform:ChoiceList"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
      await until(() => vscode.window.activeTextEditor?.document.uri.fsPath===file
        && vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection)===choiceXml, 'disabled property source selected');
      main.panel.reveal();
      cases.push('unavailable-choice-list-keeps-xml-source');
      await edit(original);
      await until(async () => {
        const rows = await inputRows();
        return view.phase==='ready' && rows.count===88 && rows.mask && rows.change==='' && rows.choiceAvailable;
      }, 'string catalogue and choice list availability restored');
    } else {
      await until(() => ui.evaluate("!!document.querySelector('[data-property-name=DataPath]') && !document.querySelector('[data-palette-id]')"), 'earlier 1.41 field fallback');
      cases.push('earlier-1.41-field-fallback');
    }
    if (expectedInputCatalogue && process.env.ESKA_HOST_PROPERTY_CATALOGUE !== 'input-only') {
      await select(view.snapshot.model.root);
      const rootRows = () => ui.evaluate(`(() => {
        const row = id => document.querySelector('[data-palette-id="platform:'+id+'"]');
        const value = id => row(id)?.querySelector('td').textContent;
        return {
          count:document.querySelectorAll('.form-properties [data-palette-id^="platform:"]').length,
          categories:[...document.querySelectorAll('.form-property-category')].slice(0,5).map(item=>item.textContent),
          grouping:value('Group'),location:value('CommandBarLocation'),scaling:value('ScalingMode'),
          scale:value('Scale'),autoTitle:row('AutoTitle')?.querySelector('input')?.checked,
          storage:value('SettingsStorage') ?? null,conditional:value('ConditionalAppearance'),
          conditionalSource:row('ConditionalAppearance')?.dataset.paletteSource,
          open:value('OnOpen'),lastEvent:row('OnPasteFromClipboard')?.querySelector('th').textContent,
        };
      })()`);
      await until(async () => (await rootRows()).count===58, 'native root catalogue');
      assert.deepEqual(await rootRows(),{
        count:58,categories:ru?['Основные','Использование','Оформление','Расположение','События']:['General','Use','Appearance','Layout','Events'],
        grouping:ru?'Вертикальная':'Vertical',location:ru?'Нет':'None',scaling:ru?'Авто':'Auto',scale:'100',autoTitle:true,
        storage:null,conditional:ru?'Открыть':'Open',conditionalSource:'absent',open:'',
        lastEvent:ru?'ПриВставкеИзБуфераОбмена':'OnPasteFromClipboard'
      });
      cases.push('native-form-root-properties-and-events');

      const appearance = '<ConditionalAppearance xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"><dcsset:item/></ConditionalAppearance>';
      const events = '<Events><Event name="OnOpen">InspectOpen</Event></Events>';
      const stored = '<SettingsStorage>SettingsStorage.ProbeFormSettings</SettingsStorage>';
      const explicit = original.replace('<Width>50</Width>',
        '<Width>50</Width><AutoTitle>false</AutoTitle><Group>HorizontalIfPossible</Group><SaveDataInSettings>UseList</SaveDataInSettings>'
        +'<ScalingMode>Normal</ScalingMode><Scale>110</Scale>'+stored)
        .replace('<Attributes>','<Attributes>'+appearance).replace('</Form>',events+'</Form>');
      assert.ok(explicit.includes(appearance) && explicit.includes(stored) && explicit.includes(events));
      const rootRevision = view.snapshot.revision;
      await edit(explicit);
      await until(async () => {
        if (view.phase!=='ready' || view.snapshot.revision===rootRevision) return false;
        const rows = await rootRows();
        return rows.count===59 && rows.conditionalSource==='form' && rows.open==='InspectOpen';
      }, 'dirty root catalogue includes settings storage and existing event');
      const root = await rootRows();
      assert.equal(root.autoTitle,false);
      assert.equal(root.grouping,ru?'Горизонтальная если возможно':'Horizontal if possible');
      assert.equal(root.scaling,ru?'Обычный':'Standard');
      assert.equal(root.scale,'110');
      assert.equal(root.storage,'SettingsStorage.ProbeFormSettings');
      assert.equal(view.selected.key.kind,'root');
      cases.push('dirty-form-root-settings-storage-and-scaling');

      for (const [id,xml] of [['ConditionalAppearance',appearance],['OnOpen',events],['SettingsStorage',stored]]) {
        await ui.evaluate(`document.querySelector('[data-palette-id="platform:${id}"]').dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
        await until(() => vscode.window.activeTextEditor?.document.uri.fsPath===file
          && vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection)===xml,
          'exact form source for '+id);
        main.panel.reveal();
      }
      cases.push('root-settings-and-events-navigate-to-existing-xml');
      await edit(original);
      await until(async () => {
        const rows = await rootRows();
        return view.phase==='ready' && rows.count===58 && rows.autoTitle && rows.scale==='100'
          && rows.storage===null && rows.open==='' && rows.conditionalSource==='absent';
      }, 'root palette defaults restored');
      cases.push('form-root-restores-defaults');
    } else {
      await select(view.snapshot.model.root);
      await until(() => view.palette?.identity.key.kind==='root' && view.palette.revision===view.snapshot.revision
        && view.palette.rows===null, 'earlier backend root catalogue unavailable');
      await until(() => ui.evaluate("!!document.querySelector('.form-properties [data-property-name=Title]') && !document.querySelector('[data-palette-id]')"), 'earlier API 1.41 root XML');
      cases.push('earlier-1.41-root-xml-fallback');
    }
    const button = group.children.find(node => node.name === 'Action');
    await select(button);
    await until(() => ui.evaluate("!!document.querySelector('[data-property-name=Title]') && !document.querySelector('[data-palette-id]')"), 'unverified context shows XML');
    await select(group);
    await until(() => ui.evaluate("document.querySelectorAll('[data-palette-id]').length===35"), 'selection returns to verified catalogue');
    cases.push('rapid-context-switch-and-raw-fallback');
  }
  assert.deepEqual(await fs.readFile(file),before);
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({passed:true,locale:vscode.env.language,cases,diskUnchanged:true}));
};
