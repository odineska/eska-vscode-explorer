const schema = 'http://www.w3.org/2001/XMLSchema';
const core = 'http://v8.1c.ru/8.1/data/core';
const config = 'http://v8.1c.ru/8.1/data/enterprise/current-config';
const namespaces = { xs: schema, xsd: schema, v8: core, cfg: config };
const prefix = { [schema]: 'xs', [core]: 'v8', [config]: 'cfg' };

const fields = field => field?.value.kind === 'record' ? field.value.fields : [];
const content = field => field?.value.kind === 'text' ? field.value.text : undefined;
const nested = (field, name) => fields(field).find(value => value.key.namespace === core && value.key.name === name);
const names = field => fields(field).filter(value => value.key.namespace === core && ['Type', 'TypeSet'].includes(value.key.name));
const typeText = (strings, name) => strings[`dataType.${name}`] ?? name;

function rawName(field) {
  const raw = content(field)?.trim();
  if (!raw) return;
  const colon = raw.indexOf(':');
  return colon < 0 ? { name: raw, raw } : {
    namespace: namespaces[raw.slice(0, colon)], name: raw.slice(colon + 1), raw,
  };
}

function qualifiedName(type) {
  if (type.raw) return type.raw;
  return type.namespace ? prefix[type.namespace] ? `${prefix[type.namespace]}:${type.name}` : `{${type.namespace}}${type.name}` : type.name;
}

function primitive(type) {
  if (type.namespace !== schema) return;
  if (['decimal', 'double', 'float', 'int', 'integer', 'long', 'short', 'byte', 'nonNegativeInteger'].includes(type.name)) return 'number';
  if (['dateTime', 'date', 'time'].includes(type.name)) return 'date';
  if (['string', 'boolean'].includes(type.name)) return type.name;
}

/** Summaries are for scanning. The original qualified names and annotations remain available separately. */
export function inspectorType(field, valueType, locale, strings) {
  const entries = names(field);
  const normalized = valueType?.types ?? [];
  // Match by occurrence. Unknown TypeSet entries must not disappear when only Type was resolved.
  let index = 0;
  const fromField = entries.flatMap(entry => {
    const name = rawName(entry);
    if (!name) return [];
    const candidate = normalized[index];
    const resolved = entry.key.name === 'Type' && candidate?.name === name.name ? normalized[index++] : undefined;
    return [{ ...name, ...resolved, entry }];
  });
  const types = fromField.length ? fromField : normalized;
  const qualifier = (group, name) => content(nested(nested(field, group), name));
  const length = qualifier('StringQualifiers', 'Length') ?? valueType?.length;
  const digits = qualifier('NumberQualifiers', 'Digits') ?? valueType?.digits;
  const fraction = qualifier('NumberQualifiers', 'FractionDigits') ?? valueType?.fraction;
  const dateParts = qualifier('DateQualifiers', 'DateFractions') ?? valueType?.dateParts;
  const language = locale.startsWith('ru') ? 'ru-RU' : 'en-US';

  function present(type, fallback) {
    const { namespace, name } = type ?? {};
    const kind = primitive(type ?? {}) ?? fallback;
    if (kind === 'string') return { label: typeText(strings, 'string') + (Number(length) > 0 ? ` (${length})` : '') };
    if (kind === 'number') return { label: typeText(strings, 'number') + (digits != null ? ` (${digits}${fraction != null ? `, ${fraction}` : ''})` : '') };
    if (kind === 'boolean') return { label: typeText(strings, 'boolean') };
    if (kind === 'date') return { label: typeText(strings, dateParts === 'Time' || name === 'time' ? 'time'
      : dateParts === 'DateTime' || dateParts == null && name === 'dateTime' ? 'dateTime' : 'date') };
    const dot = name?.indexOf('.') ?? -1;
    if (namespace === config && dot > 0) {
      const category = name.slice(0, dot);
      return { label: name.slice(dot + 1), category: typeText(strings, category) };
    }
    if (!name && ['table', 'reference'].includes(kind)) return { label: typeText(strings, kind) };
    const translated = type?.entry?.value.caption?.[language];
    if (namespace === core || namespace === config) return { label: strings[`dataType.${name}`] ?? translated ?? name };
    return { label: translated ?? (type ? qualifiedName(type) : typeText(strings, 'unknown')) };
  }

  const parts = types.map(type => present(type));
  const summary = types.length > 1 ? { label: typeText(strings, 'composite'), category: String(types.length) }
    : present(types[0], valueType?.kind);
  return {
    ...summary,
    count: types.length,
    search: [summary.label, ...parts.flatMap(part => [part.label, part.category, part.category && `${part.category}.${part.label}`]),
      ...types.map(qualifiedName)].filter(Boolean).join(' '),
  };
}

function technicalField(field, depth = 0) {
  const indent = '  '.repeat(depth);
  const key = field.key.namespace && field.key.namespace !== core ? `{${field.key.namespace}}${field.key.name}` : field.key.name;
  const annotations = (field.qualifiers ?? []).map(({ key, value }) => `${key.namespace ? `{${key.namespace}}` : ''}${key.name}=${JSON.stringify(value)}`).join(' ');
  const label = annotations ? `${key} [${annotations}]` : key;
  if (field.value.kind === 'record') return [indent + label, ...fields(field).flatMap(child => technicalField(child, depth + 1))];
  if (field.value.kind === 'localized') return [indent + label, ...field.value.items.map(item => `${indent}  ${item.language} = ${item.content}`)];
  return [`${indent}${label} = ${content(field) ?? field.value.issue ?? ''}`];
}

export function technicalType(field, type) {
  if (field) return technicalField(field).join('\n');
  if (!type) return '';
  const values = type.types?.map(qualifiedName) ?? [];
  if (!values.length && type.kind && type.kind !== 'unknown') values.push(`Kind = ${type.kind}`);
  for (const [name, value] of [['Length', type.length], ['Digits', type.digits], ['FractionDigits', type.fraction],
    ['AllowedSign', type.allowedSign], ['DateFractions', type.dateParts]]) if (value != null) values.push(`${name} = ${value}`);
  return values.join('\n');
}
