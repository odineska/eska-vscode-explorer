import { dataTarget, elementTarget, formCatalogue, formEditIndex, targetKey } from './editor-model.mjs';
import { inspectorTerms, definitionSections } from './inspector-model.mjs';
import { key, text } from './model.mjs';
import { localizedEntries } from '../../resources/properties/model.mjs';

function fieldValue(value, locale, strings) {
  if (!value) return '';
  const items = localizedEntries(value);
  if (items) return text({ kind: 'literal', items }, locale, strings);
  if (value.kind === 'record') return value.fields.map(field => fieldValue(field.value, locale, strings)).join(' ');
  return value.text || '';
}

/** Read actual form data, including localized property captions and values. */
export function searchForm(index, state, query, limit = 100) {
  const terms = inspectorTerms(query, state.locale);
  if (!terms.length) return [];
  const locale = state.locale.startsWith('ru') ? 'ru-RU' : 'en-US';
  const matches = (...values) => {
    const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase(state.locale);
    return terms.every(term => haystack.includes(term));
  };
  const results = [];
  const schema = state.editSchema, editNodes = formEditIndex(schema);
  const append = (kind, row, title, context, property) => {
    if (results.length < limit) results.push({ kind, row, title, context, property });
  };
  for (const row of index.nodes.values()) {
    if (matches(row.search)) append('element', row, row.title || row.label, row.path);
  }
  for (const row of index.byData.values()) {
    if (matches(row.search)) append(row.section, row, row.label, row.type ? row.displayPath + ' · ' + row.type.search : row.displayPath);
  }
  function findProperties(row, target, kind, properties, path) {
    const available = new Map(formCatalogue(schema, editNodes.get(targetKey(target))).map(field => [field.name, field]));
    for (const item of properties) {
      const name = item.key.name;
      const field = available.get(name);
      const id = field?.id ?? name;
      const label = schema?.propertyCaptions[id]?.[locale] ?? item.caption?.[locale] ?? name;
      const raw = fieldValue(item.value, state.locale, state.strings);
      const value = schema?.choiceCaptions[id]?.[raw]?.[locale] ?? raw;
      if (matches(label, name, raw, value, path) && terms.some(term => !path.toLocaleLowerCase(state.locale).includes(term))) {
        append(kind, row, label, value ? path + ' · ' + value : path, id);
      }
    }
  }
  const remote = state.propertyMatches;
  if (state.propertySearch && remote?.query === query && remote.revision === state.revision && remote.formSessionId === state.formSessionId) {
    for (const hit of remote.results) {
      const row = index.nodes.get(key({ identity: hit.identity }));
      if (row) append('element', row, hit.label, row.path + (hit.value ? ' · ' + hit.value : ''), hit.id);
    }
  }
  if (!state.propertySearch) for (const row of index.nodes.values()) {
    if (results.length === limit) break;
    const palette = state.selected === row.key ? state.palette : null;
    const hidden = new Set(palette?.rows?.filter(item => item.available === false).map(item => item.id.replace(/^platform:/, '')));
    findProperties(row, elementTarget(row.node, state.model.root), 'element',
      row.node.properties.filter(item => !hidden.has(item.key.name)), row.path);
    for (const item of palette?.rows ?? []) {
      if (item.available === false || item.value.kind !== 'absent') continue;
      const label = item.caption?.[locale];
      const value = item.value.caption?.[locale] ?? item.value.default.value;
      if (label && matches(label, value)) append('element', row, label, row.path + (value ? ' · ' + value : ''), item.id);
    }
  }
  for (const section of definitionSections) {
    for (const row of index.definitions[section]) {
      if (results.length === limit) break;
      findProperties(row, dataTarget(row), section, row.definition.properties, row.displayPath);
    }
  }
  return results;
}
