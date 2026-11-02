import { For, Show, Switch, Match, createMemo } from 'solid-js';
import { number, flag, scalar } from './model.mjs';
import { Icon } from './Preview.jsx';

function Calendar(props) {
  const date = new Date(), locale = props.controller.state.locale;
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
  const first = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 5, index + 1)));
  return <div class="taxi-calendar"><div class="taxi-calendar-title"><span>‹</span><strong>{month}</strong><span>›</span></div><div class="taxi-calendar-grid">
    <For each={weekdays}>{day => <b>{day}</b>}</For><For each={Array.from({ length: 42 }, (_, index) => index - first + 1)}>{day => <span classList={{ today: day === date.getDate(), weekend: (day + first) % 7 === 0 || (day + first) % 7 === 6 }}>{day > 0 && day <= days ? day : ''}</span>}</For>
  </div></div>;
}
function Sheet(props) {
  const columns = Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index));
  return <div class="taxi-sheet" classList={{ 'taxi-sheet--no-grid': !flag(props.node, 'ShowGrid') }}><table><Show when={flag(props.node, 'ShowHeaders')}><thead><tr><th/><For each={columns}>{name => <th>{name}</th>}</For></tr></thead></Show>
    <tbody><For each={Array.from({ length: 30 }, (_, index) => index + 1)}>{row => <tr><Show when={flag(props.node, 'ShowHeaders')}><th>{row}</th></Show><For each={columns}>{() => <td/>}</For></tr>}</For></tbody></table></div>;
}
function DocumentToolbar(props) { return <Show when={flag(props.node, 'ShowToolbar', props.node.kind === 'FormattedDocumentField' || props.node.kind === 'PDFDocumentField')}>
  <div class="taxi-document-toolbar"><Show when={props.node.kind === 'FormattedDocumentField'} fallback={<><Icon name="Write"/><Icon name="Print"/><span>−</span><span>100%</span><span>+</span></>}>
    <span class="taxi-format-face">Arial ▾</span><span>10 ▾</span><b>B</b><i>I</i><u>U</u><span>▾</span><span>≡</span><span>≡</span>
  </Show></div></Show>; }
function Planner(props) {
  const locale = props.controller.state.locale;
  const days = Array.from({ length: 5 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2026, 5, index + 1)));
  return <div class="taxi-planner"><table><thead><tr><th/><For each={days}>{day => <th>{day}</th>}</For></tr></thead><tbody><For each={Array.from({ length: 12 }, (_, index) => index + 8)}>{hour => <tr><th>{hour}:00</th><For each={days}>{() => <td/>}</For></tr>}</For></tbody></table></div>;
}
/** Static surfaces belong to the design-time view. Bound runtime documents and handlers never execute. */
export function SpecialField(props) {
  const width = () => Math.max(15, number(props.node, 'Width', props.node.kind === 'CalendarField' ? 27 : 50)) * 8;
  const height = () => Math.max(2, number(props.node, 'Height', props.node.kind === 'CalendarField' ? 11 : 12)) * 20;
  return <div class="taxi-special" data-native-field={props.node.kind} style={{ width: `${width()}px`, height: `${height()}px` }}>
    <Switch fallback={<div class="taxi-document-surface"/>}>
      <Match when={props.node.kind === 'CalendarField'}><Calendar {...props}/></Match>
      <Match when={props.node.kind === 'SpreadSheetDocumentField'}><Sheet {...props}/></Match>
      <Match when={props.node.kind === 'PlannerField'}><Planner {...props}/></Match>
      <Match when={['TextDocumentField', 'FormattedDocumentField', 'PDFDocumentField'].includes(props.node.kind)}><DocumentToolbar {...props}/><div classList={{ 'taxi-document-surface': true, 'taxi-pdf': props.node.kind === 'PDFDocumentField' }}/></Match>
      <Match when={['ChartField', 'GanttChartField', 'DendrogramField', 'GeographicalSchemaField', 'GraphicalSchemaField', 'HTMLDocumentField'].includes(props.node.kind)}><div class="taxi-document-surface"/></Match>
    </Switch>
  </div>;
}
