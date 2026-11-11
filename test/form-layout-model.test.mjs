import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayedInPreview, stretches, sharesGroupLabels, stretchWeight, controlBounds, formAllocation, atPreferredAxis, groupPreferredSize, allocateLaneSizes, laneInputBounds, horizontalInputMaximum, pictureFieldStyle } from '../webview/forms/layout-model.mjs';
import { textLabelMetrics } from '../webview/forms/model.mjs';
import { allocatedSurfaceMetrics } from '../webview/forms/surface-allocation.mjs';
import { narrowCaptionTracks } from '../webview/forms/caption-track-model.mjs';
import { narrowInputLaneWidths } from '../webview/forms/input-lane-model.mjs';
import { fieldCaptionLines, fieldCaptionOccupiedWidth, fieldCaptionProfile } from '../webview/forms/font-metrics.mjs';
import { isolatedInputCaptionWidth } from '../webview/forms/field-caption-layout.js';
const property=(name,text)=>({key:{namespace:'http://v8.1c.ru/8.3/xcf/logform',name},value:{kind:'text',text:String(text)}});
const node=(kind,properties={},children=[])=>({key:kind,kind,properties:Object.entries(properties).map(([name,value])=>property(name,value)),children,
  presentation:{displayed:true,valueType:{kind:'string'},font:{points:10,weight:400}}});

test('Auto stretch follows field types and descendants while an explicit No stops at the group',()=>{
  const input=node('InputField'), table=node('Table'), fixed=node('UsualGroup',{HorizontalStretch:false,VerticalStretch:false},[table]);
  assert.equal(stretches(input,'x'),true);assert.equal(stretches(input,'y'),false);
  input.presentation.valueType.kind='number';assert.equal(stretches(input,'x'),false);
  assert.equal(stretches(node('InputField',{Height:3}),'y'),true);
  assert.equal(stretches(node('InputField',{MultiLine:true}),'y'),true);
  assert.equal(stretches(node('InputField',{MultiLine:true,Height:1}),'y'),false);
  assert.equal(stretches(node('InputField',{MultiLine:true,VerticalStretch:false}),'y'),false);
  assert.equal(stretches(node('InputField',{MultiLine:true,HorizontalStretch:false}),'y'),false);
  assert.equal(stretches(node('Pages',{},[node('Page',{},[table])]),'y'),true);
  assert.equal(stretches(fixed,'x'),false);assert.equal(stretches(fixed,'y'),false);
  assert.equal(stretches(node('UsualGroup',{},[fixed]),'x'),false);
  assert.equal(stretches(node('UsualGroup',{},[table]),'y',{UsualGroup:true}),false);
  table.presentation.displayed=false;assert.equal(stretches(node('Page',{},[table]),'x'),false);
});

test('a label with a union of reference types stretches automatically unless fixed', () => {
  const namespace = 'http://v8.1c.ru/8.1/data/enterprise/current-config';
  const type = { kind:'composite', types:[
    { namespace, name:'CatalogRef.Goods' }, { namespace, name:'DocumentRef.Order' },
  ] };
  const automatic = node('LabelField'), fixed = node('LabelField', { HorizontalStretch:false });
  automatic.presentation.valueType = fixed.presentation.valueType = type;
  assert.equal(stretches(automatic, 'x'), true);
  assert.equal(stretches(fixed, 'x'), false);
});

test('a picture with manual limits at its authored dimensions does not stretch by default', () => {
  const dimensions = { Width:2, Height:1, AutoMaxWidth:false, MaxWidth:2, AutoMaxHeight:false, MaxHeight:1 };
  const field = node('PictureField', dimensions);
  assert.equal(stretches(field,'x'), false);
  assert.equal(stretches(field,'y'), false);
  assert.equal(stretches(node('PictureField', { ...dimensions, MaxHeight:3 }),'y'), true);
  assert.equal(stretches(node('PictureField', { ...dimensions, VerticalStretch:true }),'y'), true);
});

