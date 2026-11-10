import { FORM_NS, caption, flag, key, property, scalar, treeChildren } from './model.mjs';
import { inspectorType } from './inspector-type.mjs';

export const definitionSections = ['attributes', 'commands', 'parameters'];
const segments = path => path.trim().split('.').filter(Boolean);
const rowKey = (section, path) => `${section}:${path}`;
const searchText = (values, locale) => values.filter(Boolean).join(' ').toLocaleLowerCase(locale);
const add = (map, key, value) => {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
};

export function inspectorNodeName(node, strings) {
  if (node.kind === 'Form') return strings.form;
  return node.name || (node.kind === 'AutoCommandBar' ? strings.commandBar : node.kind ?? node.xmlName?.name);
}

export function commandBinding(node) {
  const name = scalar(node, 'CommandName').trim();
  return name.startsWith('Form.Command.') ? name.slice('Form.Command.'.length) : '';
}

function formColumns(definition, path, append) {
  const columns = property(definition, 'Columns');
  if (columns?.value.kind !== 'record') return;
  for (const column of columns.value.fields) {
    if (column.key.namespace !== FORM_NS) continue;
    const name = column.qualifiers?.find(item => item.key.namespace === null && item.key.name === 'name')?.value;
    if (!name || column.value.kind !== 'record') continue;
    const next = `${path}.${name}`;
    append(next, property({ properties: column.value.fields }, 'Type'));
    formColumns({ properties: column.value.fields }, next, append);
  }
}

/** The snapshot owns this index. Selection, folding and search never parse the XML or rebuild it. */
export function indexInspector(model, locale, strings) {
  const nodes = new Map(), usages = new Map(), commandUses = new Map(), handlers = new Map();
  const byData = new Map(), definitions = Object.fromEntries(definitionSections.map(section => [section, []]));
  if (!model) return { nodes, usages, commandUses, handlers, byData, definitions };

  function visit(node, parent, depth, name) {
    const title = caption(node, { locale, strings });
    const label = inspectorNodeName(node, strings);
    const path = parent ? `${name} / ${label}` : label;
    const binding = scalar(node, 'DataPath').trim();
    const command = commandBinding(node);
    const children = treeChildren(node);
    const row = { node, key: node.key, parent, path, label, title, depth, binding, command,
      children: children.map(child => child.key), search: searchText([label, node.name, title, binding], locale) };
    nodes.set(node.key, row);
    if (binding) add(usages, binding, row);
    if (command) add(commandUses, command, row);
    for (const child of children) visit(child, node.key, depth + 1, path);
  }
  visit(model.root, '', 0, '');
  for (const [index, handler] of (model.handlers ?? []).entries()) {
    const owner = handler.owner.kind === 'element' ? key({ identity: handler.owner.identity }) : rowKey('commands', handler.owner.name);
    add(handlers, owner, { handler, index });
  }

  const children = new Map();
  function append(section, path, { definition, typeField, valueType, main, origin }) {
    const id = rowKey(section, path);
    if (byData.has(id)) return;
    const parts = segments(path);
    const name = parts.at(-1) ?? definition?.xmlName?.name ?? '';
    const parent = section === 'attributes' && parts.length > 1 ? rowKey(section, parts.slice(0, -1).join('.')) : '';
    const type = section === 'commands' ? undefined : inspectorType(typeField, valueType, locale, strings);
    const action = section === 'commands' ? scalar(definition, 'Action') : '';
    const row = { id, section, path, name, parent, depth: Math.max(0, parts.length - 1), main, definition, typeField, valueType, type, action, origin,
      search: searchText([name, path, type?.search, action], locale) };
    byData.set(id, row);
    if (parent) add(children, parent, row);
    else definitions[section].push(row);
  }
  for (const section of definitionSections) {
    for (const definition of model[section] ?? []) {
      if (!definition.name) continue;
      const main = section === 'attributes' && flag(definition, 'MainAttribute', false);
      append(section, definition.name, { definition, main, typeField: property(definition, 'Type'), valueType: definition.valueType });
      if (section === 'attributes') formColumns(definition, definition.name, (path, typeField) => append(section, path, { typeField }));
    }
  }
  for (const field of model.dataFields ?? []) {
    const path = field.path.join('.');
    const id = rowKey('attributes', path);
    const row = byData.get(id);
    if (row) {
      row.valueType = field.valueType;
      row.typeField ??= field.type;
      row.type = inspectorType(row.typeField, row.valueType, locale, strings);
      row.search = searchText([row.path, row.type.search], locale);
      row.origin = field.origin;
    } else append('attributes', path, { typeField: field.type, valueType: field.valueType, origin: field.origin });
  }
  // Earlier backends expose resolved types on bound elements. Keep exact path components in that mode.
  for (const [binding, elements] of usages) {
    const parts = segments(binding);
    if (parts.join('.') !== binding || parts.length < 2 || !byData.has(rowKey('attributes', parts[0]))) continue;
    for (let depth = 2; depth <= parts.length; depth++) {
      append('attributes', parts.slice(0, depth).join('.'), { valueType: depth === parts.length ? elements[0].node.presentation.valueType : undefined });
    }
  }
  return { nodes, usages, commandUses, handlers, byData, definitions, children };
}

export const inspectorTerms = (query, locale) => query.trim().toLocaleLowerCase(locale).split(/\s+/u).filter(Boolean);

function matchedRows(items, terms, find, rowKey) {
  if (!terms.length) return null;
  const result = new Set();
  for (const row of items) {
    if (!terms.every(term => row.search.includes(term))) continue;
    for (let entry = row; entry && !result.has(rowKey(entry)); entry = find(entry.parent)) result.add(rowKey(entry));
  }
  return result;
}

export function treeRows(index, folded, terms) {
  const matches = matchedRows(index.nodes.values(), terms, key => index.nodes.get(key), row => row.key);
  const root = index.nodes.values().next().value;
  const rows = [], stack = root ? [root] : [];
  while (stack.length) {
    const row = stack.pop();
    if (matches && !matches.has(row.key)) continue;
    rows.push(row);
    if (matches || !folded[row.key]) for (let i = row.children.length - 1; i >= 0; i--) stack.push(index.nodes.get(row.children[i]));
  }
  return rows;
}

export function attributeFor(index, path) {
  return path ? index.byData.get(rowKey('attributes', path)) : undefined;
}

export function commandFor(index, name) {
  return name ? index.byData.get(rowKey('commands', name)) : undefined;
}

export function dataRows(index, section, folded, terms) {
  const roots = index.definitions[section] ?? [];
  const matches = matchedRows(section === 'attributes' ? [...index.byData.values()].filter(row => row.section === section) : roots,
    terms, key => index.byData.get(key), row => row.id);
  const rows = [];
  function visit(row) {
    if (matches && !matches.has(row.id)) return;
    rows.push(row);
    if (matches || !folded[row.id]) for (const child of index.children.get(row.id) ?? []) visit(child);
  }
  const main = roots.filter(row => row.main);
  const other = roots.filter(row => !row.main);
  for (const [heading, entries] of [['primaryAttributes', main], ['formAttributes', other]]) {
    const start = rows.length;
    for (const row of entries) visit(row);
    if (section === 'attributes' && main.length && rows.length > start) rows.splice(start, 0, { id: heading, heading });
  }
  return rows;
}
