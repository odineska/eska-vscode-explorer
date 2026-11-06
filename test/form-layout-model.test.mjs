import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stretches, stretchWeight, controlBounds, formAllocation, atPreferredAxis, groupPreferredSize, horizontalLaneWidths, laneInputBounds } from '../webview/forms/layout-model.mjs';
import { allocatedSurfaceMetrics } from '../webview/forms/surface-allocation.mjs';
const property=(name,text)=>({key:{namespace:'http://v8.1c.ru/8.3/xcf/logform',name},value:{kind:'text',text:String(text)}});
const node=(kind,properties={},children=[])=>({key:kind,kind,properties:Object.entries(properties).map(([name,value])=>property(name,value)),children,
  presentation:{displayed:true,valueType:{kind:'string'},font:{points:10,weight:400}}});

test('Auto stretch follows field types and descendants while an explicit No stops at the group',()=>{
  const input=node('InputField'), table=node('Table'), fixed=node('UsualGroup',{HorizontalStretch:false,VerticalStretch:false},[table]);
  assert.equal(stretches(input,'x'),true);assert.equal(stretches(input,'y'),false);
  input.presentation.valueType.kind='number';assert.equal(stretches(input,'x'),false);
  assert.equal(stretches(node('InputField',{Height:3}),'y'),true);
  assert.equal(stretches(node('Pages',{},[node('Page',{},[table])]),'y'),true);
  assert.equal(stretches(fixed,'x'),false);assert.equal(stretches(fixed,'y'),false);
  assert.equal(stretches(node('UsualGroup',{},[fixed]),'x'),false);
  assert.equal(stretches(node('UsualGroup',{},[table]),'y',{UsualGroup:true}),false);
  table.presentation.displayed=false;assert.equal(stretches(node('Page',{},[table]),'x'),false);
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
  assert.deepEqual(controlBounds(node('InputField',{AutoMaxWidth:false,MaxWidth:30,MinWidth:4}),'x',200,'linux'),{minimum:80,maximum:300});
  assert.equal(controlBounds(node('InputField',{Width:4,MaxWidth:1}),'x',200,'linux').maximum,undefined,'explicit stretch dimensions are weights');
});

test('native horizontal lanes divide control space and honor minima, caps and fixed siblings', () => {
  const left = {reserve:0, preferred:131, minimum:71, maximum:410};
  const right = {...left, preferred:191};
  assert.deepEqual(horizontalLaneWidths(142, [left, right]), [71,71]);
  assert.deepEqual(horizontalLaneWidths(190, [left, right]), [87,103]);
  assert.deepEqual(horizontalLaneWidths(240, [left, right]), [103,137]);
  assert.deepEqual(horizontalLaneWidths(330, [left, right]), [134,196]);
  assert.deepEqual(horizontalLaneWidths(430, [left, right]), [175,255]);
  assert.deepEqual(horizontalLaneWidths(710, [left, right]), [300,410]);
  assert.deepEqual(horizontalLaneWidths(930, [left, right]), [410,410]);
  assert.deepEqual(horizontalLaneWidths(710, [left, {...right, minimum:191, maximum:191}]), [410,191]);
  assert.deepEqual(horizontalLaneWidths(700, [left, right, {...left, preferred:111}]), [212,309,179]);
  const titled = [left, right].map(lane => Object.fromEntries(Object.entries(lane).map(([key,value]) => [key,value+34])));
  assert.deepEqual(horizontalLaneWidths(710, titled), [295,415]);
});

test('standard reference inputs reserve both buttons and cap stretch in the measured lane', () => {
  const field = node('InputField', {Width:30});
  field.presentation.valueType.kind = 'reference';
  assert.deepEqual(laneInputBounds(field,'linux'), {preferred:353,minimum:80,maximum:410});
  const automatic = {...field, properties:[]};
  assert.deepEqual(laneInputBounds(automatic,'linux'), {preferred:203,minimum:80,maximum:410});
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
  assert.deepEqual(groupPreferredSize(group,'linux'),{width:350,height:75});
  assert.deepEqual(groupPreferredSize(group,'win32'),{width:280,height:60});
  assert.deepEqual(groupPreferredSize(node('InputField',{Width:35}),'linux'),{});
});

test('native automatic string maximum does not cap explicitly stretched number or date controls',()=>{
  assert.equal(controlBounds(node('InputField'),'x',undefined,'linux').maximum,410);
  for(const kind of ['string','number','date']) {
    const field=node('InputField',{HorizontalStretch:true});field.presentation.valueType.kind=kind;
    assert.equal(controlBounds(field,'x',undefined,'linux').maximum,undefined,kind+' explicit stretch');
  }
});