test('an exposed child can continue an explicit through-aligned column', () => {
  const group = (properties, united) => {
    const child = node('UsualGroup',properties);
    child.presentation.united = united;
    return child;
  };
  assert.equal(sharesGroupLabels(group({},false),true), true);
  assert.equal(sharesGroupLabels(group({},false)), false);
  assert.equal(sharesGroupLabels(group({},true),true), false);
  assert.equal(sharesGroupLabels(group({ThroughAlign:'DontUse'},false),true), false);
  assert.equal(sharesGroupLabels(group({HorizontalStretch:false},false),true), false);
  assert.equal(sharesGroupLabels(group({Representation:'NormalSeparation'},false),true), false);
});

test('groups without rendered descendants retain their source nodes but allocate no preview space', () => {
  const hidden = node('InputField');hidden.presentation.displayed = false;
  const hiddenTable = node('Table');hiddenTable.auxiliary = [node('AutoCommandBar', { Autofill: false })];
  const nested = node('UsualGroup', {}, [node('UsualGroup', {}, [hidden])]);
  const properties = [{}, {ShowTitle:true}, {Width:12}, {Height:2}, {Representation:'StrongSeparation'},
    {BackColor:'web:LightYellow'}, {VerticalStretch:true}, {HorizontalStretch:true}, {Behavior:'Collapsible'}];
  for (const own of properties) {
    for (const children of [[], [hidden], [hiddenTable], [nested]]) {
      const group = node('UsualGroup', own, children);
      assert.equal(displayedInPreview(group), false, JSON.stringify(own));
      assert.equal(group.children, children, 'visibility does not remove source children');
    }
    assert.equal(displayedInPreview(node('UsualGroup', own, [node('InputField')])), true);
  }
  assert.equal(displayedInPreview(node('UsualGroup', {}, [node('LabelDecoration')])), true, 'an empty label is a visible spacer');
});

test('explicit stretch and weights are independent of preferred size',()=>{
  const field=node('InputField',{HorizontalStretch:true,VerticalStretch:true,Width:4,Height:2});
  field.presentation.valueType.kind='number';assert.equal(stretches(field,'x'),true);assert.equal(stretches(field,'y'),true);
  assert.equal(stretches(node('InputField',{HorizontalStretch:0}),'x'),false);
  assert.equal(stretches(node('InputField',{VerticalStretch:1}),'y'),true);
  assert.equal(stretchWeight(field,'x'),4);assert.equal(stretchWeight(field,'y'),2);
  assert.equal(stretchWeight(node('Table'),'x'),1);assert.equal(stretchWeight(node('Table',{Height:-1}),'y'),1);
});

test('fixed explicit dimensions ignore maximums; zero maximum means unlimited',()=>{
  assert.deepEqual(controlBounds(node('InputField',{HorizontalStretch:false,Width:20,MaxWidth:5}),'x',200,'linux'),{});
  assert.deepEqual(controlBounds(node('InputField',{AutoMaxWidth:false,MaxWidth:0}),'x',200,'linux'),{minimum:80,maximum:undefined});
  assert.deepEqual(controlBounds(node('InputField',{AutoMaxWidth:false,MaxWidth:30,MinWidth:4}),'x',200,'linux'),{minimum:80,maximum:310});
  assert.equal(controlBounds(node('InputField',{Width:4,MaxWidth:1}),'x',200,'linux').maximum,410,'the automatic ceiling is independent of authored width');
});

