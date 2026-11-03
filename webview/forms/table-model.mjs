import { flag, number, scalar, fieldWidth, viewStatusAddition } from './model.mjs';

function visible(node) { return node.presentation.displayed !== false && flag(node, 'Visible') && (node.kind === 'ColumnGroup' || node.kind?.endsWith('Field')); }

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
export function tableLayout(table, locale = 'ru') {
  const readOnly = flag(table, 'ReadOnly', false);
  const dynamic = table.presentation.valueType?.types?.some(type => type.namespace === 'http://v8.1c.ru/8.1/data/enterprise/current-config' && type.name === 'DynamicList') ?? false;
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
  const bar = table.auxiliary.find(node => node.kind === 'AutoCommandBar');
  const commands = table.presentation.autoCommandItems ?? [];
  const toolbar = scalar(table, 'CommandBarLocation') !== 'None' && (commands.length > 0 || bar?.children.some(child => child.presentation.displayed));
  const search = scalar(table, 'SearchStringLocation') !== 'None' ? table.auxiliary.find(node => node.kind === 'SearchStringAddition' && visibleAddition(node)) : undefined;
  const chips = viewStatusAddition(table);
  const searchControl = dynamic && scalar(table, 'SearchControlLocation') !== 'None' ? table.auxiliary.find(node => node.kind === 'SearchControlAddition' && visibleAddition(node)) : undefined;
  const header = flag(table, 'Header') ? depth * 30 : 0, footer = flag(table, 'Footer', false) ? 30 : 0;
  const rowCount = number(table, 'HeightInTableRows');
  const height = rowCount > 0 ? header + rowCount * 28 + footer + 1 : dynamic ? 452 : 227 + (depth === 3 ? 1 : 0);
  const english = !locale.toLowerCase().startsWith('ru');
  const toolbarWidth = dynamic ? english ? 454 : 418 : english ? 429 : 415;
  const minWidth = Math.max(400, number(table, 'Width') * 8 + 4, columns.reduce((sum, column) => sum + column.width, 0) + (dynamic ? 2 : 16), toolbar && search ? toolbarWidth : 0);
  const flexible = columns.some(column => column.flexible);
  const tracks = columns.map((column, index) => column.flexible || !flexible && index === 0 ? `minmax(${column.width}px, 1fr)` : `${column.width}px`).join(' ');
  return { children, columns, depth, header, footer, height, minWidth, tracks, toolbar, commands, bar, more: flag(bar, 'Autofill'), search, searchControl, chips, dynamic };
}

function visibleAddition(node) { return node.presentation.displayed !== false && flag(node, 'Visible'); }
