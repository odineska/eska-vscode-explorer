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
export function formElementPath(root, selected) {
  const path = [];
  function visit(node) {
    if (!node) return false;
    path.push(node);
    if (node.key === selected) return true;
    for (const child of [...node.children, ...node.auxiliary]) if (visit(child)) return true;
    path.pop(); return false;
  }
  return visit(root) ? path : [];
}

/** Select each enclosing page without changing unrelated page groups. */
export function pageSelections(root, selected) {
  const path = formElementPath(root, selected), pages = {};
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
// Designer's line unit differs from the browser line box at some hinted sizes.
// Measured regular DefaultGUIFont pairs are bound by native-button-heights.
const linuxButtonLineUnits = Object.freeze({8:13,9:14,10:16,11:17,12:18,14:22,16:24,18:28,20:31});
export function buttonControlHeight(node, os) {
  const value = node?.presentation.font, metrics = buttonMetrics(value);
  const usual = os === 'linux' && node?.kind === 'Button' && scalar(node, 'Type', 'UsualButton') === 'UsualButton';
  const rows = usual ? Math.max(1, Math.floor(number(node, 'Height', 1))) : 1;
  const calibrated = !value?.italic && (value?.weight ?? 400) === 400
    && (!value?.face || ['Arial', 'Liberation Sans', 'ESKA Taxi Sans'].includes(value.face));
  const unit = (calibrated ? linuxButtonLineUnits[value?.points ?? 10] : undefined) ?? fontLineHeight(value);
  return Math.max(26, metrics.lineHeight + 2 * metrics.verticalPadding + 2 + (rows - 1) * unit);
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
// Measured Taxi 8.3.27 units for default-formatted numeric lengths 0–51.
// Preserve native quantization before scaling; Chromium text advances are unrelated.
const numericInputUnits = [
  1, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8, 9, 9, 10, 11, 11, 12, 13,
  13, 14, 15, 15, 16, 17, 17, 18, 19, 19, 20, 21, 21, 22, 23,
  23, 24, 25, 25, 26, 27, 27, 28, 29, 30, 30, 31, 32, 32, 33,
  34, 34, 35, 36,
];
function scaledAutomaticInputWidth(node, units) {
  return Math.round(units * 10 * (fontPixels(node.presentation.font) - 1) / 12) + 11;
}
function numberWidthUnits({ digits, fraction = 0, allowedSign }, input = false) {
  if (!Number.isInteger(digits) || digits < 1 || digits > 38) return;
  const decimals = Math.max(0, Math.min(digits, fraction));
  const groups = Math.floor(Math.max(0, digits - decimals - 1) / 3);
  // Nonnegative inputs omit the sign position from the native numeric width.
  const length = digits + groups + Number(decimals > 0) + Number(decimals === digits);
  return numericInputUnits[length - Number(input && allowedSign === 'Nonnegative')];
}
function linuxNumericInputWidth(node) {
  const units = numberWidthUnits(node.presentation.valueType, true);
  return units === undefined ? Math.round(20 * inputUnit(node) + 1) : scaledAutomaticInputWidth(node, units);
}
const inputChoiceWidth = 20;
const referenceOpenWidth = 22;
export const referenceButtonWidth = inputChoiceWidth + referenceOpenWidth;

export function automaticTextWidth(node) {
  return Math.round((fontPixels(node.presentation.font) - 1) * 100 / 3 + 10);
}
export function referenceAlternatives(type) {
  return type?.kind === 'composite' && type.types?.length > 0 && type.types.every(part =>
    part.namespace === 'http://v8.1c.ru/8.1/data/enterprise/current-config' && /Ref\./u.test(part.name));
}

/** Single-line text and reference labels use fixed Taxi character units. */
export function textLabelMetrics(node, os) {
  const type = node.presentation.valueType, width = Math.trunc(number(node, 'Width'));
  if (os !== 'linux' || node.kind !== 'LabelField' || number(node, 'Height') > 1
      || !['Left', 'None'].includes(node.presentation.titleLocation)
      || !(['string', 'reference'].includes(type?.kind) || referenceAlternatives(type))) return;
  const painted = !!property(node, 'BackColor'), size = fontLineMetrics(node.presentation.font);
  return { preferred: (width > 0 ? width * 10 : 150) + (painted ? 2 : 0),
    height: size.ascent + size.descent + (painted ? 4 : 2) };
}

/** Intrinsic size of a single-line numeric label in Linux Designer. */
export function numericLabelMetrics(node, os, { characterUnits = false } = {}) {
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
  const units = characterUnits ? numberWidthUnits(type) : undefined;
  const automatic = units === undefined ? Math.max(50, digits) : Math.max(5, units) * 10;
  const preferred = (authored > 0 ? authored * 10 : Math.round(automatic * scale)) + widthOutset;
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
/** Shared native vertical unit for multiline inputs and form tables. */
export function inputHeightUnit(node, os) {
  const single = inputHeight(node, os);
  return os === 'linux' ? single + (single < 29 ? 5 : 6) : 20;
}
export function inputControlHeight(node, os) {
  const single = inputHeight(node, os);
  if (os !== 'linux') return flag(node, 'MultiLine', false) ? Math.max(2, number(node, 'Height', 3)) * 20 : single;
  // Linux Designer height units use the control height plus a gap measured at 8–20pt.
  return single + (inputRows(node) - 1) * inputHeightUnit(node, os);
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
function enumerationInput(node) {
  const type = node.presentation.valueType, types = type.types ?? [];
  return type.kind === 'reference' && types.length > 0 && types.every(value =>
    value.namespace === 'http://v8.1c.ru/8.1/data/enterprise/current-config' && value.name.startsWith('EnumRef.'));
}
export function inputListChoice(node, os) {
  return flag(node, 'ListChoiceMode', os === 'linux' && enumerationInput(node) && !flag(node, 'ReadOnly', false));
}
export function inputOpenButton(node, os) {
  return flag(node, 'OpenButton', node.presentation.valueType.kind === 'reference' && !(os === 'linux' && enumerationInput(node)));
}
function requestedInputChoice(node, os) {
  const type = node.presentation.valueType;
  const automatic = ['reference', 'composite'].includes(type.kind) || type.kind === 'number' && (os !== 'linux' || type.fraction > 0)
    || type.kind === 'date' && type.dateParts !== 'Time';
  const readOnly = os === 'linux' && flag(node, 'ReadOnly', false) && ['number', 'date', 'reference'].includes(type.kind);
  return inputListChoice(node, os) || flag(node, 'ChoiceButton', automatic && !readOnly);
}
export function inputChoiceButton(node, os) {
  return textInputWidthBounds(node, os)?.choice ?? requestedInputChoice(node, os);
}
export function textInputStretchesByDefault(node) {
  if (flag(node, 'MultiLine', false)) return true;
  const length = node.presentation.valueType.length;
  return !length || length > 10;
}
/** Keep preference, growth and the painted choice outset in one native profile. */
export function textInputWidthBounds(node, os, choiceVisible) {
  if (node.presentation.valueType.kind !== 'string' || !linuxFixedInputWidth(node, os) || flag(node, 'MultiLine', false)) return;
  const authored = Math.trunc(number(node, 'Width')), limit = Math.max(0, number(node, 'MaxWidth'));
  const length = node.presentation.valueType.length;
  const manual = !flag(node, 'AutoMaxWidth');
  const requestedChoice = requestedInputChoice(node, os);
  const cap = manual ? Math.min(50, limit || 50) : 40;
  const preferredPaint = authored > 0 ? authored * 10 + 11 + Number(requestedChoice) * 21
    : Math.min(scaledAutomaticInputWidth(node, length || 15) + Number(requestedChoice) * 21, scaledAutomaticInputWidth(node, cap));
  // The native value box needs one pixel beside the borders and choice button.
  const choice = requestedChoice && (choiceVisible ?? preferredPaint >= 24);
  const stretch = flag(node, 'HorizontalStretch', textInputStretchesByDefault(node));
  const bound = manual ? limit ? limit * 10 + 10 : undefined
    : scaledAutomaticInputWidth(node, Math.min(length || 40, 40)) - 1;
  const maximumPaint = stretch && bound !== undefined ? Math.max(preferredPaint, bound) : undefined;
  const outset = Number(choice);
  return { preferred: preferredPaint - outset, maximum: maximumPaint === undefined ? undefined : maximumPaint - outset,
    preferredPaint, maximumPaint, requestedChoice, choice, outset, stretch };
}
export function linuxFixedInputWidth(node, os) {
  const kind = node.presentation.valueType.kind;
  return os === 'linux' && node.kind === 'InputField' && ['string', 'number', 'date'].includes(kind)
    && (kind === 'string' || !flag(node, 'MultiLine', false))
    && !flag(node, 'OpenButton', false) && !flag(node, 'ClearButton', false) && (!flag(node, 'SpinButton', false) || kind === 'number');
}
function linuxSimpleInput(node, os) {
  return !flag(node, 'MultiLine', false) && linuxFixedInputWidth(node, os);
}
/** Painted choice borders extend past the logical box; spin controls own their whole border. */
export function inputPaintedOutset(node, os) {
  return Number(linuxSimpleInput(node, os) && inputChoiceButton(node, os) && !flag(node, 'SpinButton', false));
}
export function linuxReferenceInput(node, os) {
  return os === 'linux' && node.kind === 'InputField' && ['reference', 'composite'].includes(node.presentation.valueType.kind)
    && !flag(node, 'MultiLine', false) && !flag(node, 'ClearButton', false) && !flag(node, 'SpinButton', false);
}
function linuxReferenceWithOpenButton(node, os) {
  return linuxReferenceInput(node, os) && inputOpenButton(node, os);
}
export function nativeReferenceInput(node, os) {
  return linuxReferenceWithOpenButton(node, os) && inputChoiceButton(node, os);
}
export function fieldWidth(node, os) {
  const label = textLabelMetrics(node, os);
  if (label) return label.preferred;
  const text = textInputWidthBounds(node, os);
  if (text) return text.preferred;
  const unit = inputUnit(node);
  const reference = linuxReferenceInput(node, os), open = reference && inputOpenButton(node, os);
  const native = reference || linuxFixedInputWidth(node, os);
  const spin = native && flag(node, 'SpinButton', false);
  // Multiline controls include the choice button's trailing edge in their own box.
  const choiceInset = Number(reference && !open || native && flag(node, 'MultiLine', false));
  const buttons = (open ? referenceOpenWidth : 0) + (spin ? 21 : 0)
    + (inputChoiceButton(node, os) ? inputChoiceWidth + Number(spin) + choiceInset : 0);
  const width = native ? Math.trunc(number(node, 'Width')) : number(node, 'Width');
  // Explicit Taxi widths use fixed character units, independent of the value font.
  if (width > 0) {
    if (!native) return Math.max(20, width * unit + 4);
    return width * 10 + 11 + buttons;
  }
  if (reference) return Math.round(20 * unit + 1) + buttons;
  if (['ProgressBarField', 'TrackBarField'].includes(node.kind)) return 320;
  if (node.kind === 'LabelField') return 150;
  const type = node.presentation.valueType;
  if (type.kind === 'number' && native) return linuxNumericInputWidth(node) + buttons;
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
export function fieldStyle(node, os, choiceVisible) {
  const text = textInputWidthBounds(node, os, choiceVisible);
  if (text) {
    const available = text.outset ? 'calc(100% - 1px)' : '100%';
    return { width: `${text.preferred}px`,
      ...(text.stretch ? { 'min-width': text.maximum === undefined ? available : `min(${available}, ${text.maximum}px)` }
        : text.preferred < 20 ? { 'min-width': `${text.preferred}px` } : {}),
      ...(text.maximum === undefined ? {} : { 'max-width': `min(100%, ${text.maximum}px)` }) };
  }
  const native = linuxSimpleInput(node, os);
  // Native bounds do not change preferred dimensions in the Configurator preview.
  const usesLayoutBounds = linuxFixedInputWidth(node, os) || linuxReferenceWithOpenButton(node, os);
  const maxWidth = usesLayoutBounds ? 0 : number(node, 'MaxWidth'), minWidth = usesLayoutBounds ? 0 : number(node, 'MinWidth');
  const automaticStretch = os === 'linux' && node.kind === 'InputField' && node.presentation.valueType.kind === 'string'
    && !property(node, 'HorizontalStretch') && (native || number(node, 'Width') <= 0 && maxWidth <= 0 && minWidth <= 0);
  const automaticMinimum = automaticStretch && number(node, 'Width') <= 0 && !node.presentation.valueType.length
    ? `min(100%, ${automaticTextWidth(node)}px)` : '100%';
  const stretch = flag(node, 'HorizontalStretch', false);
  const choiceOutset = inputPaintedOutset(node, os);
  // Keep the intrinsic preference; fill only the allocated column, including the choice outset.
  return { width: `${fieldWidth(node, os)}px`, ...(automaticStretch ? { 'min-width': automaticMinimum } : {}),
    ...(maxWidth > 0 ? { 'max-width': `${maxWidth * 8 + 4}px` } : {}), ...(minWidth > 0 ? { 'min-width': `${minWidth * 8 + 4}px` } : {}),
    ...(stretch ? native ? { 'min-width': choiceOutset ? 'calc(100% - 1px)' : '100%' } : { width: '100%' } : {}) };
}
export function localizedProperty(value, locale) {
  if (value?.caption) return value.caption[locale.startsWith('ru') ? 'ru-RU' : 'en-US'];
  if (value?.kind === 'text') return value.text;
  const items = value && localizedEntries(value);
  if (items) return text({ kind: 'literal', items }, locale);
  if (value?.kind === 'record') return value.fields.map(field => `${field.caption?.[locale.startsWith('ru') ? 'ru-RU' : 'en-US'] ?? field.key.name}: ${localizedProperty(field.value, locale)}`).join('; ');
  return value?.issue ?? '';
}