test('Linux multiline input keeps its XML height under viewport pressure', () => {
  const minimum = (properties, points = 10, options) => {
    const field = node('InputField', { MultiLine: true, ...properties });
    field.presentation.font = { points };
    return controlBounds(field, 'y', undefined, 'linux', options).minimum;
  };
  assert.equal(minimum({}), 51);
  assert.equal(minimum({ ReadOnly: true }), 51);
  assert.equal(minimum({ Enabled: false }), 51);
  assert.equal(minimum({ Height: 1, VerticalStretch: true }), 23);
  assert.equal(minimum({ Height: 3 }), 79);
  assert.equal(minimum({ Height: 4 }), 107);
  assert.equal(minimum({}, 8), 45);
  assert.equal(minimum({}, 14), 76);
  assert.equal(minimum({}, 10, { authoredHeight: true }), 23);
  const capped = node('InputField', { MultiLine: true, AutoMaxHeight: false, MaxHeight: 1 });
  assert.deepEqual(controlBounds(capped, 'y', undefined, 'linux'), { minimum: 51, maximum: 51 });
});

test('manual Linux memo width uses the Taxi unit at the preferred size', () => {
  const memo = node('InputField',{MultiLine:true, HorizontalStretch:true, AutoMaxWidth:false, MaxWidth:80});
  assert.equal(controlBounds(memo,'x',undefined,'linux',{atPreferred:true}).maximum,810);
  const reference = node('InputField',{ReadOnly:true});
  reference.presentation.valueType.kind = 'reference';
  assert.equal(controlBounds(reference,'x',undefined,'linux').maximum,410);
  reference.presentation.valueType = { kind:'composite', types: ['DocumentRef.First','DocumentRef.Second'].map(name =>
    ({ name, namespace:'http://v8.1c.ru/8.1/data/enterprise/current-config' })) };
  assert.equal(stretches(reference,'x'),true);
  assert.equal(controlBounds(reference,'x',undefined,'linux').maximum,410);
  reference.presentation.valueType.types.push({ name:'string', namespace:'http://www.w3.org/2001/XMLSchema' });
  assert.equal(stretches(reference,'x'),false);
});

test('native horizontal lanes divide control space and honor minima, caps and fixed siblings', () => {
  const left = {reserve:0, preferred:131, minimum:71, maximum:410};
  const right = {...left, preferred:191};
  assert.deepEqual(allocateLaneSizes(142, [left, right]), [71,71]);
  assert.deepEqual(allocateLaneSizes(190, [left, right]), [87,103]);
  assert.deepEqual(allocateLaneSizes(240, [left, right]), [103,137]);
  assert.deepEqual(allocateLaneSizes(330, [left, right]), [134,196]);
  assert.deepEqual(allocateLaneSizes(430, [left, right]), [175,255]);
  assert.deepEqual(allocateLaneSizes(710, [left, right]), [300,410]);
  assert.deepEqual(allocateLaneSizes(930, [left, right]), [410,410]);
  assert.deepEqual(allocateLaneSizes(710, [left, {...right, minimum:191, maximum:191}]), [410,191]);
  assert.deepEqual(allocateLaneSizes(700, [left, right, {...left, preferred:111}]), [212,309,179]);
  const titled = [left, right].map(lane => Object.fromEntries(Object.entries(lane).map(([key,value]) => [key,value+34])));
  assert.deepEqual(allocateLaneSizes(710, titled), [295,415]);
});

test('standard reference inputs reserve both buttons and cap stretch in the measured lane', () => {
  const field = node('InputField', {Width:30});
  field.presentation.valueType.kind = 'reference';
  assert.deepEqual(laneInputBounds(field,'linux'), {preferred:353,minimum:80,narrowMinimum:113,maximum:410,valueWeight:98});
  const automatic = {...field, properties:[]};
  assert.deepEqual(laneInputBounds(automatic,'linux'), {preferred:203,minimum:80,narrowMinimum:113,maximum:410,valueWeight:98});
  assert.equal(laneInputBounds(automatic,'windows'), undefined);
});

test('frame allocation uses local CSS pixels, preserves zoom, and scrolls below minimums',()=>{
  const preferred={width:600,height:400},minimum={width:320,height:180},viewport={width:1008,height:708};
  assert.deepEqual(formAllocation(viewport,preferred,minimum),{width:1000,height:700});
  assert.deepEqual(formAllocation(viewport,preferred,minimum,200),{width:496,height:346});
  assert.deepEqual(formAllocation({width:180,height:100},preferred,minimum),minimum);
  assert.deepEqual(formAllocation({width:0,height:0},preferred,minimum),preferred);
  assert.deepEqual(viewport,{width:1008,height:708});
});

