import { flag, number, scalar, fieldWidth } from './model.mjs';

function visible(node) { return node.presentation.displayed !== false && flag(node, 'Visible') && (node.kind === 'ColumnGroup' || node.kind?.endsWith('Field')); }

function column(node, readOnly) {
  const explicit = number(node, 'Width'), type = node.presentation.valueType.kind;
  if (explicit > 0) return { node, fields: [node], width: explicit * 8 + 4, flexible: false };
  if (node.kind === 'CheckBoxField') return { node, fields: [node], width: 54, flexible: false };
  if (node.presentation.caption?.kind === 'standard' && node.presentation.caption.key === 'table.LineNumber') return { node, fields: [node], width: 67, flexible: false };
  if (type === 'number') return { node, fields: [node], width: 108 + (!readOnly && !flag(node, 'ReadOnly', false) ? 21 : 0) + (flag(node, 'SpinButton', false) ? 21 : 0), flexible: false };
  return { node, fields: [node], width: fieldWidth(node), flexible: ['string', 'reference', 'unknown'].includes(type) };
}

/** Physical columns differ from logical fields for Vertical and InCell groups. */
export function tableLayout(table) {
  const readOnly = flag(table, 'ReadOnly', false);
  function visit(node) {
    if (node.kind !== 'ColumnGroup') return { node, mode: 'field', depth: 1, columns: [column(node, readOnly)], children: [] };
    const children = node.children.filter(visible).map(visit), show = flag(node, 'ShowInHeader', false), mode = scalar(node, 'Group', 'Vertical');
    if (mode === 'Horizontal') return { node, mode: 'horizontal', show, children,
      depth: (show ? 1 : 0) + Math.max(1, ...children.map(child => child.depth)), columns: children.flatMap(child => child.columns) };
    const fields = children.flatMap(child => child.columns.flatMap(column => column.fields)), parts = fields.map(field => column(field, readOnly));
    return { node, mode: mode === 'InCell' ? 'inCell' : 'vertical', show, children,
      depth: (show ? 1 : 0) + (mode === 'InCell' ? 1 : children.reduce((sum, child) => sum + child.depth, 0)),
      columns: [{ node, fields, width: mode === 'InCell' ? parts.reduce((sum, part) => sum + part.width, 0) : Math.max(20, ...parts.map(part => part.width)), flexible: parts.some(part => part.flexible) }] };
  }
  const children = table.children.filter(visible).map(visit), columns = children.flatMap(child => child.columns);
  const depth = Math.max(1, ...children.map(child => child.depth));
  const bar = table.auxiliary.find(node => node.kind === 'AutoCommandBar');
  const commands = table.presentation.autoCommandItems ?? [];
  const toolbar = scalar(table, 'CommandBarLocation') !== 'None' && (commands.length > 0 || bar?.children.some(child => child.presentation.displayed));
  const search = table.auxiliary.find(node => node.kind === 'SearchStringAddition' && visibleAddition(node));
  const chips = table.auxiliary.find(node => node.kind === 'SearchControlAddition' && visibleAddition(node));
  const header = flag(table, 'Header') ? depth * 30 : 0, footer = flag(table, 'Footer', false) ? 30 : 0;
  const rowCount = number(table, 'HeightInTableRows');
  const height = rowCount > 0 ? header + rowCount * 28 + footer + 1 : 227 + (depth === 3 ? 1 : 0);
  const minWidth = Math.max(400, number(table, 'Width') * 8 + 4, columns.reduce((sum, column) => sum + column.width, 0) + 16, toolbar && search ? 415 : 0);
  const flexible = columns.some(column => column.flexible);
  const tracks = columns.map((column, index) => column.flexible || !flexible && index === 0 ? `minmax(${column.width}px, 1fr)` : `${column.width}px`).join(' ');
  return { children, columns, depth, header, footer, height, minWidth, tracks, toolbar, commands, bar, search, chips };
}

function visibleAddition(node) { return node.presentation.displayed !== false && flag(node, 'Visible'); }
