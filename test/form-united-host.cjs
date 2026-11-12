const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const vscode = require('vscode');
const { until, frame, editFormSource, allocateFormViewport, sameSourcePath } = require('./webview-host.cjs');

const key = node => `${node.identity.source}:current:${node.identity.key.value}`;

function named(root, name) {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = named(child, name);
    if (found) return found;
  }
}

function measure(ui, keys) {
  return ui.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-element]')];
    const result = {};
    for (const [name, key] of Object.entries(${JSON.stringify(keys)})) {
      const element = items.find(item => item.dataset.element === key);
      if (!element) return null;
      const box = element.querySelector('.taxi-input').getBoundingClientRect();
      result[name] = {x:box.x,y:box.y,width:box.width,height:box.height};
    }
    return result;
  })()`);
}

const sameRow = boxes => Math.abs(boxes.A2.y - boxes.B2.y) <= 1;
const belowLeft = boxes => boxes.B2.y >= boxes.A2.y + boxes.A2.height;
const linuxGaps = {
  ColumnsFF:[60,60],ColumnsFT:[64,32],ColumnsTF:[60,92],ColumnsTT:[60,32],
  NestedFF:[60,60],NestedFT:[60,92],
};

function columnsMatch(boxes, united) {
  if (!boxes || boxes.A1.x !== boxes.B1.x) return false;
  if (united) return boxes.A2.x < boxes.B2.x && boxes.B1.width > boxes.A1.width;
  return boxes.A2.x === boxes.B2.x && boxes.A1.width === boxes.B1.width && boxes.A2.width === boxes.B2.width;
}

function verifyColumns(kind, boxes) {
  const united = kind === 'RowsT';
  assert.ok(columnsMatch(boxes, united), kind + ' native column partition');
  assert.equal(boxes.A1.y, boxes.A2.y);
  assert.equal(boxes.B1.y, boxes.B2.y);
  if (process.platform === 'linux') {
    const relative = Object.values(boxes).map(box => [box.x - boxes.A1.x, box.y - boxes.A1.y, box.width, box.height]);
    const expected = united
      ? [[0, 0, 131, 51], [216, 0, 151, 23], [0, 60, 367, 23], [395, 60, 101, 23]]
      : [[0, 0, 191, 51], [276, 0, 151, 23], [0, 60, 191, 23], [276, 60, 151, 23]];
    assert.deepEqual(relative, expected, kind + ' native field rectangles');
  }
}

async function verifyMixedRow(ui, view, document, original, keys) {
  const right = original.match(/<UsualGroup name="Right"[^>]*>[\s\S]+?<\/UsualGroup>/u)?.[0];
  const field = right?.match(/<InputField name="B1"[^>]*>[\s\S]+?<\/InputField>/u)?.[0];
  assert.ok(field, 'fixture has a standalone field to reuse beside the left group');
  const mixed = original.replace(right, field);
  const selection = { A1: keys.A1, A2: keys.A2, B1: keys.B1 };
  await editFormSource(document, view, mixed);
  await until(async () => {
    const boxes = await measure(ui, selection);
    return boxes && Math.abs(boxes.A1.y - boxes.B1.y) <= 2 && boxes.B1.y + boxes.B1.height < boxes.A2.y;
  }, 'a standalone field aligns with the first row of a separated group');
  await editFormSource(document, view, mixed.replace('<United>false</United>', '<United>true</United>'));
  await until(async () => {
    const boxes = await measure(ui, selection);
    return boxes && boxes.B1.y > boxes.A1.y + 2;
  }, 'a united group aligns as a single box');
}

async function editColumns(service, view, main, ui, keys, document) {
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'detached columns ready');
  const preview = view.frames.get('preview');
  const floating = await frame({ detached: true, state: { title: preview.panel.title } });
  const native = await floating.nativeWindow({ detached: true });
  assert.notEqual(native.targetId, workbench.targetId);
  await until(async () => columnsMatch(await measure(floating, keys), false), 'detached columns align');
  await floating.evaluate("globalThis.__columnElements = [...document.querySelectorAll('.taxi-element')];true");
  const revision = view.snapshot.revision;
  for (const [width, height] of [[430, 310], [960, 640]]) {
    await floating.evaluate(`Object.assign(document.querySelector('#root').style, {width:'${width}px',height:'${height}px'});true`);
    await floating.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await until(async () => columnsMatch(await measure(floating, keys), false), 'column tracks remain shared after resize');
    assert.equal(view.snapshot.revision, revision);
  }
  const setting = '<United>false</United>';
  const source = document.getText();
  const start = source.indexOf(setting, source.indexOf('<UsualGroup name="Left"'));
  assert.ok(start >= 0);
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(document.positionAt(start), document.positionAt(start + setting.length));
  edit.replace(document.uri, range, '<United>true</United>');
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await until(async () => columnsMatch(await measure(floating, keys), true), 'dirty United consumes one column track');
  assert.equal(await floating.evaluate('__columnElements.every(node => node.isConnected)'), true);
  await floating.screenshot('united-columns-dirty-' + vscode.env.language + '.png');
  await service.receive(view, preview, { type: 'dock' });
  await until(() => !view.frames.has('preview'), 'columns returned to workbench');
  await until(async () => columnsMatch(await measure(ui, keys), true), 'updated columns remain after return');
}

async function verifyMixedColumns(main, view, document) {
  const initial = document.getText();
  const title = value => `<Title><v8:item><v8:lang>en</v8:lang><v8:content>${value}</v8:content></v8:item></Title>`;
  const row = (id, caption) => `<UsualGroup name="Row${id}" id="${id}"><Group>AlwaysHorizontal</Group>
    <ShowTitle>false</ShowTitle><United>false</United><ChildItems>
      <InputField name="Ref${id}" id="${id + 1}"><DataPath>Partner</DataPath>${title(caption)}</InputField>
      <PictureField name="Status${id}" id="${id + 2}"><DataPath>Partner</DataPath><TitleLocation>None</TitleLocation>
        <Width>2</Width><Height>1</Height><HorizontalStretch>false</HorizontalStretch><VerticalStretch>false</VerticalStretch></PictureField>
      <LabelField name="Label${id}" id="${id + 3}"><DataPath>Partner</DataPath><TitleLocation>None</TitleLocation></LabelField>
    </ChildItems></UsualGroup>`;
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"
    xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">
    <CommandBarLocation>None</CommandBarLocation><ChildItems>
      <InputField name="Outer" id="1"><DataPath>Partner</DataPath>${title('An unrelated caption in the outer group')}</InputField>
      <UsualGroup name="Rows" id="2"><Group>Vertical</Group><ShowTitle>false</ShowTitle><ChildItems>
        ${row(10, 'Outgoing agreement')}${row(20, 'Incoming')}
      </ChildItems></UsualGroup>
    </ChildItems><Attributes><Attribute name="Partner" id="1">
      <Type><v8:Type>cfg:CatalogRef.Goods</v8:Type></Type>
    </Attribute></Attributes></Form>`;
  const ui = await frame({state:{title:main.panel.title}});
  const measure = () => ui.evaluate(`(() => {
    const box = (id, selector) => {
      const control = document.querySelector('[data-element$=":current:'+id+'"] '+selector);
      const rect = control?.getBoundingClientRect();
      return rect && {x:rect.left,width:rect.width,height:rect.height,right:rect.right};
    };
    return {frame:document.querySelector('.taxi-form-frame').getBoundingClientRect().width,
      outer:box(1,'.taxi-input'),first:box(11,'.taxi-input'),second:box(21,'.taxi-input'),
      picture:box(12,'.taxi-picture-field'),label:box(13,'.taxi-label-field')};
  })()`);
  try {
    await editFormSource(document, view, xml);
    await until(() => ui.evaluate("document.querySelectorAll('[data-united-flex-lane]').length === 2"), 'mixed rows rendered');
    await allocateFormViewport(ui, [480, 420]);
    let narrow;
    await until(async () => {
      narrow = await measure();
      return narrow.frame === 480 && narrow.first?.x === narrow.second?.x && narrow.outer?.x > narrow.first.x + 40;
    }, 'mixed rows have an independent shared caption column').catch(error => {
      throw new Error(JSON.stringify({phase:'mixed-caption-column',actual:narrow}), {cause:error});
    });
    assert.deepEqual([narrow.picture.width,narrow.picture.height], [20,18]);
    assert.ok(Math.abs(narrow.picture.x - narrow.first.right - 10) < .1);
    await allocateFormViewport(ui, [720, 420]);
    let wide;
    await until(async () => {
      wide = await measure();
      return wide.frame === 720 && wide.first.width > narrow.first.width + 60 && wide.label.width > narrow.label.width + 40;
    }, 'the input and label both receive free width');
    assert.equal(wide.picture.width, narrow.picture.width);
    assert.equal(wide.first.x, wide.second.x);
    await editFormSource(document, view, xml.replaceAll('<United>false</United>', '<United>true</United>'));
    await until(async () => {
      const boxes = await measure();
      return boxes.first.x > boxes.second.x + 15 && boxes.outer.x > boxes.first.x + 40;
    }, 'united mixed rows keep their own caption widths');
    return {kind:'MixedFields', narrow, wide};
  } finally {
    ui.close();
    await editFormSource(document, view, initial);
  }
}

