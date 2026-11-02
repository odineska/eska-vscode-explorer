import { For, Show, Switch, Match, createMemo } from 'solid-js';
import { number, flag, scalar } from './model.mjs';
import { Icon } from './Preview.jsx';
import { Chart } from './Chart.jsx';

function Calendar(props) {
  const state = props.controller.state, date = new Date(), locale = state.culture;
  const culture = new Intl.Locale(locale), weekStart = (culture.getWeekInfo?.().firstDay ?? culture.weekInfo?.firstDay ?? 1) % 7;
  const first = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() - weekStart + 7) % 7;
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 5, index + weekStart)));
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
  return <div class="taxi-calendar"><div class="taxi-calendar-title"><span>{date.getFullYear()}<i>◢</i></span><span>{month}<i>◢</i></span><span>‹</span><span>›</span></div><div class="taxi-calendar-grid">
    <For each={weekdays}>{(day, index) => <b classList={{ weekend: [0, 6].includes((index() + weekStart) % 7) }}>{day}</b>}</For>
    <For each={Array.from({ length: 42 }, (_, index) => new Date(date.getFullYear(), date.getMonth(), index - first + 1))}>{day => <span classList={{ today: day.toDateString() === date.toDateString(), weekend: day.getDay() === 0 || day.getDay() === 6, adjacent: day.getMonth() !== date.getMonth() }}>{day.getDate()}</span>}</For>
  </div><div class="taxi-calendar-today"><span>{state.strings.today}, {new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)}</span></div></div>;
}
function Sheet(props) {
  const columns = Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index));
  return <div class="taxi-sheet" classList={{ 'taxi-sheet--no-grid': !flag(props.node, 'ShowGrid', false) }}><table><Show when={flag(props.node, 'ShowHeaders', false)}><thead><tr><th/><For each={columns}>{name => <th>{name}</th>}</For></tr></thead></Show>
    <tbody><For each={Array.from({ length: 30 }, (_, index) => index + 1)}>{row => <tr><Show when={flag(props.node, 'ShowHeaders', false)}><th>{row}</th></Show><For each={columns}>{(_, index) => <td classList={{ 'taxi-sheet-cell-selected': row === 1 && index() === 0 }}/>}</For></tr>}</For></tbody></table></div>;
}
function DocumentToolbar(props) { return <Show when={flag(props.node, 'ShowToolbar', props.node.kind === 'PDFDocumentField')}>
  <div class="taxi-document-toolbar"><Show when={props.node.kind === 'FormattedDocumentField'} fallback={<><Icon name="Write"/><Icon name="Print"/><span>−</span><span>100%</span><span>+</span></>}>
    <span class="taxi-format-face">Arial ▾</span><span>10 ▾</span><b>B</b><i>I</i><u>U</u><span>▾</span><span>≡</span><span>≡</span>
  </Show></div></Show>; }
function Planner(props) {
  const state = props.controller.state, now = new Date(), date = new Intl.DateTimeFormat(state.culture, { dateStyle: 'long' }).format(now);
  return <div class="taxi-planner"><div class="taxi-planner-date">{date}</div><div class="taxi-planner-scroll"><div class="taxi-planner-hours">
    <For each={Array.from({ length: 24 }, (_, index) => index)}>{hour => <div class="taxi-planner-hour"><span>{String(hour).padStart(2, '0')}:00</span><i/></div>}</For>
    <div class="taxi-planner-meeting">01:00 {state.strings.sampleMeeting}</div><div class="taxi-planner-now" style={{ top: `${(now.getHours() + now.getMinutes() / 60) * 16}px` }}/>
  </div></div></div>;
}
/** Static surfaces belong to the design-time view. Bound runtime documents and handlers never execute. */
export function SpecialField(props) {
  const width = () => number(props.node, 'Width') > 0 ? Math.max(15, number(props.node, 'Width')) * 8 + 4 : props.node.kind === 'CalendarField' ? 338 : 500;
  const height = () => number(props.node, 'Height') > 0 ? Math.max(2, number(props.node, 'Height')) * 20 + 3 : props.node.kind === 'CalendarField' ? 300 : 243;
  return <div class="taxi-special" data-native-field={props.node.kind} style={{ width: `${width()}px`, height: `${height()}px` }}>
    <Switch fallback={<div class="taxi-document-surface"/>}>
      <Match when={props.node.kind === 'CalendarField'}><Calendar {...props}/></Match>
      <Match when={props.node.kind === 'SpreadSheetDocumentField'}><Sheet {...props}/></Match>
      <Match when={props.node.kind === 'PlannerField'}><Planner {...props}/></Match>
      <Match when={['TextDocumentField', 'FormattedDocumentField', 'PDFDocumentField'].includes(props.node.kind)}><DocumentToolbar {...props}/><div classList={{ 'taxi-document-surface': true, 'taxi-pdf': props.node.kind === 'PDFDocumentField' }}/></Match>
      <Match when={props.node.kind === 'ChartField'}><Chart width={width() - 2} height={height() - 2} controller={props.controller}/></Match>
      <Match when={['GanttChartField', 'DendrogramField', 'GeographicalSchemaField', 'GraphicalSchemaField', 'HTMLDocumentField'].includes(props.node.kind)}><div class="taxi-document-surface"/></Match>
    </Switch>
  </div>;
}
