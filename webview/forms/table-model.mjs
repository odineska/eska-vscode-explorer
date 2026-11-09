import { flag, number, scalar, caption, fieldWidth, fontLineHeight, inputHeightUnit, viewStatusAddition } from './model.mjs';
import { designCaptionWidth } from './font-metrics.mjs';

const defaultBandHeight = 30;
const nativeRowHeight = 28;
const dynamicToolbarMinimum = 300;
const bandHeight = value => fontLineHeight(value) + 15;

function groupGridMinimum(height, headerDepth, footer, headerExtra, rowCount, heightUnits, rowHeight = nativeRowHeight) {
  // A constrained grid keeps at most three body rows. Multiple header levels leave two.
  const bodyRows = rowCount > 0 ? rowCount - 1
    : heightUnits > 0 ? heightUnits - headerDepth - Number(footer) - 1 : Infinity;
  const visibleRows = Math.max(0, Math.min(headerDepth > 1 ? 2 : 3, bodyRows));
  const bands = headerDepth + Number(footer) + visibleRows;
  const headerGrowth = headerDepth ? 1 + headerExtra + Math.round(headerExtra * 5 / 8) : 0;
  return Math.min(height, Math.max(2, bands * (rowHeight + 1) + headerGrowth));
}

function allocateBand(height, base, reference = defaultBandHeight) {
  const preferred = Math.max(height, base);
  return preferred + Math.round((preferred - reference) * 5 / 8);
}

function mergeColumnRows(children, vertical) {
  const combine = key => vertical ? children.reduce((sum, child) => sum + child[key], 0)
    : Math.max(...children.map(child => child[key]));
  return Object.fromEntries(['rowSpan', 'rowHeaderHeight', 'rowFooterHeight', 'footerHeight']
    .map(key => [key, combine(key)]));
}

function linuxTableHeight(table, header, footer, depth, dynamic, rows) {
  const unit = inputHeightUnit(table, 'linux'), baseBand = bandHeight(table.presentation.font);
  const rowCount = number(table, 'HeightInTableRows'), authored = number(table, 'Height');
  const edge = Number(dynamic), deep = rows.rowSpan - 1;
  const baseline = rows.rowSpan * allocateBand(baseBand, baseBand);
  const headerGrowth = header ? Math.max(0, rows.rowHeaderHeight - baseline) : 0;
  const footerGrowth = footer ? Math.max(0, rows.rowFooterHeight - baseline) : 0;
  const bands = (header ? rows.rowHeaderHeight : 0) + (footer ? rows.rowFooterHeight : 0);
  const minimum = units => (unit + 7) * Math.max(1, Math.min(rows.rowSpan, Math.trunc(units)))
    + 1 + headerGrowth + footerGrowth + edge;
  const dimensions = (units, maximum = false) => {
    const grid = units * unit;
    // A short maximum clips the bands; an authored height reserves the visible row units.
    if (maximum && header && grid <= rows.rowHeaderHeight) return { height: minimum(units), header, footer };
    if (grid > bands) return { height: grid + 1 + (header ? 2 + deep : 0) + (footer ? 2 + deep : 0)
      + headerGrowth + footerGrowth + edge, header, footer };
    if (header && footer) {
      if (!deep) return { height: bands + edge, header: header - 1, footer: footer - 1 };
      return { height: Math.max(minimum(units), units * (unit + 1) + 2 + headerGrowth + footerGrowth + edge),
        header, footer, clipHeader: true };
    }
    return { height: minimum(units), header, footer };
  };
  let result;
  if (rowCount > 0) result = {
    height: bands + rowCount * rows.rowSpan * unit + 1 + edge - deep * (Number(!!header) + Number(!!footer)),
    header, footer,
  };
  else if (authored > 0) result = dimensions(authored);
  else result = { height: (dynamic ? 16 * unit + 3 + deep
    : 8 * unit + 1 + (header ? 2 + deep : 0) + (footer ? 2 + deep : 0))
    + headerGrowth + footerGrowth + edge, header, footer };
  const maximum = !flag(table, 'AutoMaxHeight') && number(table, 'MaxHeight');
  if (rowCount <= 0 && maximum > 0) {
    const capped = dimensions(maximum, true);
    if (capped.height < result.height) result = capped;
  }
  return { ...result, minimum: Math.min(result.height, groupGridMinimum(result.height,
    header ? depth : 0, !!footer, Math.max(0, header - depth * baseBand), rowCount, authored, unit) + edge) };
}

export function tableFooterFont(table, column) {
  return column.presentation.tableColumnAppearance?.footerFont ?? table.presentation.font;
}

