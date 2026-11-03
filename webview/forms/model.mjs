export const FORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
export function key(node) { const id = node?.identity; return id ? `${id.source}:${id.part}:${id.key.kind === 'root' ? 'root' : id.key.value}` : ''; }
export function prepare(model) { const visit = node => ({ ...node, key: key(node), children: node.children.map(visit), auxiliary: node.auxiliary.map(visit) }); return { ...model, root: visit(model.root) }; }
export function property(node, name) { return node?.properties?.find(value => value.key.namespace === FORM_NS && value.key.name === name); }
export function scalar(node, name, fallback = '') { const value = property(node, name)?.value; return value?.kind === 'text' ? value.text : fallback; }
export function number(node, name, fallback = 0) { const text = scalar(node, name); return text !== '' && Number.isFinite(Number(text)) ? Number(text) : fallback; }
export function flag(node, name, fallback = true) { const value = scalar(node, name); return value === 'false' || value === '0' ? false : value === 'true' || value === '1' ? true : fallback; }
export function viewStatusAddition(node) {
  return scalar(node, 'ViewStatusLocation') === 'None' ? undefined : node.auxiliary.find(item => item.kind === 'ViewStatusAddition' && item.presentation.displayed !== false && flag(item, 'Visible'));
}
export function text(value, locale, strings) {
  if (!value) return '';
  if (value.kind === 'name') return value.text;
  if (value.kind === 'standard') return strings?.[value.key] ?? value.key.split('.').at(-1);
  const language = locale.toLowerCase(), base = language.split('-')[0];
  return (value.items.find(item => item.language.toLowerCase() === language) ?? value.items.find(item => item.language.toLowerCase() === base) ?? value.items[0])?.content ?? '';
}
export function caption(node, state) { return text(node?.presentation?.caption, state.locale, state.strings); }
export function automaticCommands(node) {
  return node.presentation.autoCommandItems ?? node.presentation.autoCommands.map((name, index) => ({ key: name, caption: { kind: 'standard', key: `command.${name}` }, primary: index === 0 }));
}
export function font(value, os) {
  const aliases = { Arial: 'ESKA Taxi Sans', 'Liberation Sans': 'ESKA Taxi Sans', 'Times New Roman': 'ESKA Taxi Serif', 'Liberation Serif': 'ESKA Taxi Serif', 'Courier New': 'ESKA Taxi Mono', 'Liberation Mono': 'ESKA Taxi Mono' };
  const face = value?.face ? os === 'linux' ? aliases[value.face] ?? value.face : value.face : os === 'linux' ? 'ESKA Taxi Sans' : 'Arial';
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
export function treeChildren(node) {
  return [...node.auxiliary, ...node.children].filter(child => !['ContextMenu', 'ExtendedTooltip'].includes(child.kind) && (child.kind !== 'AutoCommandBar' || child.children.length || node.kind === 'Table'));
}
export function flatten(root, folded = {}) { const rows = []; const visit = (node, depth) => { rows.push({ node, depth }); if (!folded[node.key]) for (const child of treeChildren(node)) visit(child, depth + 1); }; if (root) visit(root, 0); return rows; }
function fontPixels(node) { return Math.round((node.presentation.font?.points ?? 10) * 4 / 3); }
// Reference Linux character units, calibrated against 10–16pt native inputs.
function inputUnit(node) { return (fontPixels(node) * 5 - 1) / 8; }
export function inputHeight(node) {
  // Linux reference Liberation Sans metrics; confirmed at 10, 12, 14 and 16pt.
  const pixels = fontPixels(node), line = Math.ceil(pixels * 1854 / 2048) + Math.ceil(pixels * 434 / 2048);
  return Math.ceil(line * 1.5);
}
export function fieldWidth(node) {
  const unit = inputUnit(node), width = number(node, 'Width'); if (width > 0) return Math.max(20, width * unit + 4);
  if (['ProgressBarField', 'TrackBarField'].includes(node.kind)) return 320;
  if (node.kind === 'LabelField') return 150;
  const type = node.presentation.valueType;
  if (type.kind === 'number') return Math.round(Math.max(12, Math.min(24, (type.digits || 15) + 3)) * unit + 4 + 21);
  if (type.kind === 'reference') return Math.round(50 * unit + 11);
  if (type.kind === 'date') return Math.round(type.dateParts === 'Time' ? 11 * unit + 3 : type.dateParts === 'Date' ? 12 * unit + 25 : 20 * unit + 21);
  if (type.kind === 'string') return Math.round(type.length ? Math.max(100, Math.min(50, type.length) * unit + 11) : 20 * unit + 1);
  return Math.round(20 * unit + 1);
}
export function fieldValue(node, culture) {
  const type = node.presentation.valueType;
  if (type.kind === 'number') return '0';
  if (type.kind === 'date') {
    const sample = new Date(2001, 10, 22, 1, 2, 3);
    const empty = part => ['month', 'day', 'hour', 'minute', 'second'].includes(part.type) ? '  ' : part.type === 'year' ? '    ' : part.value.replaceAll('\u202f', ' ');
    const date = new Intl.DateTimeFormat(culture, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(sample).map(empty).join('');
    const time = new Intl.DateTimeFormat(culture, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(sample).map(empty).join('');
    return type.dateParts === 'Time' ? time : type.dateParts === 'Date' ? date : `${date} ${time}`;
  }
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
