export const FORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
export function key(node) { const id = node?.identity; return id ? `${id.source}:${id.part}:${id.key.kind === 'root' ? 'root' : id.key.value}` : ''; }
function prepareFields(fields) {
  // XML property keys are objects. Solid needs a separate scalar key to retain
  // record components when the next JSON response creates fresh QName objects.
  const occurrences = new Map();
  return fields.map(field => {
    const name = JSON.stringify([field.key.namespace, field.key.name]), index = occurrences.get(name) ?? 0;
    occurrences.set(name, index + 1);
    return { ...field, reconcileKey: `${name}:${index}`, value: field.value.kind === 'record' ? { ...field.value, fields: prepareFields(field.value.fields) } : field.value };
  });
}
export function prepare(model) {
  const visit = node => ({ ...node, key: key(node), reconcileKey: key(node), properties: prepareFields(node.properties), children: node.children.map(visit), auxiliary: node.auxiliary.map(visit) });
  const result = { ...model, root: visit(model.root) };
  for (const section of ['attributes', 'commands', 'parameters']) if (model[section]) result[section] = model[section].map(definition => ({ ...definition,
    reconcileKey: JSON.stringify([definition.xmlName, definition.name]), properties: prepareFields(definition.properties) }));
  return result;
}
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
/** Select each enclosing page without changing unrelated page groups. */
export function pageSelections(root, selected) {
  const path = [];
  function visit(node) {
    if (!node) return false;
    path.push(node);
    if (node.key === selected) return true;
    for (const child of [...node.children, ...node.auxiliary]) if (visit(child)) return true;
    path.pop(); return false;
  }
  if (!visit(root)) return {};
  const pages = {};
  for (let i = 0; i + 1 < path.length; i++) if (path[i].kind === 'Pages' && path[i + 1].kind === 'Page') pages[path[i].key] = path[i + 1].key;
  return pages;
}
export function treeChildren(node) {
  return [...node.auxiliary, ...node.children].filter(child => !['ContextMenu', 'ExtendedTooltip'].includes(child.kind) && (child.kind !== 'AutoCommandBar' || child.children.length || node.kind === 'Table'));
}
export function flatten(root, folded = {}) { const rows = []; const visit = (node, depth) => { rows.push({ node, depth }); if (!folded[node.key]) for (const child of treeChildren(node)) visit(child, depth + 1); }; if (root) visit(root, 0); return rows; }
function fontPixels(node) { return Math.round((node.presentation.font?.points ?? 10) * 4 / 3); }
export function fontLineMetrics(value) {
  const pixels = Math.round((value?.points ?? 10) * 4 / 3);
  return { pixels, ascent: Math.ceil(pixels * 1854 / 2048), descent: Math.ceil(pixels * 434 / 2048) };
}
export function fontLineHeight(value) {
  const { ascent, descent } = fontLineMetrics(value);
  return ascent + descent;
}
/** Native raised-button padding scales from the 13px reference font. */
export function buttonMetrics(value) {
  const pixels = Math.round((value?.points ?? 10) * 4 / 3);
  return { horizontalPadding: pixels, verticalPadding: Math.round(pixels * 3 / 13), lineHeight: fontLineHeight(value) };
}
/** Discrete Linux button fill avoids Chromium's gradient dithering. Height excludes borders. */
export function buttonBackground(height, background = [255, 255, 255]) {
  if (!Number.isInteger(height) || height < 1 || height > 4096 || !Array.isArray(background) || background.length !== 3
      || background.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return;
  const shade = y => background.map(value => buttonBackgroundShade(height, y, value)).join(', ');
  const stops = [];
  let start = 0, color = shade(0);
  for (let y = 1; y <= height; y++) {
    const next = y === height ? undefined : shade(y);
    if (next !== color) {
      stops.push(`rgb(${color}) ${start}px ${y}px`);
      start = y; color = next;
    }
  }
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}
export function buttonBackgroundShade(height, y, channel = 255) {
  const sample = 2 * y + 1;
  // Native upper/lower rounding differs; CSS and caption pixels must share it.
  if (sample <= height) {
    const color16 = Math.floor((channel * height + Math.floor((255 - channel) * 63 / 255) * (height - sample)) * 257 / height);
    return (color16 + 128 - (color16 >> 8)) >> 8;
  }
  const step = Math.ceil((sample - height) * 1023 / height);
  return Math.round(channel - Math.ceil(channel * 20 / 255) * step / 1023);
}
// Reference Linux character units, calibrated against 10–16pt native inputs.
function inputUnit(node) { return (fontPixels(node) * 5 - 1) / 8; }
export function inputHeight(node, os) {
  const line = fontLineHeight(node.presentation.font);
  // Native Taxi scales the line allocation by 20/13, then rounds to a pixel.
  return os === 'linux' ? Math.round(line * 20 / 13) : Math.ceil(line * 1.5);
}
export function inputControlHeight(node, os) {
  const single = inputHeight(node, os);
  if (!flag(node, 'MultiLine', false)) return single;
  if (os !== 'linux') return Math.max(2, number(node, 'Height', 3)) * 20;
  const explicit = number(node, 'Height');
  const rows = explicit > 0 ? Math.max(1, explicit) : 2;
  // Linux Designer height units use the control height plus a gap measured at 8–20pt.
  const step = single + (single < 29 ? 5 : 6);
  return single + (rows - 1) * step;
}
export function inputRowHeight(node, os, captioned = true) {
  const height=inputHeight(node,os)+2;
  return os==='linux'&&captioned&&['Left','Right'].includes(node.presentation.titleLocation)
    ? Math.max(height,fontLineHeight(node.presentation.titleFont)+2) : height;
}
export function inputTextBaseline(height, value) {
  const {ascent,descent}=fontLineMetrics(value);
  // Preserve the native four-pixel top inset before centering the text line.
  return Math.max(ascent+3,Math.floor((height+ascent-descent)/2));
}
export function inputChoiceButton(node, os) {
  const type = node.presentation.valueType;
  const automatic = ['reference', 'composite', 'number'].includes(type.kind) || type.kind === 'date' && type.dateParts !== 'Time';
  return flag(node, 'ChoiceButton', automatic && !(os === 'linux' && ['number','date'].includes(type.kind) && flag(node, 'ReadOnly', false)));
}
export function linuxFixedInputWidth(node, os) {
  const kind = node.presentation.valueType.kind;
  return os === 'linux' && node.kind === 'InputField' && ['string', 'number', 'date'].includes(kind)
    && (kind === 'string' || !flag(node, 'MultiLine', false))
    && !flag(node, 'OpenButton', false) && !flag(node, 'ClearButton', false) && !flag(node, 'SpinButton', false)
    && !(kind === 'string' && inputChoiceButton(node, os));
}
function linuxSimpleInput(node, os) {
  return !flag(node, 'MultiLine', false) && linuxFixedInputWidth(node, os);
}
export function nativeReferenceInput(node, os) {
  return os === 'linux' && node.kind === 'InputField' && node.presentation.valueType.kind === 'reference'
    && !flag(node, 'MultiLine', false) && inputChoiceButton(node, os) && flag(node, 'OpenButton')
    && !flag(node, 'ClearButton', false) && !flag(node, 'SpinButton', false);
}
export function fieldWidth(node, os) {
  const unit = inputUnit(node);
  if (nativeReferenceInput(node, os)) {
    const width = Math.trunc(number(node, 'Width'));
    const text = width > 0 ? width * 10 + 11 : Math.round(20 * unit + 1);
    return text + 42;
  }
  const native = linuxFixedInputWidth(node, os), width = native ? Math.trunc(number(node, 'Width')) : number(node, 'Width');
  // Explicit Taxi widths use fixed character units, independent of the value font.
  if (width > 0) return native ? width * 10 + 11 + (inputChoiceButton(node, os) ? 20 : 0) : Math.max(20, width * unit + 4);
  if (['ProgressBarField', 'TrackBarField'].includes(node.kind)) return 320;
  if (node.kind === 'LabelField') return 150;
  const type = node.presentation.valueType;
  if (type.kind === 'number') return Math.round(Math.max(12, Math.min(24, (type.digits || 15) + 3)) * unit + 4 + 21) - (os === 'linux' && !inputChoiceButton(node, os) ? 20 : 0);
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
export function fieldStyle(node, os) {
  const native = linuxSimpleInput(node, os);
  // Native bounds do not change preferred dimensions in the Configurator preview.
  const maxWidth = native ? 0 : number(node, 'MaxWidth'), minWidth = native ? 0 : number(node, 'MinWidth');
  const automaticStretch = os === 'linux' && node.kind === 'InputField' && node.presentation.valueType.kind === 'string'
    && !property(node, 'HorizontalStretch') && (native || number(node, 'Width') <= 0 && maxWidth <= 0 && minWidth <= 0);
  const automaticMinimum = automaticStretch && number(node, 'Width') <= 0 && !node.presentation.valueType.length
    ? `min(100%, ${Math.round((fontPixels(node) - 1) * 100 / 3 + 10)}px)` : '100%';
  const stretch = flag(node, 'HorizontalStretch', false);
  // Keep the intrinsic preference; fill only the allocated column, including the choice outset.
  return { width: `${fieldWidth(node, os)}px`, ...(automaticStretch ? { 'min-width': automaticMinimum } : {}),
    ...(maxWidth > 0 ? { 'max-width': `${maxWidth * 8 + 4}px` } : {}), ...(minWidth > 0 ? { 'min-width': `${minWidth * 8 + 4}px` } : {}),
    ...(stretch ? native ? { 'min-width': inputChoiceButton(node, os) ? 'calc(100% - 1px)' : '100%' } : { width: '100%' } : {}) };
}
export function localizedProperty(value, locale) {
  if (value?.caption) return value.caption[locale.startsWith('ru') ? 'ru-RU' : 'en-US'];
  if (value?.kind === 'text') return value.text;
  if (value?.kind === 'localized') return text({ kind: 'literal', items: value.items }, locale);
  if (value?.kind === 'record') return value.fields.map(field => `${field.caption?.[locale.startsWith('ru') ? 'ru-RU' : 'en-US'] ?? field.key.name}: ${localizedProperty(field.value, locale)}`).join('; ');
  return value?.issue ?? '';
}
