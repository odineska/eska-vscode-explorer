import { Show, Switch, Match, createMemo, createEffect, createSignal, onMount, onCleanup } from 'solid-js';
import { number, flag, scalar, color } from './model.mjs';
import { documentSurfaceMetrics } from './document-surface.mjs';
import { pdfSurfaceMetrics } from './pdf-surface.mjs';
import { Pdf } from './Pdf.jsx';
import { Sheet } from './Sheet.jsx';
import { Calendar } from './Calendar.jsx';
import { Period } from './Period.jsx';
import { Planner } from './Planner.jsx';
import { plannerSurfaceMetrics } from './planner-surface.mjs';
import { periodSurfaceMetrics } from './period-surface.mjs';
import { calendarSurfaceMetrics } from './calendar-surface.mjs';
import { Geographical } from './Geographical.jsx';
import { Icon } from './Preview.jsx';
import { Chart } from './Chart.jsx';
import {chartSurfaceMetrics,chartBorderColor} from './chart-surface.mjs';
import { Gantt } from './Gantt.jsx';
import {ganttSurfaceMetrics,ganttBorderColor} from './gantt-surface.mjs';
import { Dendrogram } from './Dendrogram.jsx';
import { dendrogramSurfaceMetrics, dendrogramBorderColor } from './dendrogram-surface.mjs';
import { ViewStatus } from './Additions.jsx';
import { allocatedSurfaceMetrics } from './surface-allocation.mjs';
import { borderBoxSize } from './layout-box.mjs';

function DocumentToolbar(props) { return <Show when={flag(props.node, 'ShowToolbar', false)}>
  <div class="taxi-document-toolbar"><Icon name="Write"/><Icon name="Print"/><span>−</span><span>100%</span><span>+</span></div></Show>; }