function visible(node) { return node.presentation.displayed !== false && flag(node, 'Visible') && (node.kind === 'ColumnGroup' || node.kind?.endsWith('Field')); }

function hasColumns(table, includeHidden = false) {
  return table.children.some(child => (includeHidden || visible(child)) &&
    (child.kind === 'ColumnGroup' ? hasColumns(child, includeHidden) : child.kind?.endsWith('Field')));
}

function commandBar(table) { return table.auxiliary?.find(node => node.kind === 'AutoCommandBar'); }

export function hasTableSurface(table) {
  const bar = commandBar(table);
  return !bar || bar.children.some(child => child.presentation.displayed) || hasColumns(table, flag(bar, 'Autofill'));
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

function linuxColumnWidth(node, readOnly, explicit, stretch, state) {
  const { kind, length, digits, fraction, dateParts, types } = node.presentation.valueType;
  const title = flag(node, 'ShowInHeader') ? designCaptionWidth(caption(node, state), node.presentation.titleFont) : 0;
  const label = title ?? 0;
  const captionWidth = label + 17;
  const compactCaption = Math.floor((label + .5) * 3 / 4) + 13;
  const fixed = stretch === false;
  const editable = node.kind === 'InputField' && !readOnly && !flag(node, 'ReadOnly', false);
  // A flexible column uses narrower character units than a fixed column.
  if (explicit > 0) return fixed ? Math.max(captionWidth, explicit * 10 + 17)
    : Math.max(compactCaption, explicit * 7.5 + 13);
  if (node.kind === 'CheckBoxField') return Math.max(34, captionWidth);
  if (kind === 'string') {
    if (fixed) return Math.max(captionWidth, Math.min(length || 15, 40) * 10 + 18);
    if (!length) return Math.max(126, compactCaption);
    if (stretch !== true && length <= 10) return Math.max(captionWidth, length * 10 + 18);
    return Math.max(compactCaption, Math.min(length, 40) * 7.5 + 14);
  }
  const stretchWidth = width => stretch === true ? Math.round(width * 3 / 4) : width;
  if (kind === 'number' && digits != null) {
    if (!digits) return fixed ? Math.max(168, captionWidth) : Math.max(126, compactCaption);
    const decimals = fraction ?? 0, integer = Math.max(1, digits - decimals);
    const groups = Math.floor((integer - 1) / 3);
    // The value estimate includes the sign and grouping before snapping to 10px units.
    const value = (integer + decimals) * 7.5 + groups * 4 + (decimals ? 4.5 : 0) + 17;
    const choice = editable && flag(node, 'ChoiceButton', decimals > 0) ? 21 : 0;
    const spin = editable && flag(node, 'SpinButton', false) ? 21 : 0;
    const control = Math.floor(value / 10) * 10 + (node.kind === 'LabelField' ? 17 : 18) + choice + spin;
    return stretchWidth(Math.max(captionWidth, control));
  }
  if (kind === 'reference') {
    const enumeration = types?.some(type => type.name.startsWith('EnumRef.'));
    const width = (enumeration ? 126 : 142) + (editable ? 16 : 0);
    return fixed ? Math.floor(width * 4 / 3) : width;
  }
  if (kind === 'date') {
    if (dateParts === 'Time') return stretchWidth(98);
    const width = (dateParts === 'Date' ? 108 : 168) + (editable && flag(node, 'ChoiceButton') ? 21 : 0);
    return stretchWidth(width);
  }
}

function column(node, readOnly, dynamic, native, state) {
  const explicit = number(node, 'Width'), type = node.presentation.valueType;
  const standard = node.presentation.caption?.kind === 'standard' ? node.presentation.caption.key : '';
  const regular = !['attribute.Code', 'attribute.Number'].includes(standard);
  const result = (width, growthWeight = 0) => ({ node, fields: [node], width, growthWeight });
  if (standard === 'table.LineNumber' && explicit <= 0) {
    return result(Math.max(native ? 87 : 0, Math.round((type.digits ?? 9) * 7.4 + 30)));
  }
  if (native) {
    const stretch = flag(node, 'HorizontalStretch', null);
    const width = linuxColumnWidth(node, readOnly, explicit, stretch, state);
    if (width !== undefined) {
      const automatic = type.kind === 'string' && (!type.length || type.length > 10)
        || type.kind === 'number' && type.digits === 0 || type.kind === 'reference';
      const grows = node.kind !== 'CheckBoxField' && (stretch ?? (automatic && regular));
      return result(Math.floor(width), grows ? width : 0);
    }
  }
  if (explicit > 0) return result(explicit * 8 + 4);
  if (node.kind === 'CheckBoxField') return result(54);
  if (type.kind === 'number') {
    const choice = !readOnly && !flag(node, 'ReadOnly', false) ? 21 : 0;
    return result((type.digits === 0 ? 155 : 108) + choice + (flag(node, 'SpinButton', false) ? 21 : 0));
  }
  const width = fieldWidth(node) + (dynamic ? 8 : 16);
  return result(width, regular && ['string', 'reference', 'unknown'].includes(type.kind) ? width : 0);
}

/** Snap proportional surplus to CSS pixels while keeping the last edge at the available width. */
export function tableTracks(layout, available) {
  if (!layout.nativeColumns || available <= layout.contentMinWidth || !layout.columns.length) return layout.tracks;
  const { columns } = layout;
  const extra = available - layout.contentMinWidth;
  const flexibleWidth = columns.reduce((sum, item) => sum + item.growthWeight, 0);
  const firstNumber = flexibleWidth ? -1 : columns.findIndex(item => item.node.presentation.valueType?.kind === 'number');
  const fallback = firstNumber < 0 ? columns.length - 1 : firstNumber;
  let used = 0, weight = 0;
  return columns.map((item, index) => {
    if (!flexibleWidth) return `${item.width + (index === fallback ? extra : 0)}px`;
    if (!item.growthWeight) return `${item.width}px`;
    weight += item.growthWeight;
    const end = Math.round(weight * extra / flexibleWidth);
    const width = item.width + end - used;
    used = end;
    return `${width}px`;
  }).join(' ');
}

/** Physical columns differ from logical fields for Vertical and InCell groups. */
export function tableLayout(table, state = {}, additions) {
  const { os, locale = 'ru' } = state;
  const readOnly = flag(table, 'ReadOnly', false);
  const dynamic = isDynamicList(table);
  const linux = os === 'linux';
  const nativeColumns = linux && !dynamic;
  const nativeDynamicList = linux && dynamic;
  const captions = { locale, strings: state.strings };
  const metrics = node => column(node, readOnly, dynamic, linux, captions);
  const baseBand = bandHeight(table.presentation.font);
  const rowMetrics = (node, height) => {
    const footerHeight = bandHeight(tableFooterFont(table, node));
    return { rowSpan: 1, rowHeaderHeight: allocateBand(height, baseBand),
      rowFooterHeight: allocateBand(footerHeight, baseBand), footerHeight };
  };
  function visit(node) {
    const titleHeight = bandHeight(node.presentation.titleFont);
    if (node.kind !== 'ColumnGroup') {
      const height = flag(node, 'ShowInHeader') ? titleHeight : defaultBandHeight;
      return { node, mode: 'field', depth: 1, height, ...rowMetrics(node, height),
        columns: [metrics(node)], children: [] };
    }
    const children = node.children.filter(visible).map(visit), show = flag(node, 'ShowInHeader', false), mode = scalar(node, 'Group', 'Vertical');
    const captionHeight = show ? titleHeight : 0;
    const rows = children.length ? mergeColumnRows(children, mode === 'Vertical') : rowMetrics(node, titleHeight);
    if (mode === 'Horizontal') return { node, mode: 'horizontal', show, captionHeight, children, ...rows,
      height: captionHeight + (children.length ? Math.max(...children.map(child => child.height)) : defaultBandHeight),
      depth: (show ? 1 : 0) + Math.max(1, ...children.map(child => child.depth)), columns: children.flatMap(child => child.columns) };
    const fields = children.flatMap(child => child.columns.flatMap(column => column.fields)), parts = fields.map(metrics);
    const width = mode === 'InCell' ? parts.reduce((sum, part) => sum + part.width, 0) : Math.max(20, ...parts.map(part => part.width));
    const growthWeight = parts.some(part => part.growthWeight) ? width : 0;
    return { node, mode: mode === 'InCell' ? 'inCell' : 'vertical', show, captionHeight, children,
      ...(mode === 'InCell' ? rowMetrics(node, titleHeight) : rows),
      height: captionHeight + (mode === 'InCell' ? titleHeight : children.reduce((sum, child) => sum + child.height, 0)),
      depth: (show ? 1 : 0) + (mode === 'InCell' ? 1 : children.reduce((sum, child) => sum + child.depth, 0)),
      columns: [{ node, fields, width, growthWeight }] };
  }
  const children = table.children.filter(visible).map(visit), columns = children.flatMap(child => child.columns);
  const depth = Math.max(1, ...children.map(child => child.depth));
  const bar = commandBar(table);
  const commands = table.presentation.autoCommandItems ?? [];
  const authoredCommands = bar?.children.some(child => child.presentation.displayed);
  const toolbar = scalar(table, 'CommandBarLocation') !== 'None'
    && (commands.length > 0 || authoredCommands || (table.presentation.tableCommandMenu?.some(group => group.length) ?? false));
  const more = flag(bar, 'Autofill');
  const searchField = tableSearch(table);
  const topSearch = scalar(table, 'SearchStringLocation') === 'Top' ? searchField : undefined;
  const search = additions?.search || topSearch ? undefined : searchField;
  const chips = viewStatusAddition(table);
  const searchControl = dynamic && !additions?.control ? tableSearchControl(table) : undefined;
  let header = flag(table, 'Header') ? children.length ? Math.max(...children.map(child => child.height)) : defaultBandHeight : 0;
  let footer = flag(table, 'Footer', false)
    ? children.length ? Math.max(...children.map(child => child.footerHeight)) : defaultBandHeight : 0;
  const rowCount = number(table, 'HeightInTableRows');
  let height = dynamic ? 452 : 227 + Number(depth === 3), groupMinimumHeight;
  let clipHeader = false;
  if (linux) {
    const rows = children.length ? mergeColumnRows(children, false) : rowMetrics(table, defaultBandHeight);
    const geometry = linuxTableHeight(table, header, footer, depth, dynamic, rows);
    ({ height, header, footer } = geometry);
    clipHeader = geometry.clipHeader ?? false;
    groupMinimumHeight = geometry.minimum;
  } else if (rowCount > 0) {
    const defaultHeader = header ? depth * defaultBandHeight : 0, defaultFooter = footer ? defaultBandHeight : 0;
    const extraBands = Math.max(0, header - defaultHeader) + Math.max(0, footer - defaultFooter);
    height = defaultHeader + rowCount * nativeRowHeight + defaultFooter
      + extraBands + Math.round(extraBands * 5 / 8) + 1;
  }
  const english = !locale.toLowerCase().startsWith('ru');
  const toolbarWidth = dynamic ? english ? 454 : 418 : english ? 429 : 415;
  const contentMinWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const explicit = number(table, 'Width');
  const searchWidth = number(search, 'Width');
  // An authored search width replaces the default toolbar reserve before the remaining space is allocated.
  const searchReserve = linux && searchWidth > 0 ? searchWidth * 10 + 22 - 172 : 0;
  const toolbarMinimum = Math.max(400, toolbar && search ? toolbarWidth + searchReserve : 0);
  const nativeWidth = linux && explicit > 0 ? explicit * 10 : 0;
  const forcedCommands = bar?.children.some(child => child.presentation.displayed &&
    ['InCommandBar', 'InCommandBarAndInAdditionalSubmenu'].includes(scalar(child, 'LocationInCommandBar')));
  const adaptiveToolbar = nativeDynamicList && !!toolbar && more && !!(nativeWidth || search) && !forcedCommands;
  const compactToolbar = adaptiveToolbar && chips ? dynamicToolbarMinimum : 0;
  const controlMinWidth = nativeWidth
    ? Math.max(compactToolbar, Math.min(nativeWidth, toolbarMinimum)) : toolbarMinimum;
  // The native table viewport has its own preferred width, independent of the scrolling grid.
  const automaticWidth = nativeColumns ? Math.max(controlMinWidth, Math.min(880, 40 + columns.length * 120))
    : Math.max(controlMinWidth, explicit * 8 + 4, contentMinWidth + (dynamic ? 2 : 16));
  const preferredWidth = nativeWidth ? Math.max(nativeWidth, compactToolbar) : automaticWidth;
  const fixedGridWidth = nativeDynamicList && flag(table, 'HorizontalStretch', null) === false
    ? nativeWidth || Math.max(400, contentMinWidth + 2) : undefined;
  const flexible = columns.some(column => column.growthWeight);
  const tracks = columns.map((column, index) => !nativeColumns && (column.growthWeight || !flexible && index === 0)
    ? `minmax(${column.width}px, 1fr)` : `${column.width}px`).join(' ');
  return { children, columns, depth, header, footer, height, clipHeader, groupMinimumHeight, preferredWidth, fixedGridWidth, controlMinWidth, contentMinWidth, tracks, toolbar, adaptiveToolbar, commands, bar, more, search, topSearch, searchControl, chips, dynamic, nativeColumns, nativeDynamicList };
}

function visibleAddition(node) { return node.presentation.displayed !== false && flag(node, 'Visible'); }
