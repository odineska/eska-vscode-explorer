import { localizedEntries } from '../../resources/properties/model.mjs';
import { controlCaptionOptions } from './font-metrics.mjs';
import { buttonMetrics, flag, fontLineMetrics, number, property, scalar, text } from './model.mjs';
import { tumblerCaptionLayout, tumblerCaptionWidth } from './tumbler-caption.mjs';

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
  const paragraphs = labels.map(label => label.split(/\r\n?|\n/u));
  const options = controlCaptionOptions(font);
  const widths = paragraphs.map(lines => {
    if (os !== 'linux') return;
    let width = 0;
    for (const line of lines) {
      const advance = tumblerCaptionWidth(line, options);
      if (advance === undefined) return;
      width = Math.max(width, advance);
    }
    return width + 2 * side;
  });
  if (!explicit && widths.some(width => width === undefined)) return { height, equal, side };
  const first = explicit > 0 ? explicit : equal ? Math.max(...widths) : widths[0];
  const last = equal ? first : widths[1];
  // The right item keeps the native trailing inset, including the shared divider.
  const width = first + last + 3;
  const size = { height, equal, side, first, width };
  if (os !== 'linux') return size;
  const titleRows = Math.max(1, Math.trunc(number(node, 'ItemTitleHeight')));
  const segments = tumblerCaptionLayout(paragraphs, size, font, titleRows);
  if (!segments) return size;
  const extraLines = Math.max(...segments.map(segment => segment.lines.length)) - 1;
  return { ...size, height: height + (items > 0 ? 0 : extraLines * lineHeight), segments };
}
