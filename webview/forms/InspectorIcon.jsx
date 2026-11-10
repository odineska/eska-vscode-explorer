const glyphs = {
  form: 'M2 3h12v10H2zM2 6h12M4 4.5h1',
  group: 'M1.5 4h5l1 1h7v8h-13zM1.5 4V2.5h5l1.5 1.5',
  pages: 'M3 5h11v9H3zM1 11V2h10M3 8h11',
  page: 'M3 2h7l3 3v9H3zM10 2v4h3M5 9h6M5 11h6',
  field: 'M1.5 4h13v8h-13zM5 6v4M4 6h2M4 10h2',
  table: 'M2 2.5h12v11H2zM2 6h12M2 9.5h12M6 6v7.5M10 6v7.5',
  button: 'M2 5h12v6H2zM5.5 8h5',
  text: 'M2 4h12M2 8h8M2 12h10',
  image: 'M2 2.5h12v11H2zM2 11l4-4 3 3 2-2 3 3M10.5 5h1',
  check: 'M2 2h12v12H2zM4.5 8l2.5 2.5L12 5.5',
  choice: 'M8 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  chart: 'M2 2v12h12M5 11V8M8 11V4M11 11V6',
  command: 'M3 2.5h10v11H3zM6 5l2.5 3L6 11M9 11h2',
  data: 'M4 3h8l2 3v6l-2 2H4l-2-2V6zM2 6h12M5 9h6M5 11h6',
  parameter: 'M5 2H3v12h2m6-12h2v12h-2M6 9l4-3',
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
  unknown: 'M2 2h12v12H2zM6 6a2 2 0 1 1 3 1.7c-.6.3-1 1-1 1.8M8 12h.1',
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

export function InspectorIcon(props) {
  return <svg class="form-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
    <path d={glyphs[props.name] ?? glyphs.unknown}/>
  </svg>;
}

export function InspectorIconButton(props) {
  return <button type="button" class="form-icon-button" title={props.label} aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
    <InspectorIcon name={props.icon}/>
  </button>;
}