test('surface allocation retains equal metrics and rebuilds geometry for a new area',()=>{
  const preferred=Object.freeze({width:500,height:243,calibrated:true,pixels:13});
  assert.equal(allocatedSurfaceMetrics(preferred,{width:500,height:243},node('ChartField')),preferred);
  assert.deepEqual(allocatedSurfaceMetrics(preferred,{width:710,height:350},node('ChartField')),{...preferred,width:710,height:350});
  assert.equal(allocatedSurfaceMetrics(preferred,{width:710.5,height:350},node('ChartField')).calibrated,false);
  assert.equal(allocatedSurfaceMetrics(preferred,{width:9000,height:9000},node('ChartField')).calibrated,false);
  assert.equal(preferred.width,500);
});

test('calendar automatic month counts are recomputed without changing source or font metrics',()=>{
  const calendar=node('CalendarField',{WidthInMonths:0,HeightInMonths:0});
  const preferred={width:338,height:300,calibrated:true,columns:1,rows:1,cellWidth:42,rowHeight:31,currentDate:false};
  const allocated=allocatedSurfaceMetrics(preferred,{width:1000,height:800},calendar);
  assert.equal(allocated.columns,3);assert.equal(allocated.rows,3);assert.equal(allocated.cellWidth,42);assert.equal(preferred.columns,1);
  assert.equal(allocatedSurfaceMetrics(preferred,{width:1000,height:800},node('CalendarField')).columns,1);
});

test('reference-axis detection uses the outer area before native scrollbars and respects zoom rounding',()=>{
  assert.equal(atPreferredAxis(257,249),true);assert.equal(atPreferredAxis(242,249),false);
  assert.equal(atPreferredAxis(321,249,125),true);assert.equal(atPreferredAxis(1000,249),false);
});

test('explicit group sizes are separated from stretch weights and converted through the OS profile',()=>{
  const group=node('UsualGroup',{Width:35,Height:3,HorizontalStretch:false,VerticalStretch:false});
  assert.deepEqual(groupPreferredSize(group,'linux'),{width:350,height:50});
  assert.deepEqual(groupPreferredSize(group,'win32'),{width:280,height:60});
  assert.deepEqual(groupPreferredSize(node('InputField',{Width:35}),'linux'),{});
});

test('picture fields reserve the measured Linux slot and accept a Designer border override', () => {
  const picture = node('PictureField', {Width:2, Height:1});
  assert.deepEqual([pictureFieldStyle(picture,'linux').width, pictureFieldStyle(picture,'linux').height], ['20px','18px']);
  assert.deepEqual([pictureFieldStyle(picture,'win32').width, pictureFieldStyle(picture,'win32').height], ['16px','20px']);
  picture.properties.push({
    key: property('Border', '').key,
    value: {kind:'record',fields:[{
      key:{namespace:'http://v8.1c.ru/8.1/data/ui',name:'style'},
      value:{kind:'text',text:'WithoutBorder'},
    }]},
  });
  assert.equal(pictureFieldStyle(picture, 'linux')['border-style'], 'none');
});

test('native automatic string maximum does not cap explicitly stretched number or date controls',()=>{
  assert.equal(controlBounds(node('InputField'),'x',undefined,'linux').maximum,410);
  assert.equal(controlBounds(node('InputField',{HorizontalStretch:true}),'x',undefined,'linux').maximum,410);
  for(const kind of ['number','date']) {
    const field=node('InputField',{HorizontalStretch:true});field.presentation.valueType.kind=kind;
    assert.equal(controlBounds(field,'x',undefined,'linux').maximum,undefined,kind+' explicit stretch');
  }
});

