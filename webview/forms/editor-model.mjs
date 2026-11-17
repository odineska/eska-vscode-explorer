import { FORM_NS } from './model.mjs';

export const CORE_NS = 'http://v8.1c.ru/8.1/data/core';
export const XS_NS = 'http://www.w3.org/2001/XMLSchema';
export const definitionSections = { attributes: 'attribute', commands: 'command', parameters: 'parameter' };

export function elementTarget(node, root) {
  if (node?.identity.source !== root?.identity.source || !node?.kind) return;
  if (node.identity.key.kind === 'root') return { kind: 'root' };
  const id = Number(node.identity.key.value);
  if (Number.isSafeInteger(id)) return { kind: 'element', id };
}

export function dataTarget(row) {
  if (!row?.definition && !row?.formColumn) return;
  const kind = definitionSections[row.section];
  if (kind) return { kind, name: row.path };
}

export function targetKey(target) {
  return target ? target.kind + ':' + (target.id ?? target.name ?? '') : '';
}

export function formEditIndex(schema) {
  return new Map(schema?.nodes.map(node => [targetKey(node.target), node]));
}

export function formCatalogue(schema, node) {
  if (!node) return [];
  const kinds = ['attribute', 'parameter', 'command'].includes(node.target.kind) ? schema.definitionKinds : schema.elementKinds;
  return kinds.find(item => item.kind === node.kind)?.catalog ?? [];
}

export function property(name, value, qualifiers = [], namespace = FORM_NS) {
  return { key: { name, namespace }, qualifiers, value };
}

export function textProperty(name, text, namespace = FORM_NS) {
  return property(name, { Text: text }, [], namespace);
}

export function addType(key) {
  return property('Type', { Record: [property('Type', { QualifiedText: { text: key.name, key } }, [], CORE_NS)] });
}

export function scalar(value) {
  return value?.Text ?? value?.TypedText?.text ?? '';
}

export function localized(value, language) {
  if (value?.Localized) return value.Localized;
  if (!value?.Record) return value ? [{ language, content: scalar(value) }] : [];
  return value.Record.filter(item => item.key.namespace === CORE_NS && item.key.name === 'item').map(item => {
    const fields = item.value.Record ?? [];
    return {
      language: scalar(fields.find(field => field.key.namespace === CORE_NS && field.key.name === 'lang')?.value),
      content: scalar(fields.find(field => field.key.namespace === CORE_NS && field.key.name === 'content')?.value),
    };
  }).filter(item => item.language);
}

export function defaultLanguage(model) {
  return model?.scriptVariant === 'english' ? 'en' : 'ru';
}