async function verifyUnitedRowHeight(main, view, document, { A1, A2 }) {
  const original = document.getText();
  const footer = '<InputField name="Footer" id="19"><DataPath>Name</DataPath><TitleLocation>None</TitleLocation></InputField>';
  const capped = original.replace('<Height>2</Height><MultiLine>true</MultiLine>',
    '<MultiLine>true</MultiLine><AutoMaxHeight>false</AutoMaxHeight><MaxHeight>4</MaxHeight>');
  const xml = capped.replace('</ChildItems><Attributes>', `${footer}</ChildItems><Attributes>`);
  const ui = await frame({ state: { title: main.panel.title } });
  try {
    await editFormSource(document, view, xml);
    const keys = { A1, A2, Footer: key(named(view.snapshot.model.root, 'Footer')) };
    const resize = async (height, matches, message) => {
      await allocateFormViewport(ui, [720, height]);
      let boxes;
      await until(async () => {
        boxes = await measure(ui, keys);
        return boxes && matches(boxes);
      }, message).catch(error => { throw new Error(`${message}: ${JSON.stringify(boxes)}`, {cause:error}); });
      return boxes;
    };
    const tall = await resize(400, boxes => boxes.A1.height === 80 && boxes.Footer.y - boxes.A2.y > 60,
      'the multiline field reaches its height limit');
    const short = await resize(100, boxes => boxes.A1.height === 51 && boxes.A2.y + boxes.A2.height <= boxes.Footer.y,
      'united columns shrink without overlapping the footer');
    return { kind: 'UnitedRowHeight', tall, short };
  } finally {
    ui.close();
    await editFormSource(document, view, original);
  }
}

