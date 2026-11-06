import { flag, number, scalar, fieldWidth, viewStatusAddition } from './model.mjs';

function visible(node) { return node.presentation.displayed !== false && flag(node, 'Visible') && (node.kind === 'ColumnGroup' || node.kind?.endsWith('Field')); }

function hasColumns(table, includeHidden = false) {
  return table.children.some(child => (includeHidden || visible(child)) &&
    (child.kind === 'ColumnGroup' ? hasColumns(child, includeHidden) : child.kind?.endsWith('Field')));
}

function commandBar(table) { return table.auxiliary?.find(node => node.kind === 'AutoCommandBar'); }

export function hasTableSurface(table) {
  const bar = commandBar(table);
  return !bar || flag(bar, 'Autofill') || bar.children.some(child => child.presentation.displayed) || hasColumns(table);
}

function findTable(node, name) {
  if (node.kind === 'Table' && node.name === name) return node;
  for (const child of node.children) {
    const table = findTable(child, name);
    if (table) return table;
  }
}

export function tableSearchReference(command) {
  const match = /^Form\.Item\.(.+)\.StandardCommand\.(Find|CancelSearch)$/.exec(command);
  return match ? { table: match[1], action: match[2] } : undefined;
}

export function availableTableSearchCommand(root, reference) {
  const table = reference && findTable(root, reference.table);
  return !table || hasColumns(table, true);
}

export function commandSourceTable(root, bar) {
  const match = /^Item\.(.+)$/.exec(scalar(bar, 'CommandSource'));
  const table = match && findTable(root, match[1]);
  return table && hasColumns(table, true) ? table : undefined;
}

export function tableSearch(table) {
  if (!table || scalar(table, 'SearchStringLocation') === 'None') return;
  return table.auxiliary.find(node => node.kind === 'SearchStringAddition' && visibleAddition(node));
}

function isDynamicList(table) {
  return table.presentation.valueType?.types?.some(type =>
    type.namespace === 'http://v8.1c.ru/8.1/data/enterprise/current-config' && type.name === 'DynamicList') ?? false;
}

function tableSearchControl(table) {
  if (scalar(table, 'SearchControlLocation') === 'None') return;
  return table.auxiliary.find(node => node.kind === 'SearchControlAddition' && visibleAddition(node));
}

export function tableAdditionsProjection(root, table) {
  if (!table?.name || !hasColumns(table, true)) return;
  const inCommandBar = name => ['Auto', 'CommandBar'].includes(scalar(table, name, 'Auto'));
  const search = inCommandBar('SearchStringLocation') ? tableSearch(table) : undefined;
  const control = isDynamicList(table) && inCommandBar('SearchControlLocation') ? tableSearchControl(table) : undefined;
  if (!search && !control) return;
  const source = `Item.${table.name}`;
  function findBar(node) {
    if (node.presentation.displayed === false) return;
    if (node.kind === 'CommandBar' && scalar(node, 'CommandSource') === source) return node;
    for (const child of node.children) {
      const bar = findBar(child);
      if (bar) return bar;
    }
  }
  const bar = findBar(root);
  return bar ? { bar, search, control } : undefined;
}

function column(node, readOnly, dynamic) {
  const explicit = number(node, 'Width'), type = node.presentation.valueType.kind;
  if (explicit > 0) return { node, fields: [node], width: explicit * 8 + 4, flexible: false };
  if (node.kind === 'CheckBoxField') return { node, fields: [node], width: 54, flexible: false };
  const standard = node.presentation.caption?.kind === 'standard' ? node.presentation.caption.key : '';
  if (standard === 'table.LineNumber') return { node, fields: [node], width: Math.round((node.presentation.valueType.digits ?? 9) * 7.4 + 30), flexible: false };
  if (type === 'number') return { node, fields: [node], width: (node.presentation.valueType.digits === 0 ? 155 : 108) + (!readOnly && !flag(node, 'ReadOnly', false) ? 21 : 0) + (flag(node, 'SpinButton', false) ? 21 : 0), flexible: false };
  return { node, fields: [node], width: fieldWidth(node) + (dynamic ? 8 : 16), flexible: ['string', 'reference', 'unknown'].includes(type) && !['attribute.Code', 'attribute.Number'].includes(standard) };
}

/** Physical columns differ from logical fields for Vertical and InCell groups. */
export function tableLayout(table, locale = 'ru', additions) {
  const readOnly = flag(table, 'ReadOnly', false);
  const dynamic = isDynamicList(table);
  function visit(node) {
    if (node.kind !== 'ColumnGroup') return { node, mode: 'field', depth: 1, columns: [column(node, readOnly, dynamic)], children: [] };
    const children = node.children.filter(visible).map(visit), show = flag(node, 'ShowInHeader', false), mode = scalar(node, 'Group', 'Vertical');
    if (mode === 'Horizontal') return { node, mode: 'horizontal', show, children,
      depth: (show ? 1 : 0) + Math.max(1, ...children.map(child => child.depth)), columns: children.flatMap(child => child.columns) };
    const fields = children.flatMap(child => child.columns.flatMap(column => column.fields)), parts = fields.map(field => column(field, readOnly, dynamic));
    return { node, mode: mode === 'InCell' ? 'inCell' : 'vertical', show, children,
      depth: (show ? 1 : 0) + (mode === 'InCell' ? 1 : children.reduce((sum, child) => sum + child.depth, 0)),
      columns: [{ node, fields, width: mode === 'InCell' ? parts.reduce((sum, part) => sum + part.width, 0) : Math.max(20, ...parts.map(part => part.width)), flexible: parts.some(part => part.flexible) }] };
  }
  const children = table.children.filter(visible).map(visit), columns = children.flatMap(child => child.columns);
  const depth = Math.max(1, ...children.map(child => child.depth));
  const bar = commandBar(table);
  const commands = table.presentation.autoCommandItems ?? [];
  const toolbar = scalar(table, 'CommandBarLocation') !== 'None' && (commands.length > 0 || bar?.children.some(child => child.presentation.displayed));
  const searchField = tableSearch(table);
  const topSearch = scalar(table, 'SearchStringLocation') === 'Top' ? searchField : undefined;
  const search = additions?.search || topSearch ? undefined : searchField;
  const chips = viewStatusAddition(table);
  const searchControl = dynamic && !additions?.control ? tableSearchControl(table) : undefined;
  const header = flag(table, 'Header') ? depth * 30 : 0, footer = flag(table, 'Footer', false) ? 30 : 0;
  const rowCount = number(table, 'HeightInTableRows');
  const height = rowCount > 0 ? header + rowCount * 28 + footer + 1 : dynamic ? 452 : 227 + (depth === 3 ? 1 : 0);
  const english = !locale.toLowerCase().startsWith('ru');
  const toolbarWidth = dynamic ? english ? 454 : 418 : english ? 429 : 415;
  const contentMinWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const controlMinWidth = Math.max(400, toolbar && search ? toolbarWidth : 0);
  const minWidth = Math.max(controlMinWidth, number(table, 'Width') * 8 + 4, contentMinWidth + (dynamic ? 2 : 16));
  const flexible = columns.some(column => column.flexible);
  const tracks = columns.map((column, index) => column.flexible || !flexible && index === 0 ? `minmax(${column.width}px, 1fr)` : `${column.width}px`).join(' ');
  return { children, columns, depth, header, footer, height, minWidth, controlMinWidth, contentMinWidth, tracks, toolbar, commands, bar, more: flag(bar, 'Autofill'), search, topSearch, searchControl, chips, dynamic };
}

function visibleAddition(node) { return node.presentation.displayed !== false && flag(node, 'Visible'); }