/** Static surfaces belong to the design-time view. Bound runtime documents and handlers never execute. */
export function SpecialField(props) {
  let surface;
  const [allocation, setAllocation] = createSignal();
  const preferred = createMemo(() => props.node.kind==='ChartField'?chartSurfaceMetrics(props.node,props.controller.state.os):props.node.kind==='GanttChartField'?ganttSurfaceMetrics(props.node,props.controller.state.os):props.node.kind==='DendrogramField'?dendrogramSurfaceMetrics(props.node,props.controller.state.os):props.node.kind==='PlannerField'?plannerSurfaceMetrics(props.node,props.controller.state.os):props.node.kind==='PeriodField'?periodSurfaceMetrics(props.node,props.controller.state.os):props.node.kind==='CalendarField'?calendarSurfaceMetrics(props.node,props.controller.state.os):props.node.kind==='PDFDocumentField'?pdfSurfaceMetrics(props.node,props.controller.state.os):['TextDocumentField','FormattedDocumentField','HTMLDocumentField','SpreadSheetDocumentField','GeographicalSchemaField','GraphicalSchemaField'].includes(props.node.kind)?documentSurfaceMetrics(props.node,props.controller.state.os):undefined), owner={};
  const document = createMemo(() => allocatedSurfaceMetrics(preferred(), allocation(), props.node));
  onMount(() => {
    let scheduled, active = true;
    const measure = () => {
      scheduled = undefined; if (!active || !surface?.isConnected || surface.clientWidth <= 0 || surface.clientHeight <= 0) return;
      const next = borderBoxSize(surface);
      setAllocation(previous => previous?.width === next.width && previous?.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(() => { if (active && scheduled === undefined) scheduled = requestAnimationFrame(measure); });
    observer.observe(surface); measure();
    onCleanup(() => { active = false; observer.disconnect(); cancelAnimationFrame(scheduled); });
  });
  createEffect(()=>props.controller.nativeText?.issue(owner,props.controller.state.os==='linux'&&document()&&!document().calibrated));
  onCleanup(()=>props.controller.nativeText?.issue(owner,false));
  const width = () => preferred()?.width ?? (number(props.node, 'Width') > 0 ? Math.max(15, number(props.node, 'Width')) * 8 + 4 : props.node.kind === 'CalendarField' ? 338 : 500);
  const height = () => preferred()?.height ?? (number(props.node, 'Height') > 0 ? Math.max(2, number(props.node, 'Height')) * 20 + 3 : props.node.kind === 'CalendarField' ? 300 : props.node.kind === 'PeriodField' ? 209 : 243);
  const minimumWidth = () => {
    const value = preferred();
    if (props.node.kind === 'CalendarField' && value) return number(props.node,'WidthInMonths',1) === 0
      ? value.cellWidth * 7 + 44 + (value.monthsPanel ? value.panelWidth + 7 : 0) : value.width;
    if (props.node.kind === 'PeriodField' && value) return Math.min(value.width, 3 * value.cellWidth + 3);
    return Math.min(width(), 150);
  };
  const minimumHeight = () => {
    const value = preferred();
    if (props.node.kind === 'CalendarField' && value) return number(props.node,'HeightInMonths',1) === 0
      ? value.rowHeight * 8 + 24 + (value.currentDate && !value.monthsPanel ? value.rowHeight + 6 : 0) : value.height;
    if (props.node.kind === 'PeriodField' && value) return Math.min(value.height, value.headerHeight + 4 * value.rowHeight + 3);
    return Math.min(height(), 64);
  };
  const border = () => {
    if(!document()||props.controller.state.os!=='linux')return;
    if(props.node.kind==='DendrogramField')return dendrogramBorderColor(props.node);
    if(props.node.kind==='ChartField')return chartBorderColor(props.node);
    if(props.node.kind==='GanttChartField')return ganttBorderColor(props.node);
    if(props.node.kind==='PlannerField')return '#a0a0a0';
    if(!flag(props.node,'Enabled')||['GeographicalSchemaField','CalendarField','PeriodField'].includes(props.node.kind)&&flag(props.node,'ReadOnly',false))return '#e8e8e8';
    return color(props.node.presentation.border);
  };
  return <div class="taxi-special-stack" style={{ width: `${width()}px`, '--taxi-surface-min-width': `${minimumWidth()}px` }}><Show when={props.node.kind === 'PDFDocumentField'}><ViewStatus node={props.node} controller={props.controller}/></Show>
    <div ref={surface} class="taxi-special" data-native-field={props.node.kind} style={{ width: `${width()}px`, height: `${height()}px`, '--taxi-surface-min-height': `${minimumHeight()}px`, 'border-color': border() }}>
    <Switch fallback={<div class="taxi-document-surface"/>}>
      <Match when={props.node.kind === 'CalendarField'}><Calendar {...props} metrics={document()}/></Match>
      <Match when={props.node.kind === 'PeriodField'}><Period {...props} metrics={document()}/></Match>
      <Match when={props.node.kind === 'SpreadSheetDocumentField'}><Sheet node={props.node} controller={props.controller} metrics={document()}/></Match>
      <Match when={props.node.kind === 'PlannerField'}><Planner {...props} metrics={document()}/></Match>
      <Match when={props.node.kind === 'TextDocumentField'}><DocumentToolbar {...props}/><div class="taxi-document-surface taxi-text-document" style={{'background-color':document()?color(props.node.presentation.background):undefined}}/></Match>
      <Match when={props.node.kind === 'FormattedDocumentField'}><div class="taxi-document-surface"/></Match>
      <Match when={props.node.kind === 'PDFDocumentField'}><Pdf node={props.node} controller={props.controller} metrics={document()}/></Match>
      <Match when={props.node.kind === 'ChartField'}><Chart {...props} width={(document()?.width ?? width()) - 2} height={(document()?.height ?? height()) - 2} metrics={document()}/></Match>
      <Match when={props.node.kind === 'DendrogramField'}><Dendrogram {...props} width={(document()?.width ?? width()) - 2} height={(document()?.height ?? height()) - 2} metrics={document()}/></Match>
      <Match when={props.node.kind === 'GanttChartField'}><Gantt {...props} width={(document()?.width ?? width()) - 2} height={(document()?.height ?? height()) - 2} metrics={document()}/></Match>
      <Match when={props.node.kind==='GeographicalSchemaField'}><Geographical node={props.node} controller={props.controller}/></Match>
      <Match when={['GraphicalSchemaField', 'HTMLDocumentField'].includes(props.node.kind)}><div classList={{ 'taxi-document-surface': true, 'taxi-graphical-schema': props.node.kind === 'GraphicalSchemaField' }}/></Match>
    </Switch>
  </div></div>;
}
