import { localizedEntries } from '../../resources/properties/model.mjs';
import { controlCaptionWidth } from './font-metrics.mjs';
import { buttonMetrics, flag, fontLineMetrics, number, property, scalar, text } from './model.mjs';

const captions = {
  ru: { logical: ['Истина', 'Ложь'], regional: ['Да', 'Нет'] },
  en: { logical: ['True', 'False'], regional: ['Yes', 'No'] },
};

export function checkboxMode(node) {
  if (node.presentation.valueType.kind === 'boolean') {
    const mode = scalar(node, 'CheckBoxType');
    if (mode === 'Tumbler' || mode === 'Switcher') return mode;
  }
  return 'CheckBox';
}

export function checkboxLabels(node, locale, culture, scriptVariant) {
  const value = property(node, 'EditFormat')?.value;
  const items = value && localizedEntries(value);
  const format = items ? text({ kind: 'literal', items }, locale) : value?.kind === 'text' ? value.text : '';
  const settings = new Map();
  // Quoted values can contain a separator or a doubled quote.
  const parameters = /(?:^|;)\s*(\p{L}+)\s*=\s*(?:"((?:""|[^"])*)"|'((?:''|[^'])*)'|([^;]*))\s*(?=;|$)/gu;
  for (const [, key, double, single, plain] of format.matchAll(parameters)) {
    settings.set(key.trim().toUpperCase(), double?.replaceAll('""', '"') ?? single?.replaceAll("''", "'") ?? plain.trim());
  }
  const language = settings.get('L') ?? settings.get('Л');
  const logicalLanguage = { russian: 'ru', english: 'en' }[scriptVariant] ?? culture;
  const russian = (language || logicalLanguage).toLowerCase().startsWith('ru');
  const defaults = captions[russian ? 'ru' : 'en'][language ? 'regional' : 'logical'];
  return [
    settings.get('BT') ?? settings.get('БИ') ?? defaults[0],
    settings.get('BF') ?? settings.get('БЛ') ?? defaults[1],
  ].map(label => label.trimEnd());
}

export function checkboxTumblerLayout(node, labels, os) {
  const font = node.presentation.font;
  const { lineHeight, verticalPadding } = buttonMetrics(font);
  const side = Math.round(fontLineMetrics(font).pixels * 9 / 13);
  const unitHeight = lineHeight + 2 * verticalPadding + 2;
  const items = number(node, 'ItemHeight');
  const height = items > 0 ? Math.round(items * unitHeight) : unitHeight + 1;
  const equal = flag(node, 'EqualItemsWidth');
  const explicit = equal ? Math.round(Math.max(0, number(node, 'ItemWidth')) * (os === 'linux' ? 10 : 8)) : 0;
  const widths = labels.map(label => {
    const text = os === 'linux' ? controlCaptionWidth(label, font) : undefined;
    return text === undefined ? undefined : text + 2 * side;
  });
  if (!explicit && widths.some(width => width === undefined)) return { height, equal, side };
  const first = explicit > 0 ? explicit : equal ? Math.max(...widths) : widths[0];
  const last = equal ? first : widths[1];
  // The right item keeps the native trailing inset, including the shared divider.
  return { height, equal, side, first, width: first + last + (equal ? 3 : 2) };
}