async function verifyDateBlock(main, view, document) {
  const original = document.getText();
  const source = await fs.readFile(path.join(process.env.ESKA_FORM_FIXTURES, 'DateBlock.xml'), 'utf8');
  const ui = await frame({ state: { title: main.panel.title } });
  const measure = () => ui.evaluate(`(() => {
    const frame = document.querySelector('.taxi-form-frame'), bounds = frame.getBoundingClientRect();
    const find = id => frame.querySelector('[data-element$=":current:' + id + '"]');
    const block = find(5)?.getBoundingClientRect();
    if (!block) return null;
    const fields = [51, 52].map(id => {
      const row = find(id).querySelector('.taxi-field-row');
      const input = row.querySelector('.taxi-input').getBoundingClientRect();
      return { x:input.x-bounds.x, y:input.y-bounds.y, width:input.width, title:row.dataset.titleLocation };
    });
    return { width:bounds.width, block:[block.width,block.height], fields,
      lines:find(53).querySelectorAll('.taxi-field-caption-line').length || 1,
      columns:[81,82].map(id => find(id)?.getBoundingClientRect().width),
      divider:!!frame.querySelector('.taxi-column-divider') };
  })()`);
  async function observe(width, matches, description) {
    await allocateFormViewport(ui, [width, 260]);
    let state, previous, stable = 0;
    await until(async () => {
      state = await measure();
      const serialized = JSON.stringify(state);
      stable = serialized === previous ? stable + 1 : 0;
      previous = serialized;
      return stable >= 2 && state?.width === width && matches(state);
    }, description).catch(error => { throw new Error(`${description}: ${JSON.stringify(state)}`, { cause: error }); });
    return state;
  }
  const dateValues = state => state.fields.every(field => field.width === 181)
    && state.fields[0].x === state.fields[1].x;
  try {
    await editFormSource(document, view, source);
    const wide = await observe(654, state => dateValues(state) && Math.abs(state.fields[0].x - 175) <= 1
      && state.fields[1].y === 78 && state.lines === 1 && state.block[0] === 604, 'full date block');
    const wrapped = await observe(604, state => dateValues(state) && Math.abs(state.fields[0].x - wide.fields[0].x) <= 1
      && state.fields[1].y === wide.fields[1].y && state.lines === 2 && state.block[0] === 570, 'checkbox wraps below the date baseline');
    const top = await observe(384, state => dateValues(state) && state.fields.every(field => field.title === 'Top')
      && state.fields[0].x === 18 && state.fields[1].y === 114 && state.lines === 3, 'automatic date titles move above');
    await editFormSource(document, view, source.replace('<United>false</United>', '<United>true</United>'));
    await observe(654, state => state.fields[0].x !== state.fields[1].x && state.fields.every(field => field.title === 'Left'),
      'united row keeps its own title column');
    await editFormSource(document, view, source);
    await observe(654, state => dateValues(state) && state.lines === 1 && state.block[0] === 604, 'wide date block restored');

    const contents = /<ChildItems>([\s\S]*?)<\/ChildItems>(?=\s*<Attributes>)/u.exec(source);
    assert.ok(contents, 'fixture contains the date block');
    const group = (name, id, body) => `<UsualGroup name="${name}" id="${id}"><Group>Vertical</Group>
      <United>true</United><ShowTitle>false</ShowTitle><HorizontalStretch>true</HorizontalStretch><ChildItems>${body}</ChildItems></UsualGroup>`;
    const textField = (kind, id) => `<${kind} name="Value${id}" id="${id}"><DataPath>Text</DataPath><TitleLocation>None</TitleLocation></${kind}>`;
    const pair = `<UsualGroup name="Pair" id="80"><Group>AlwaysHorizontal</Group><ShowTitle>false</ShowTitle><ChildItems>
      ${group('Left', 81, textField('InputField', 91))}${group('Right', 82, contents[1] + textField('LabelField', 92))}</ChildItems></UsualGroup>`;
    const text = '<Attribute name="Text" id="5"><Type><v8:Type>xs:string</v8:Type><v8:StringQualifiers>'
      + '<v8:Length>210</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers></Type></Attribute>';
    await editFormSource(document, view, source.replace(contents[0], `<ChildItems>${pair}</ChildItems>`)
      .replace('<Attributes>', '<Attributes>' + text).replace('<Width>62</Width>', '<Width>125</Width>'));
    const pairWide = await observe(1284, state => dateValues(state) && !state.divider && state.block[0] === 604, 'paired columns fit');
    const pairNarrow = await observe(920, state => dateValues(state) && state.divider && state.block[0] < pairWide.block[0]
      && state.columns.every((width, index) => width < pairWide.columns[index]), 'both columns and the date block contract');
    await observe(1284, state => !state.divider && state.block[0] === 604
      && state.columns.every((width, index) => width === pairWide.columns[index]), 'paired columns restore their widths');
    return { kind: 'DateBlock', wide, wrapped, top, pairWide, pairNarrow };
  } finally {
    ui.close();
    await editFormSource(document, view, original);
  }
}

