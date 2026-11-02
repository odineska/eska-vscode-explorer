export const FORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
export function key(node) { const id = node?.identity; return id ? `${id.source}:${id.part}:${id.key.kind === 'root' ? 'root' : id.key.value}` : ''; }
export function prepare(model) { const visit = node => ({ ...node, key: key(node), children: node.children.map(visit), auxiliary: node.auxiliary.map(visit) }); return { ...model, root: visit(model.root) }; }
export function property(node, name) { return node?.properties?.find(value => value.key.namespace === FORM_NS && value.key.name === name); }
export function scalar(node, name, fallback = '') { const value = property(node, name)?.value; return value?.kind === 'text' ? value.text : fallback; }
export function number(node, name, fallback = 0) { const text = scalar(node, name); return text !== '' && Number.isFinite(Number(text)) ? Number(text) : fallback; }
export function flag(node, name, fallback = true) { const value = scalar(node, name); return value === 'false' || value === '0' ? false : value === 'true' || value === '1' ? true : fallback; }
export function text(value, locale, strings) {
  if (!value) return '';
  if (value.kind === 'name') return value.text;
  if (value.kind === 'standard') return strings?.[value.key] ?? value.key.split('.').at(-1);
  const language = locale.toLowerCase(), base = language.split('-')[0];
  return (value.items.find(item => item.language.toLowerCase() === language) ?? value.items.find(item => item.language.toLowerCase() === base) ?? value.items[0])?.content ?? '';
}
export function caption(node, state) { return text(node?.presentation?.caption, state.locale, state.strings); }
export function font(value, os) {
  const aliases = { Arial: 'Liberation Sans', 'Times New Roman': 'Liberation Serif', 'Courier New': 'Liberation Mono' };
  const face = value?.face ? os === 'linux' ? aliases[value.face] ?? value.face : value.face : os === 'linux' ? 'Liberation Sans' : 'Arial';
  return { 'font-family': `${JSON.stringify(face)}, Arial, sans-serif`, 'font-size': `${(value?.points ?? 10) * 4 / 3}px`, 'font-weight': value?.weight ?? 400,
    'font-style': value?.italic ? 'italic' : 'normal', 'text-decoration': [value?.underline && 'underline', value?.strikeout && 'line-through'].filter(Boolean).join(' ') || 'none' };
}
const system = { Window: '#fff', WindowText: '#000', ButtonFace: '#f0f0f0', ButtonText: '#000', GrayText: '#808080', Highlight: '#0078d7', HighlightText: '#fff', InfoBackground: '#ffffe1', InfoText: '#000', ActiveBorder: '#b4b4b4', InactiveBorder: '#f4f7fc', AppWorkspace: '#ababab' };
export function color(value) {
  if (!value) return '';
  if (value.kind === 'rgb' || value.kind === 'web') return value.value;
  if (value.kind === 'system') return system[value.value] ?? '#808080';
  return `var(--taxi-${value.value}, var(--taxi-TextColor))`;
}
export function find(root, identity) { const id = typeof identity === 'string' ? identity : key({ identity }); if (root?.key === id) return root; for (const child of [...root?.children ?? [], ...root?.auxiliary ?? []]) { const found = find(child, id); if (found) return found; } }
export function flatten(root, folded = {}) { const rows = []; const visit = (node, depth) => { rows.push({ node, depth }); if (!folded[node.key]) for (const child of [...node.auxiliary, ...node.children]) visit(child, depth + 1); }; if (root) visit(root, 0); return rows; }
export function fieldWidth(node) {
  const width = number(node, 'Width'); if (width > 0) return Math.max(20, width * 8 + 4);
  const type = node.presentation.valueType;
  if (type.kind === 'number') return Math.max(80, Math.min(24, (type.digits ?? 12) + 2) * 8 + 4);
  if (type.kind === 'date') return type.dateParts === 'Time' ? 92 : type.dateParts === 'Date' ? 116 : 180;
  if (type.kind === 'string') return type.length ? Math.max(100, Math.min(50, type.length) * 8 + 11) : 161;
  return 161;
}
export function fieldValue(node) {
  const type = node.presentation.valueType;
  if (type.kind === 'number') return (0).toFixed(Math.min(type.fraction ?? 0, 12)).replace('.', ',');
  if (type.kind === 'date') return type.dateParts === 'Time' ? '0:00:00' : type.dateParts === 'DateTime' ? '01.01.0001 0:00:00' : '01.01.0001';
  return '';
}
export function fieldStyle(node) {
  const maxWidth = number(node, 'MaxWidth'), minWidth = number(node, 'MinWidth');
  return { width: `${fieldWidth(node)}px`, ...(maxWidth > 0 ? { 'max-width': `${maxWidth * 8 + 4}px` } : {}), ...(minWidth > 0 ? { 'min-width': `${minWidth * 8 + 4}px` } : {}),
    ...(flag(node, 'HorizontalStretch', false) ? { width: '100%' } : {}) };
}
export function localizedProperty(value, locale) {
  if (value?.caption) return value.caption[locale.startsWith('ru') ? 'ru-RU' : 'en-US'];
  if (value?.kind === 'text') return value.text;
  if (value?.kind === 'localized') return text({ kind: 'literal', items: value.items }, locale);
  if (value?.kind === 'record') return value.fields.map(field => `${field.key.name}: ${localizedProperty(field.value, locale)}`).join('; ');
  return value?.issue ?? '';
}
