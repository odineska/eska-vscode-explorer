import { Show } from 'solid-js';
import { inspectorIcons } from '../../src/icons.js';

const glyphs = {
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm3.5 8 3 3',
  expand: 'M4 6l4-4 4 4M4 10l4 4 4-4',
  collapse: 'M4 2l4 4 4-4M4 14l4-4 4 4',
  right: 'M6 4l4 4-4 4',
  down: 'M4 6l4 4 4-4',
  link: 'M6.5 10.5l4-4m-5 2-2 2a2.2 2.2 0 0 0 3 3l2-2m-1-7 2-2a2.2 2.2 0 0 1 3 3l-2 2',
  preview: 'M2 3h12v8H2zM5 14h6M8 11v3',
  xml: 'M5 4L2 8l3 4m6-8 3 4-3 4M9 3L7 13',
  copy: 'M6 5h8v9H6zM11 2H2v9',
  clear: 'M4 4l8 8M4 12l8-8',
};

const icons = {
  Form: 'form', UsualGroup: 'group', ButtonGroup: 'group', ColumnGroup: 'group', Pages: 'pages', Page: 'page',
  AutoCommandBar: 'command', CommandBar: 'command', Popup: 'command', Button: 'button',
  Table: 'table', InputField: 'field', LabelField: 'text', LabelDecoration: 'text',
  PictureField: 'image', PictureDecoration: 'image', CheckBoxField: 'check', RadioButtonField: 'choice',
  ChartField: 'chart', GanttChartField: 'chart', DendrogramField: 'chart',
};

export function nodeGlyph(kind) {
  return icons[kind] ?? (kind?.endsWith('Field') ? 'field' : kind?.endsWith('Addition') ? 'data' : 'unknown');
}

export function dataGlyph(row, index) {
  if (row.section === 'commands') return 'command';
  if (row.section === 'parameters') return 'parameter';
  if (row.valueType?.kind === 'table') return 'table';
  if (index.byData.get(row.parent)?.valueType?.kind === 'table') return 'column';
  return row.depth ? 'field' : 'data';
}

export function InspectorIcon(props) {
  return <Show when={Object.hasOwn(inspectorIcons, props.name)} fallback={<svg class="form-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
    <path d={glyphs[props.name]}/>
  </svg>}>
    <span class="form-icon form-artwork" aria-hidden="true" data-form-artwork={props.name}/>
  </Show>;
}

export function InspectorIconButton(props) {
  return <button type="button" class="form-icon-button" title={props.label} aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
    <InspectorIcon name={props.icon}/>
  </button>;
}