async function verifyDateLabelHeight(main, view, document) {
  const directory = process.env.ESKA_FORM_FIXTURES;
  const source = await fs.readFile(path.join(directory, 'DateLabelHeight.xml'), 'utf8');
  const { sourceSha256, cases, widthCases } = JSON.parse(await fs.readFile(path.join(directory, 'date-label-height-metrics.json'), 'utf8'));
  assert.equal(createHash('sha256').update(source).digest('hex'), sourceSha256);
  const original = document.getText();
  const ui = await frame({ state: { title: main.panel.title } });
  const measure = `(() => {
    const root = document.querySelector('.taxi-form-frame');
    if (!root?.closest('[data-form-layout=allocated]')) return null;
    const find = id => root.querySelector('[data-element$=":current:' + id + '"]');
    const group = find(5)?.querySelector('.taxi-group'), limit = find(54)?.querySelector('.taxi-label-field');
    const tail = find(200)?.querySelector('.taxi-input');
    if (!group || !limit || !tail) return null;
    const frame = root.getBoundingClientRect(), value = limit.getBoundingClientRect(), last = tail.getBoundingClientRect();
    const dateOrigins = [51, 52].map(id => {
      const input = find(id)?.querySelector('.taxi-input')?.getBoundingClientRect();
      return input ? [input.x - frame.x, input.y - frame.y] : null;
    });
    return {
      dateOrigins,
      frame: [frame.width, frame.height],
      preferredHeight: parseFloat(root.style.getPropertyValue('--taxi-form-preferred-height')),
      groupHeight: group.classList.contains('taxi-group--painted') ? group.getBoundingClientRect().height : null,
      titleLocation: limit.closest('.taxi-field-row').dataset.titleLocation,
      limitValue: [value.y - frame.y, value.height],
      tail: [last.x - frame.x, last.y - frame.y, last.width, last.height],
    };
  })()`;
  const sizes = [];
  try {
    for (const sample of [...cases, ...widthCases, cases[0]]) {
      const resized = source.replace('<Width>62</Width>', '<Width>' + sample.width + '</Width>');
      const xml = sample.painted ? resized : resized.replace('<BackColor>web:LightGoldenRodYellow</BackColor>', '');
      await editFormSource(document, view, xml);
      await until(() => ui.evaluate("!!document.querySelector('[data-element$=\":current:200\"] .taxi-input')"), 'field after the date block');
      await allocateFormViewport(ui, sample.frame);
      const expected = {
        frame: sample.frame, preferredHeight: sample.frame[1], groupHeight: sample.groupHeight,
        titleLocation: sample.titleLocation, limitValue: sample.limitValue, tail: sample.tail,
      };
      let actual, stable = 0;
      await until(async () => {
        actual = await ui.evaluate(measure);
        const { dateOrigins, ...layout } = actual ?? {};
        const matchDates = !sample.dateOrigins || sample.dateOrigins.every(([x, y], index) => {
          const origin = dateOrigins?.[index];
          return origin?.[1] === y && (sample.pendingHorizontal || origin[0] === x);
        });
        stable = isDeepStrictEqual(layout, expected) && matchDates ? stable + 1 : 0;
        return stable >= 2;
      }, 'date label layout ' + sample.name).catch(error => {
        throw new Error('Date label height ' + sample.name + ' ' + JSON.stringify({ expected, actual }), { cause: error });
      });
      sizes.push({ name: sample.name, ...actual });
    }
    return { kind: 'DateLabelHeight', sizes };
  } finally {
    ui.close();
    await editFormSource(document, view, original);
  }
}