test('numeric captions preserve words, explicit lines and the native suffix break', () => {
  const font = {points:10, weight:400};
  const total = fieldCaptionProfile('Сумма (итог):', font);
  assert.equal(total.minimum, 40);
  assert.deepEqual(fieldCaptionLines(total, 40), ['Сумма', '(итог)', ':']);
  assert.deepEqual(fieldCaptionLines(total, 41), ['Сумма', '(итог):']);
  assert.deepEqual(fieldCaptionLines(total, 81), ['Сумма (итог):']);
  const custom = fieldCaptionProfile('Очень длинная надпись:', font);
  assert.deepEqual(fieldCaptionLines(custom, custom.minimum), ['Очень', 'длинная', 'надпись:']);
  assert.deepEqual(fieldCaptionLines(custom, custom.compact), ['Очень длинная', 'надпись:']);
  const explicit = fieldCaptionProfile('Quantity\n\nAmount:', font);
  assert.deepEqual(fieldCaptionLines(explicit, explicit.preferred), ['Quantity', '', 'Amount:']);
});

test('date labels retain native value bounds for their date parts, font and explicit dimensions', () => {
  for (const [dateParts, points, width, height, preferred, paintHeight] of [
    ['DateTime', 10, 0, 0, 152, 19], ['Date', 10, 0, 0, 92, 19], ['Time', 10, 0, 0, 82, 19],
    ['DateTime', 12, 0, 0, 190, 23], ['DateTime', 16, 0, 0, 252, 29],
    ['DateTime', 10, 25, 0, 252, 19], ['DateTime', 10, 0, 2, 152, 34],
  ]) {
    const label = node('LabelField', { Width: width, Height: height, BackColor: 'web:Pink' });
    label.presentation.valueType = { kind: 'date', dateParts };
    label.presentation.titleLocation = 'Top';
    label.presentation.font.points = points;
    assert.deepEqual(textLabelMetrics(label, 'linux'), { preferred, height: paintHeight, outset: 2 });
  }
});

test('caption packing changes at the whole-word threshold before track rounding', () => {
  const title = fieldCaptionProfile('Дата отражения в учете:');
  assert.equal(fieldCaptionOccupiedWidth(title, 107.99), 97);
  assert.equal(fieldCaptionOccupiedWidth(title, 108), 108);
  assert.equal(fieldCaptionOccupiedWidth(title, title.preferred), title.preferred);
  const dateLabel = fieldCaptionProfile('Дата запрета отражения:', undefined, { splitTerminalColon: true });
  assert.deepEqual(fieldCaptionLines(dateLabel, 150), ['Дата запрета отражения', ':']);
  assert.equal(fieldCaptionOccupiedWidth(dateLabel, 150), 80);

  const left = { minimum: 90, preferred: 471 }, right = { minimum: 441, preferred: 612 };
  const [, raw] = allocateLaneSizes(730, [left, right], { fractional: true });
  assert.ok(raw > 502 && raw < 503);
  assert.deepEqual(allocateLaneSizes(730, [left, right]), [227, 503]);
});

test('narrow numeric rows fill the value boxes before restoring trailing captions', () => {
  const font = {points:10, weight:400};
  const tracks = ['Количество (итог):', 'Сумма (итог):'].map(title => ({
    caption:fieldCaptionProfile(title, font), reserve:5, value:{minimum:52, preferred:77, maximum:335},
  }));
  assert.deepEqual(narrowCaptionTracks(225, tracks), [{width:128, caption:71}, {width:97, caption:40}]);
  assert.deepEqual(narrowCaptionTracks(260, tracks), [{width:145, caption:71}, {width:115, caption:40}]);
  assert.deepEqual(narrowCaptionTracks(320, tracks), [{width:155, caption:72}, {width:165, caption:81}]);
  assert.equal(narrowCaptionTracks(357, tracks), undefined);
});

