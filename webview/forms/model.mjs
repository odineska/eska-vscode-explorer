import { localizedEntries } from '../../resources/properties/model.mjs';
import { emptyDateMask } from './date-mask.mjs';

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
function prepareCommand(command) {
  return { ...command, reconcileKey: command.key, ...(command.items ? { items: command.items.map(prepareCommand) } : {}) };
}
export function prepare(model) {
  const visit = node => {
    const { autoCommandItems, objectCommandMenu, tableCommandMenu } = node.presentation ?? {};
    const presentation = autoCommandItems || objectCommandMenu || tableCommandMenu ? { ...node.presentation,
      ...(autoCommandItems ? { autoCommandItems: autoCommandItems.map(prepareCommand) } : {}),
      ...(objectCommandMenu ? { objectCommandMenu: objectCommandMenu.map(group => group.map(prepareCommand)) } : {}),
      ...(tableCommandMenu ? { tableCommandMenu: tableCommandMenu.map(group => group.map(prepareCommand)) } : {}),
    } : node.presentation;
    return { ...node, key: key(node), reconcileKey: key(node), properties: prepareFields(node.properties), presentation,
      children: node.children.map(visit), auxiliary: node.auxiliary.map(visit) };
  };
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
export function formatSettings(value, locale) {
  const items = value && localizedEntries(value);
  const format = items ? text({ kind: 'literal', items }, locale) : value?.kind === 'text' ? value.text : '';
  const settings = new Map();
  // Quoted values can contain a separator or a doubled quote.
  const parameters = /(?:^|;)\s*(\p{L}+)\s*=\s*(?:"((?:""|[^"])*)"|'((?:''|[^'])*)'|([^;]*))\s*(?=;|$)/gu;
  for (const [, key, double, single, plain] of format.matchAll(parameters)) {
    settings.set(key.toUpperCase(), double?.replaceAll('""', '"') ?? single?.replaceAll("''", "'") ?? plain.trim());
  }
  return settings;
}
export function caption(node, state) {
  const view = node?.presentation;
  const value = text(view?.caption, state.locale, state.strings);
  return view?.tabularTotal === 'automatic'
    ? (state.strings?.['attribute.TabularTotal'] ?? '{caption}').replace('{caption}', () => value)
    : value;
}
export function automaticCommands(node, state) {
  const items = node.presentation.autoCommandItems ?? node.presentation.autoCommands.map((name, index) => ({ key: name, caption: { kind: 'standard', key: `command.${name}` }, primary: index === 0 }));
  return orderedCommands(items, state);
}
export function orderedCommands(items, state) {
  if (!state) return items;
  const { locale, strings } = state;
  const collator = new Intl.Collator(locale);
  const ordered = group => {
    const generated = group.filter(item => item.orderByCaption);
    if (generated.length < 2) return group;
    generated.sort((left, right) => collator.compare(text(left.caption, locale, strings), text(right.caption, locale, strings)));
    let index = 0;
    return group.map(item => item.orderByCaption ? generated[index++] : item);
  };
  return ordered(items).map(item => {
    const children = item.items && ordered(item.items);
    return children === item.items ? item : { ...item, items: children };
  });
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
export function fontPixels(value) { return Math.round((value?.points ?? 10) * 4 / 3); }
export function fontLineMetrics(value) {
  const pixels = fontPixels(value);
  return { pixels, ascent: Math.ceil(pixels * 1854 / 2048), descent: Math.ceil(pixels * 434 / 2048) };
}
export function fontLineHeight(value) {
  const { ascent, descent } = fontLineMetrics(value);
  return ascent + descent;
}
/** Designer retains Width in XML but ignores it for Linux command-bar buttons. */
export function buttonAuthoredWidth(node, os) {
  return os === 'linux' && scalar(node, 'Type') === 'CommandBarButton' ? 0 : number(node, 'Width');
}

/** Native raised-button padding scales from the 13px reference font. */
export function buttonMetrics(value) {
  const { pixels, ascent, descent } = fontLineMetrics(value);
  return { horizontalPadding: pixels, verticalPadding: Math.round(pixels * 3 / 13), lineHeight: ascent + descent };
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
function inputUnit(node) { return (fontPixels(node.presentation.font) * 5 - 1) / 8; }
const inputChoiceWidth = 20;
const referenceOpenWidth = 22;
export const referenceButtonWidth = inputChoiceWidth + referenceOpenWidth;

export function automaticTextWidth(node) {
  return Math.round((fontPixels(node.presentation.font) - 1) * 100 / 3 + 10);
}
/** Intrinsic size of a single-line numeric label in Linux Designer. */
export function numericLabelMetrics(node, os) {
  const type = node.presentation.valueType;
  if (os !== 'linux' || node.kind !== 'LabelField' || type?.kind !== 'number' || !type.digits
      || number(node, 'Height') > 1 || !['Left', 'None'].includes(node.presentation.titleLocation)) return;
  const painted = !!property(node, 'BackColor');
  const widthOutset = painted ? 2 : 0;
  const size = fontLineMetrics(node.presentation.font);
  const scale = (size.pixels - 1) / 12;
  const fraction = type.fraction ?? 0;
  const separators = Math.floor(Math.max(0, type.digits - fraction - 1) / 3);
  const digits = type.digits * 8 + separators * 4 + (fraction ? 2 : 0);
  const authored = Math.trunc(number(node, 'Width'));
  const preferred = (authored > 0 ? authored * 10 : Math.round(Math.max(50, digits) * scale)) + widthOutset;
  return {
    preferred,
    minimum: Math.min(preferred, Math.round(60 * scale) + widthOutset),
    maximum: Math.max(preferred, Math.round(400 * scale) + widthOutset),
    height: size.ascent + size.descent + (painted ? 4 : 2),
    widthOutset,
  };
}

export function inputHeight(node, os) {
  const line = fontLineHeight(node.presentation.font);
  // Native Taxi scales the line allocation by 20/13, then rounds to a pixel.
  return os === 'linux' ? Math.round(line * 20 / 13) : Math.ceil(line * 1.5);
}
export function inputRows(node) {
  if (!flag(node, 'MultiLine', false)) return 1;
  const explicit = number(node, 'Height');
  return explicit > 0 ? Math.max(1, explicit) : 2;
}
export function inputControlHeight(node, os) {
  const single = inputHeight(node, os);
  if (os !== 'linux') return flag(node, 'MultiLine', false) ? Math.max(2, number(node, 'Height', 3)) * 20 : single;
  // Linux Designer height units use the control height plus a gap measured at 8–20pt.
  const step = single + (single < 29 ? 5 : 6);
  return single + (inputRows(node) - 1) * step;
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
  const readOnly = os === 'linux' && flag(node, 'ReadOnly', false) && ['number', 'date', 'reference'].includes(type.kind);
  return flag(node, 'ListChoiceMode', false) || flag(node, 'ChoiceButton', automatic && !readOnly);
}
export function linuxFixedInputWidth(node, os) {
  const kind = node.presentation.valueType.kind;
  return os === 'linux' && node.kind === 'InputField' && ['string', 'number', 'date'].includes(kind)
    && (kind === 'string' || !flag(node, 'MultiLine', false))
    && !flag(node, 'OpenButton', false) && !flag(node, 'ClearButton', false) && !flag(node, 'SpinButton', false);
}
function linuxSimpleInput(node, os) {
  return !flag(node, 'MultiLine', false) && linuxFixedInputWidth(node, os);
}
function linuxReferenceWithOpenButton(node, os) {
  return os === 'linux' && node.kind === 'InputField' && node.presentation.valueType.kind === 'reference'
    && !flag(node, 'MultiLine', false) && flag(node, 'OpenButton')
    && !flag(node, 'ClearButton', false) && !flag(node, 'SpinButton', false);
}
export function nativeReferenceInput(node, os) {
  return linuxReferenceWithOpenButton(node, os) && inputChoiceButton(node, os);
}
export function fieldWidth(node, os) {
  const unit = inputUnit(node);
  const reference = linuxReferenceWithOpenButton(node, os);
  const native = reference || linuxFixedInputWidth(node, os);
  const width = native ? Math.trunc(number(node, 'Width')) : number(node, 'Width');
  // Explicit Taxi widths use fixed character units, independent of the value font.
  if (width > 0) {
    if (!native) return Math.max(20, width * unit + 4);
    const buttons = (reference ? referenceOpenWidth : 0) + (inputChoiceButton(node, os) ? inputChoiceWidth : 0);
    return width * 10 + 11 + buttons;
  }
  if (reference && inputChoiceButton(node, os)) return Math.round(20 * unit + 1) + referenceButtonWidth;
  if (['ProgressBarField', 'TrackBarField'].includes(node.kind)) return 320;
  if (node.kind === 'LabelField') return 150;
  const type = node.presentation.valueType;
  if (type.kind === 'number') return Math.round(Math.max(12, Math.min(24, (type.digits || 15) + 3)) * unit + 4 + 21) - (os === 'linux' && !inputChoiceButton(node, os) ? 20 : 0);
  if (type.kind === 'reference') return Math.round(50 * unit + 11);
  if (type.kind === 'date') {
    if (type.dateParts === 'Time') return Math.round(11 * unit + 3);
    const width = type.dateParts === 'Date' ? 12 * unit + 25 : 20 * unit + 21;
    return Math.round(width) - (os === 'linux' && !inputChoiceButton(node, os) ? 20 : 0);
  }
  if (type.kind === 'string') return Math.round(type.length ? Math.max(100, Math.min(50, type.length) * unit + 11) : 20 * unit + 1);
  return Math.round(20 * unit + 1);
}
export function fieldValue(node, culture, locale = culture) {
  const type = node.presentation.valueType;
  if (type.kind === 'number') return '0';
  if (type.kind === 'date') {
    const format = property(node, 'EditFormat')?.value;
    return emptyDateMask(type.dateParts, culture, format && formatSettings(format, locale));
  }
  return '';
}
export function fieldStyle(node, os) {
  const native = linuxSimpleInput(node, os);
  // Native bounds do not change preferred dimensions in the Configurator preview.
  const usesLayoutBounds = native || linuxReferenceWithOpenButton(node, os);
  const maxWidth = usesLayoutBounds ? 0 : number(node, 'MaxWidth'), minWidth = usesLayoutBounds ? 0 : number(node, 'MinWidth');
  const automaticStretch = os === 'linux' && node.kind === 'InputField' && node.presentation.valueType.kind === 'string'
    && !property(node, 'HorizontalStretch') && (native || number(node, 'Width') <= 0 && maxWidth <= 0 && minWidth <= 0);
  const automaticMinimum = automaticStretch && number(node, 'Width') <= 0 && !node.presentation.valueType.length
    ? `min(100%, ${automaticTextWidth(node)}px)` : '100%';
  const stretch = flag(node, 'HorizontalStretch', false);
  // Keep the intrinsic preference; fill only the allocated column, including the choice outset.
  return { width: `${fieldWidth(node, os)}px`, ...(automaticStretch ? { 'min-width': automaticMinimum } : {}),
    ...(maxWidth > 0 ? { 'max-width': `${maxWidth * 8 + 4}px` } : {}), ...(minWidth > 0 ? { 'min-width': `${minWidth * 8 + 4}px` } : {}),
    ...(stretch ? native ? { 'min-width': inputChoiceButton(node, os) ? 'calc(100% - 1px)' : '100%' } : { width: '100%' } : {}) };
}
export function localizedProperty(value, locale) {
  if (value?.caption) return value.caption[locale.startsWith('ru') ? 'ru-RU' : 'en-US'];
  if (value?.kind === 'text') return value.text;
  const items = value && localizedEntries(value);
  if (items) return text({ kind: 'literal', items }, locale);
  if (value?.kind === 'record') return value.fields.map(field => `${field.caption?.[locale.startsWith('ru') ? 'ru-RU' : 'en-US'] ?? field.key.name}: ${localizedProperty(field.value, locale)}`).join('; ');
  return value?.issue ?? '';
}