async function verifyColumnSurplus(service, main, view, document) {
  const directory = process.env.ESKA_FORM_FIXTURES;
  const { fixtures } = JSON.parse(await fs.readFile(path.join(directory, 'column-surplus-metrics.json'), 'utf8'));
  const original = document.getText();
  const ui = await frame({ state: { title: main.panel.title } });
  const measure = surface => surface.evaluate(`(() => {
    const form = document.querySelector('.taxi-form-frame');
    if (!form?.closest('[data-form-layout=allocated]')) return null;
    const frame = form.getBoundingClientRect();
    const find = id => form.querySelector('[data-element$=":current:' + id + '"]');
    const box = element => {
      const rect = element?.getBoundingClientRect();
      return rect ? [rect.x - frame.x, rect.width] : null;
    };
    const dateFields = [41, 42].map(id => {
      const row = find(id)?.querySelector('.taxi-field-row');
      const rect = row?.querySelector('.taxi-input')?.getBoundingClientRect();
      return rect ? [row.dataset.titleLocation, rect.x - frame.x, rect.y - frame.y] : null;
    });
    const caption = find(44)?.querySelector('.taxi-field-label');
    const checkCaption = caption ? [...box(caption), caption.querySelectorAll('.taxi-field-caption-line').length || 1] : null;
    const labelRow = find(43)?.querySelector('.taxi-field-row');
    const label = labelRow?.querySelector('.taxi-label-field');
    const labelRect = label?.getBoundingClientRect();
    const dateLabel = labelRect ? {
      location: labelRow.dataset.titleLocation, background: getComputedStyle(label).backgroundColor, valueText: label.textContent,
      control: [labelRect.x - frame.x, labelRect.y - frame.y, labelRect.width, labelRect.height],
    } : null;
    const divider = form.querySelector('.taxi-column-divider');
    const throughFields = [[1051, '.taxi-input'], [1071, '.taxi-input'], [1072, '.taxi-picture-field'], [1073, '.taxi-label-field']];
    const through = throughFields.map(([id, selector]) => box(find(id)?.querySelector(selector)));
    const referenceLabel = find(1051)?.querySelector('.taxi-field-label');
    const referenceCaption = through[0] && referenceLabel
      ? [through[0][0] - box(referenceLabel)[0], referenceLabel.querySelectorAll('.taxi-field-caption-line').length || 1] : null;
    const referenceLabelFits = referenceCaption
      && box(referenceLabel)[1] + parseFloat(getComputedStyle(referenceLabel.parentElement).columnGap) <= referenceCaption[0];
    const dates = find(40), court = find(1051)?.querySelector('.taxi-input');
    const dateBlock = box(dates), trace = box(find(1091)?.querySelector('.taxi-input'));
    return { width: frame.width, height: frame.height,
      preferredHeight: parseFloat(form.style.getPropertyValue('--taxi-form-preferred-height')),
      dateBlockHeight: dates?.getBoundingClientRect().height ?? null,
      courtTop: court ? court.getBoundingClientRect().y - frame.y : null,
      columns: [10, 20].map(id => box(find(id))),
      inputs: [11, 21].map(id => box(find(id)?.querySelector('.taxi-input'))),
      dateBlock, dateBlockWidth: dateBlock?.[1], traceOffset: trace && dateBlock && trace[0] - dateBlock[0],
      dateFields, dateLocations: dateFields.map(field => field?.[0]), checkCaption, dateLabel, divider: !!divider,
      dividerRange: divider && ['min', 'now', 'max'].map(name => Number(divider.getAttribute('aria-value' + name))),
      through, referenceCaption, referenceLabelFits };
  })()`);
  async function observe(surface, file, { width, viewportWidth = width, viewportHeight = 420,
    columns, inputs, dateBlock = null, dateBlockWidth, traceOffset, dateFields, dateLocations,
    checkCaption, dateLabel, referenceRow, referenceCaption, divider, height, dateBlockHeight, courtTop }) {
    const revision = view.snapshot.revision;
    await allocateFormViewport(surface, [viewportWidth, viewportHeight]);
    const expected = { width, divider };
    if (columns) Object.assign(expected, { columns, inputs, dateBlock });
    if (dateBlockWidth !== undefined) expected.dateBlockWidth = dateBlockWidth;
    if (height !== undefined) Object.assign(expected, { height, preferredHeight: height });
    if (dateBlockHeight !== undefined) expected.dateBlockHeight = dateBlockHeight;
    if (courtTop !== undefined) expected.courtTop = courtTop;
    if (traceOffset !== undefined) expected.traceOffset = traceOffset;
    if (dateFields) expected.dateFields = dateFields;
    if (dateLocations) expected.dateLocations = dateLocations;
    if (checkCaption) expected.checkCaption = checkCaption;
    if (dateLabel) expected.dateLabel = dateLabel;
    if (referenceRow) expected.through = referenceRow;
    if (referenceCaption) {
      expected.referenceCaption = referenceCaption;
      if (referenceCaption[1] > 1) expected.referenceLabelFits = true;
    }
    const keys = Object.keys(expected);
    const description = `${file} matches the native preview at ${width}px`;
    let actual, stable = 0;
    await until(async () => {
      actual = await measure(surface);
      stable = keys.every(key => isDeepStrictEqual(actual?.[key], expected[key])) ? stable + 1 : 0;
      return stable >= 2;
    }, description).catch(error => { throw new Error(`${description}: ${JSON.stringify({ expected, actual })}`, { cause: error }); });
    assert.equal(view.snapshot.revision, revision);
    return actual;
  }

  async function verifyDateStretch(surface, file, source) {
    const { sourceSha256, cases } = JSON.parse(await fs.readFile(path.join(directory, 'date-through-stretch-metrics.json'), 'utf8'));
    assert.equal(createHash('sha256').update(source).digest('hex'), sourceSha256);
    const geometry = sample => ({
      width: sample.frame[0], viewportHeight: sample.frame[1], height: sample.frame[1], divider: true,
      dateBlockHeight: sample.dateBlock[3], courtTop: sample.courtTop,
    });
    const sizes = [];
    for (const { width, auto, fixed } of cases) {
      const sized = source.replace('  <AutoCommandBar name="FormCommandBar"', `  <Width>${width}</Width>\n$&`);
      const fixedSource = sized.replace('<UsualGroup name="Dates" id="40">', '$&<HorizontalStretch>false</HorizontalStretch>');
      assert.notEqual(sized, source);
      assert.notEqual(fixedSource, sized);
      await editFormSource(document, view, sized);
      const automatic = await observe(surface, file, geometry(auto));
      await editFormSource(document, view, fixedSource);
      const packed = await observe(surface, file, { ...geometry(fixed), dateBlockWidth: fixed.dateBlock[2] });
      assert.equal(packed.dateBlock[0], automatic.dateBlock[0], 'fixed dates keep their leading edge');
      assert.ok(Math.abs(packed.dateBlock[0] - fixed.dateBlock[0]) <= 1, 'the date block starts at the native column edge');
      assert.ok(packed.dateBlockWidth < automatic.dateBlockWidth, 'date block stops at its packed width');
      assert.deepEqual(packed.columns, automatic.columns, 'the two columns retain their widths');
      assert.deepEqual(packed.through, automatic.through, 'sibling references, picture and label keep their own allocation');
      assert.equal(packed.traceOffset, automatic.traceOffset, 'service fields retain the common edge');
      await editFormSource(document, view, sized);
      const restored = await observe(surface, file, { ...geometry(auto), dateBlockWidth: automatic.dateBlockWidth });
      assert.deepEqual(restored.through, automatic.through);
      sizes.push({ width: fixed.frame[0], automatic, packed });
    }
    await editFormSource(document, view, source);
    return sizes;
  }

  async function verifyThroughEnd(surface, width) {
    const revision = view.snapshot.revision;
    await until(async () => {
      const state = await measure(surface);
      return state?.width === width && state.divider;
    }, 'the mixed columns and their divider are visible');
    await surface.evaluate(`document.querySelector('.taxi-column-divider').dispatchEvent(
      new KeyboardEvent('keydown', {key:'End', bubbles:true}));true`);
    let endpoint;
    await until(async () => {
      endpoint = await measure(surface);
      const range = endpoint?.dividerRange;
      return range && range[1] === range[2] && endpoint.columns[0][1] === range[2];
    }, 'the divider stops at the shared date and trailing controls minimum');
    assert.equal(endpoint.width, width);
    const [court, reference, picture, label] = endpoint.through;
    const rightEdge = ([x, width]) => x + width;
    assert.ok(Math.abs(rightEdge(endpoint.dateBlock) - rightEdge(reference)) <= 1);
    assert.equal(rightEdge(court), rightEdge(reference));
    assert.equal(picture[0], rightEdge(reference) + 10);
    assert.equal(label[0], rightEdge(picture) + 10);
    assert.ok(rightEdge(label) <= rightEdge(endpoint.columns[1]));
    assert.equal(view.snapshot.revision, revision);
    return endpoint;
  }

  const results = [];
  try {
    for (const { file, sourceSha256, cases, leftTitles, titleVariants, through, throughVariants } of fixtures) {
      const source = await fs.readFile(path.join(directory, file), 'utf8');
      assert.equal(createHash('sha256').update(source).digest('hex'), sourceSha256);
      await editFormSource(document, view, source);
      await ui.evaluate('document.fonts.ready.then(()=>true)');
      const sizes = [];
      for (const entry of [...cases, cases[0]]) sizes.push(await observe(ui, file, entry));
      const result = { file, sizes };
      results.push(result);

      if (!cases.at(-1).dateBlock) continue;
      const workbench = await ui.nativeWindow();
      await service.receive(view, main, { type: 'detach' });
      await until(() => view.frames.get('preview')?.ready, 'detached bounded columns ready');
      const preview = view.frames.get('preview');
      const floating = await frame({ detached: true, state: { title: preview.panel.title } });
      try {
        assert.notEqual((await floating.nativeWindow({ detached: true })).targetId, workbench.targetId);
        const wide = cases.at(-1);
        const dateTitles = locations => source.replace(/<(?:InputField|LabelField) name="(Stamp|Settlement|Limit)" id="\d+">/gu,
          (opening, name) => {
            const location = typeof locations === 'string' ? locations : locations[name];
            return location ? `${opening}<TitleLocation>${location}</TitleLocation>` : opening;
          });
        if (leftTitles) {
          const mixed = cases.find(entry => entry.dateFields?.[0][0] === 'Top' && entry.dateFields[1][0] === 'Left');
          assert.ok(mixed);
          const forced = dateTitles('Left');
          assert.notEqual(forced, source);
          await observe(floating, file, mixed);
          await editFormSource(document, view, forced);
          await observe(floating, file, leftTitles);
          await editFormSource(document, view, source);
          await observe(floating, file, mixed);
        }
        if (titleVariants) {
          for (const { locations, caption, rightWidth, labelProperties, cases: poses } of titleVariants) {
            let variant = dateTitles(locations);
            assert.notEqual(variant, source);
            if (caption) {
              assert.ok(variant.includes(caption[0]));
              variant = variant.replaceAll(...caption);
            }
            if (rightWidth) variant = variant.replace('<Width>39</Width>', `<Width>${rightWidth}</Width>`);
            if (labelProperties) {
              const field = '<LabelField name="Limit" id="43">';
              assert.ok(variant.includes(field));
              variant = variant.replace(field, field + labelProperties);
            }
            await editFormSource(document, view, variant);
            for (const pose of [...poses, poses[0]]) await observe(floating, file, pose);
          }
          await editFormSource(document, view, source);
        }
        if (throughVariants) {
          result.throughVariants = [];
          for (const { hideServices, traceWidth, topTitles, leftTitles, courtCaption, tailWidth, cases: poses } of throughVariants) {
            let variant = leftTitles ? dateTitles('Left') : topTitles ? dateTitles('Top') : source;
            if (hideServices) variant = variant.replace('<UsualGroup name="Services" id="1089">', '$&<Visible>false</Visible>');
            if (courtCaption) variant = variant.replaceAll('Исполнительное производство', courtCaption);
            if (traceWidth) variant = variant.replace('<InputField name="Trace" id="1091">', `$&<Width>${traceWidth}</Width>`);
            if (tailWidth) variant = variant.replace(/<LabelField name="(?:Outgoing|Incoming)Org" id="\d+">/gu, `$&<Width>${tailWidth}</Width>`);
            assert.notEqual(variant, source);
            await editFormSource(document, view, variant);
            const resized = [];
            for (const pose of [...poses, poses[0]]) resized.push(await observe(floating, file, pose));
            result.throughVariants.push({ hideServices, traceWidth, topTitles, leftTitles, courtCaption, tailWidth, resized });
          }
          await editFormSource(document, view, source);
          await observe(floating, file, cases[1]);
        }
        if (through) result.fixedDateStretch = await verifyDateStretch(floating, file, source);
        await observe(floating, file, wide);
        await floating.evaluate("globalThis.__boundedGroup = document.querySelector('[data-element$=\":current:10\"] > .taxi-group'); true");
        await editFormSource(document, view, source.replace('web:Lavender', 'web:LightYellow'));
        await until(() => floating.evaluate("__boundedGroup.isConnected && getComputedStyle(__boundedGroup).backgroundColor === 'rgb(255, 255, 224)'"),
          'dirty group styling applied in place');
        await observe(floating, file, wide);
        await observe(floating, file, cases[0]);
        if (!through) await floating.screenshot('united-column-surplus-' + vscode.env.language + '.png');
        if (through) {
          const endpoint = await verifyThroughEnd(floating, cases[0].width);
          result.end = endpoint;
          await floating.screenshot('united-date-through-end-' + vscode.env.language + '.png');
          await observe(floating, file, wide);
          const restored = await observe(floating, file, cases[0]);
          assert.deepEqual(restored.dividerRange, endpoint.dividerRange);

          await editFormSource(document, view, dateTitles('Top'));
          await allocateFormViewport(floating, [584, 760]);
          const top = await verifyThroughEnd(floating, 584);
          assert.equal(top.columns[1][1], 432);
          assert.equal(top.dateBlockWidth, 328);
          assert.ok(top.dateFields.every(([location]) => location === 'Top'));
          result.topEnd = top;
          await editFormSource(document, view, source);
          await observe(floating, file, wide);
        }
        const compact = cases.find(entry => entry.width === 774 && entry.checkCaption?.[2] === 2);
        if (compact) {
          const before = await observe(floating, file, compact);
          const revision = view.snapshot.revision;
          await floating.dragHorizontally('.taxi-column-divider', 40);
          await until(async () => {
            const manual = await measure(floating);
            return manual?.columns[0][1] === before.columns[0][1] + 40 && manual.checkCaption?.[2] === 3;
          }, 'manual division recalculates the wrapped date block from the chosen width');
          assert.equal(view.snapshot.revision, revision);

          await editFormSource(document, view, dateTitles({ Settlement: 'Top' }));
          await allocateFormViewport(floating, [574, 420]);
          let partial;
          await until(async () => {
            partial = await measure(floating);
            return partial?.width === 574 && partial.dateLabel?.location === 'Left' && partial.dateFields[1][0] === 'Top';
          }, 'the transition keeps the date label at the side while the date input is above');
          const partialRevision = view.snapshot.revision;
          const left = partial.columns[0][1];
          const delta = left > 105 ? -5 : 5;
          await floating.dragHorizontally('.taxi-column-divider', delta);
          await until(async () => {
            const next = await measure(floating);
            return next?.columns[0][1] === left + delta && next.dateLabel?.location === 'Left'
              && next.checkCaption[1] !== partial.checkCaption[1];
          }, 'dragging through the transition updates the side label and checkbox tracks');
          assert.equal(view.snapshot.revision, partialRevision);
          await editFormSource(document, view, source);
        }
      } finally {
        floating.close();
        await service.receive(view, preview, { type: 'dock' });
        await until(() => !view.frames.has('preview'), 'bounded columns returned to workbench');
      }
      await until(() => ui.evaluate("!!document.querySelector('.preview-scroll')"), 'docked bounded columns rendered');
      await observe(ui, file, cases.at(-1));
    }
    return { kind: 'ColumnSurplus', fixtures: results };
  } finally {
    ui.close();
    await editFormSource(document, view, original);
  }
}