test('a page with side tabs fits captions against the nominal rail and allocates the painted width', () => {
  const options = { wordRuns: true, splitTerminalColon: true };
  const tracks = [
    {
      caption: fieldCaptionProfile('Адрес сервера кластера:', undefined, options),
      captionInset: 1, reserve: 5, value: { minimum: 71, preferred: 161, maximum: 500 },
    },
    {
      caption: fieldCaptionProfile('Порт подключения:', undefined, options),
      captionInset: 1, reserve: 5, value: { minimum: 61, preferred: 61, maximum: 61 },
    },
  ];
  assert.deepEqual(narrowCaptionTracks(439, tracks, 445), [{ width: 256, caption: 91 }, { width: 183, caption: 117 }]);
  assert.deepEqual(narrowCaptionTracks(469, tracks, 475), [{ width: 286, caption: 102 }, { width: 183, caption: 117 }]);
  assert.deepEqual(narrowCaptionTracks(489, [...tracks].reverse(), 495), [{ width: 154, caption: 88 }, { width: 335, caption: 154 }]);
});

test('automatic lanes grow from their preferred widths and share space after a cap', () => {
  const left = {reserve:82, preferred:285, minimum:195, maximum:492, growthWeight:98};
  const right = {reserve:126, preferred:329, minimum:239, maximum:536, growthWeight:156};
  assert.deepEqual(allocateLaneSizes(614, [left, right]), [285,329]);
  assert.deepEqual(allocateLaneSizes(930, [left, right]), [407,523]);
  assert.deepEqual(allocateLaneSizes(980, [left, right]), [444,536]);
  assert.deepEqual(allocateLaneSizes(1090, [left, right]), [492,536]);
});

test('manual limits on measured automatic lanes keep their preferred trailing border', () => {
  const field = node('InputField', {AutoMaxWidth:false, MaxWidth:14});
  field.presentation.valueType.kind = 'reference';
  field.presentation.titleLocation = 'None';
  assert.deepEqual(laneInputBounds(field,'linux'), {preferred:151, minimum:113, narrowMinimum:113, maximum:151, valueWeight:98});
  const raised = node('InputField', {AutoMaxWidth:false, MaxWidth:30});
  raised.presentation = field.presentation;
  assert.deepEqual(laneInputBounds(raised,'linux'), {preferred:203, minimum:113, narrowMinimum:113, maximum:310, valueWeight:98});
});

test('an automatic multiline maximum preserves the preferred width of a wide field', () => {
  for (const [width, maximum] of [[25, 410], [50, 511]]) {
    const memo = node('InputField', {MultiLine:true, Width:width, HorizontalStretch:true});
    assert.equal(controlBounds(memo, 'x', undefined, 'linux').maximum, maximum);
    assert.equal(horizontalInputMaximum(memo, 'linux'), maximum);
  }
});

test('a manual maximum on a horizontal text field includes the native control inset', () => {
  const field = node('InputField', {AutoMaxWidth:false, MaxWidth:14});
  field.presentation.valueType.length = 13;
  assert.equal(horizontalInputMaximum(field, 'linux'), 150);
  assert.equal(horizontalInputMaximum(field, 'win32'), undefined);
  assert.equal(horizontalInputMaximum(node('InputField', {MaxWidth:14}), 'linux'), 410);
  assert.equal(horizontalInputMaximum(node('InputField', {AutoMaxWidth:false, MaxWidth:14, Width:20}), 'linux'), 211);
});

test('the cap on a reference beside a date follows the measured Linux widths', () => {
  for (const [maxWidth, measured] of [[8, 91], [12, 131], [16, 203]]) {
    const field = node('InputField', {AutoMaxWidth:false, MaxWidth:maxWidth});
    field.presentation.valueType.kind = 'reference';
    assert.equal(horizontalInputMaximum(field, 'linux'), measured);
  }
});


