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
  if (type?.namespace !== schema) return;
  if (['decimal', 'double', 'float', 'int', 'integer', 'long', 'short', 'byte', 'nonNegativeInteger'].includes(type.name)) return 'number';
  if (['dateTime', 'date', 'time'].includes(type.name)) return 'date';
  if (['string', 'boolean'].includes(type.name)) return type.name;
}

const qualifierGroups = new Map([
  ['string', ['StringQualifiers', [['Length', 'length'], ['AllowedLength']]]],
  ['number', ['NumberQualifiers', [['Digits', 'digits'], ['FractionDigits', 'fraction'], ['AllowedSign', 'allowedSign']]]],
  ['date', ['DateQualifiers', [['DateFractions', 'dateParts']]]],
]);
const dateFractions = { date: 'Date', time: 'Time', dateTime: 'DateTime' };

function members(field, valueType) {
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
  return fromField.length ? fromField : normalized;
}

function typePresentation(type, kind, language, strings) {
  const { namespace, name } = type ?? {};
  if (['string', 'number', 'boolean', 'date'].includes(kind)) return { label: typeText(strings, kind) };
  const dot = name?.indexOf('.') ?? -1;
  if (namespace === config && dot > 0) {
    return { label: name.slice(dot + 1), category: typeText(strings, name.slice(0, dot)) };
  }
  if (!name && ['table', 'reference'].includes(kind)) return { label: typeText(strings, kind) };
  const translated = type?.entry?.value.caption?.[language];
  if (namespace === core || namespace === config) return { label: strings[`dataType.${name}`] ?? translated ?? name };
  return { label: translated ?? (type ? qualifiedName(type) : typeText(strings, 'unknown')) };
}

function qualifier(field, valueType, group, name, fallback) {
  return content(nested(nested(field, group), name)) ?? (fallback ? valueType?.[fallback] : undefined);
}

const typeLanguage = locale => locale.startsWith('ru') ? 'ru-RU' : 'en-US';

/** Summaries are for scanning. The original qualified names and annotations remain available separately. */
export function inspectorType(field, valueType, locale, strings) {
  const types = members(field, valueType), language = typeLanguage(locale);
  const length = qualifier(field, valueType, 'StringQualifiers', 'Length', 'length');
  const digits = qualifier(field, valueType, 'NumberQualifiers', 'Digits', 'digits');
  const fraction = qualifier(field, valueType, 'NumberQualifiers', 'FractionDigits', 'fraction');
  const dateParts = qualifier(field, valueType, 'DateQualifiers', 'DateFractions', 'dateParts');
  function compact(type, fallback) {
    const kind = primitive(type) ?? fallback;
    const presentation = typePresentation(type, kind, language, strings);
    if (kind === 'string' && Number(length) > 0) return { label: `${presentation.label} (${length})` };
    if (kind === 'number' && digits != null) {
      return { label: `${presentation.label} (${digits}${fraction != null ? `, ${fraction}` : ''})` };
    }
    if (kind === 'date') {
      const parts = dateParts ?? dateFractions[type?.name];
      return { label: typeText(strings, parts === 'Time' ? 'time' : parts === 'DateTime' ? 'dateTime' : 'date') };
    }
    return presentation;
  }
  const parts = types.map(type => compact(type));
  const summary = types.length > 1 ? { label: typeText(strings, 'composite'), category: String(types.length) }
    : compact(types[0], valueType?.kind);
  return {
    ...summary,
    count: types.length,
    search: [summary.label, ...parts.flatMap(part => [part.label, part.category, part.category && `${part.category}.${part.label}`]),
      ...types.map(qualifiedName)].filter(Boolean).join(' '),
  };
}

/** Keep each member's qualifiers with the relevant primitive, including in a composite type. */
export function inspectorTypeDetails(field, valueType, locale, strings) {
  const types = members(field, valueType), language = typeLanguage(locale);
  return (types.length ? types : [undefined]).map(type => {
    const kind = primitive(type) ?? (types.length <= 1 ? valueType?.kind : undefined);
    const group = qualifierGroups.get(kind);
    const facts = [];
    for (const [name, fallback] of group?.[1] ?? []) {
      const value = qualifier(field, valueType, group[0], name, fallback)
        ?? (name === 'DateFractions' ? dateFractions[type?.name] : undefined);
      if (value == null) continue;
      const display = strings[`typeQualifier.${name}.${value}`] ?? String(value);
      facts.push({ label: strings[`typeQualifier.${name}`] ?? name, value: display });
    }
    return { ...typePresentation(type, kind, language, strings), facts };
  });
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