exports.run = async () => {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const service = explorer.formPreview;
  const results = [];
  let widths;
  for (const input of fixture.formGallery) {
    const before = await fs.readFile(input.path);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(input.path));
    await vscode.window.showTextDocument(document, { preview:false, viewColumn:vscode.ViewColumn.One });
    await vscode.commands.executeCommand('eska.explorer.previewForm');
    await until(() => [...service.views.values()].some(view => sameSourcePath(view.path,input.path) && view.phase === 'ready'), input.kind);
    const view = [...service.views.values()].find(view => sameSourcePath(view.path,input.path));
    const main = view.frames.get('main');
    const root = view.snapshot.model.root;
    const keys = Object.fromEntries(['A1','A2','B1','B2'].map(name => [name,key(named(root,name))]));
    const ui = await frame({ fixedFormArea:true,state:{title:main.panel.title} });
    await until(async () => !!await measure(ui,keys), input.kind+' rendered');
    await ui.evaluate('document.fonts.ready.then(()=>true)');
    await until(() => ui.evaluate("document.querySelector('.taxi-preview')?.dataset.preferredX === 'true'"),input.kind+' preferred width');
    const boxes = await measure(ui,keys);
    if (input.kind === 'RowsF' || input.kind === 'RowsT') {
      verifyColumns(input.kind, boxes);
      results.push({ kind: input.kind, boxes });
      if (input.kind === 'RowsF') {
        await editColumns(service, view, main, ui, keys, document);
        if (process.platform === 'linux') results.push(await verifyMixedColumns(main, view, document));
      }
      assert.deepEqual(await fs.readFile(input.path), before);
      main.panel.dispose();
      await until(() => service.views.size === 0, input.kind + ' released');
      await Promise.all([...service.closing]);
      continue;
    }
    assert.ok(Math.abs(boxes.A1.y - boxes.B1.y) <= 2, input.kind + ' first row');
    if (['ColumnsFF','NestedFF'].includes(input.kind)) assert.ok(sameRow(boxes),input.kind);
    else if (['ColumnsTF','NestedFT'].includes(input.kind)) assert.ok(belowLeft(boxes),input.kind);
    else assert.ok(boxes.B2.y < boxes.A2.y,input.kind);
    const currentWidths = [boxes.A1.width,boxes.A2.width,boxes.B1.width,boxes.B2.width];
    widths ??= currentWidths;
    assert.deepEqual(currentWidths,widths,input.kind+' preserves natural column widths');
    const leftGap = boxes.A2.y-boxes.A1.y, rightGap = boxes.B2.y-boxes.B1.y;
    const horizontalGap = boxes.B1.x-boxes.A1.x;
    if (process.platform === 'linux') {
      assert.deepEqual([leftGap,rightGap],linuxGaps[input.kind],input.kind+' native row distances');
      assert.equal(horizontalGap,349,input.kind+' native column offset');
      assert.deepEqual(currentWidths,[151,151,191,191],input.kind+' native input widths');
    }
    results.push({kind:input.kind,leftGap,rightGap,horizontalGap,widths:currentWidths});
    if (input.kind === 'ColumnsTT' && process.platform === 'linux') {
      results.push(await verifyUnitedRowHeight(main, view, document, keys));
      results.push(await verifyDateBlock(main, view, document));
      results.push(await verifyDateLabelHeight(main, view, document));
      results.push(await verifyColumnSurplus(service, main, view, document));
    }
    if (input.kind === 'ColumnsFF') {
      const left = key(named(root,'Left'));
      await ui.evaluate(`document.getElementById(${JSON.stringify('form-row-'+left)}).click()`);
      await until(() => ui.evaluate(`document.querySelector('[data-palette-id="platform:United"] input')?.checked===false`), 'false in property palette');
      const mainWindow = await ui.nativeWindow();
      await ui.evaluate("document.querySelectorAll('.form-toolbar > button')[2].click()");
      await until(() => view.frames.get('preview')?.ready,'detached view ready');
      const preview = view.frames.get('preview');
      const floating = await frame({detached:true,state:{title:preview.panel.title}});
      const native = await floating.nativeWindow({detached:true});
      assert.notEqual(native.targetId,mainWindow.targetId);
      await until(async () => { const value=await measure(floating,keys); return value && sameRow(value); },'aligned in separate window');
      await floating.evaluate("globalThis.__unitedNodes=[...document.querySelectorAll('.taxi-element')];true");
      const initialRevision = view.snapshot.revision;
      for (const [width,height] of [[460,300],[920,640]]) {
        await floating.evaluate(`Object.assign(document.querySelector('#root').style,{width:'${width}px',height:'${height}px'});true`);
        await floating.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
        await until(async () => { const value=await measure(floating,keys); return value && sameRow(value); },'rows share after resize');
        assert.equal(view.snapshot.revision,initialRevision);
      }
      const text = document.getText(), setting = '<United>false</United>', at = text.indexOf(setting);
      assert.ok(at >= 0);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(at),document.positionAt(at+setting.length)), '<United>true</United>');
      assert.equal(await vscode.workspace.applyEdit(edit),true);
      await until(async () => { const value=await measure(floating,keys); return value && belowLeft(value); },'dirty United in floating window');
      await until(() => ui.evaluate(`document.querySelector('[data-palette-id="platform:United"] input')?.checked===true`), 'true in main property palette');
      assert.equal(await floating.evaluate("__unitedNodes.every(node=>node.isConnected)"),true);
      await floating.screenshot('united-dirty-floating-'+vscode.env.language+'.png');
      preview.panel.dispose();
      main.panel.reveal();
      await verifyMixedRow(ui, view, document, before.toString('utf8'), keys);
    }
    assert.deepEqual(await fs.readFile(input.path),before);
    main.panel.dispose();
    await until(() => service.views.size === 0,input.kind+' released');
    await Promise.all([...service.closing]);
  }
  await explorer.shutdown();
  await fs.writeFile(path.join(fixture.root,'host-result.json'),JSON.stringify({
    passed:true,locale:vscode.env.language,results,dirtyDetached:true,sourceWritesDuringViewing:false,
  }));
};