test('narrow input lanes restore a trailing full title before expanding the leading title', () => {
  const tracks = ['Customer group:', 'Settlement currency:'].map((title, index) => ({
    caption: fieldCaptionProfile(title, { points: 10, weight: 400 }),
    reserve: 5,
    value: { minimum: 113, preferred: 203, maximum: 410 },
    valueWeight: 98,
    growthWeight: [143, 156][index],
  }));
  const partial = narrowInputLaneWidths(580, tracks);
  assert.deepEqual(partial.map(track => track.caption), [61, 68]);
  assert.equal(partial.reduce((width, track) => width + track.width, 0), 580);
  assert.deepEqual(narrowInputLaneWidths(600, tracks).map(track => track.caption), [57, 121]);
  assert.equal(narrowInputLaneWidths(640, tracks), undefined);
});

test('reference and string lanes retain their own minimum value boxes', () => {
  const tracks = ['Organization:', 'Settlement currency:'].map((title, index) => ({
    caption: fieldCaptionProfile(title, { points: 10, weight: 400 }),
    reserve: 5,
    value: { minimum: [113, 71][index], preferred: [203, 161][index], maximum: 410 },
    valueWeight: [98, 78][index],
    growthWeight: [98, 136][index],
  }));
  assert.deepEqual(narrowInputLaneWidths(300, tracks), [{ width: 195, caption: 77 }, { width: 139, caption: 63 }]);
  assert.deepEqual(narrowInputLaneWidths(510, tracks), [{ width: 281, caption: 77 }, { width: 229, caption: 63 }]);
});


test('fixed date fields allow independent captions before shared columns fit', () => {
  const tracks = ['Организация:', 'Валюта взиморасчетов:'].map((title, index) => ({
    caption: fieldCaptionProfile(title, { points: 10, weight: 400 }),
    reserve: 5,
    value: { minimum: [182, 113][index], preferred: [353, 203][index], maximum: 410 },
    minimumWidth: [220, 212][index],
    valueWeight: 98,
    growthWeight: [undefined, 168][index],
  }));
  assert.deepEqual(narrowInputLaneWidths(390, tracks), [
    { width: 220, caption: 80, independent: true }, { width: 212, caption: 94, independent: true },
  ]);
  assert.deepEqual(narrowInputLaneWidths(470, tracks), [
    { width: 237, caption: 80, independent: true }, { width: 233, caption: 94, independent: true },
  ]);
  assert.deepEqual(narrowInputLaneWidths(480, tracks), [
    { width: 268, caption: 80 }, { width: 212, caption: 94 },
  ]);
});

test('an isolated input beside pages wraps and grows its native caption track', () => {
  const font = { face: 'Arial', points: 10, weight: 400 };
  const title = fieldCaptionProfile('Подключение к кластеру серверов:', font);
  // Widths and caption tracks measured in Designer 8.3.27.2342.
  const samples = [
    { available: 310, minimum: 101, preferred: 292, expected: 119 },
    { available: 350, minimum: 101, preferred: 292, expected: 119 },
    { available: 360, minimum: 101, preferred: 292, expected: 151 },
    { available: 450, minimum: 101, preferred: 292, expected: 152 },
    { available: 470, minimum: 101, preferred: 292, expected: 159 },
    { available: 510, minimum: 101, preferred: 292, expected: 172 },
    { available: 520, minimum: 101, preferred: 292, expected: undefined },
    { available: 390, minimum: 101, preferred: 192, expected: 169 },
    { available: 450, minimum: 101, preferred: 392, expected: 151 },
    { available: 450, minimum: 80, preferred: 271, expected: 159 },
  ];
  for (const { available, minimum, preferred, expected } of samples) {
    assert.equal(isolatedInputCaptionWidth(title, available, 4, minimum, preferred), expected, JSON.stringify({ available, minimum, preferred }));
  }
  const remote = fieldCaptionProfile('Подключение к удалённому серверу:', font);
  assert.equal(isolatedInputCaptionWidth(remote, 390, 4, 101, 292), 169);
});
