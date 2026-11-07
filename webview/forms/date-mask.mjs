const sample = new Date(2001, 10, 22, 1, 2, 3);
const emptyParts = { month: '  ', day: '  ', year: '    ', hour: '  ', minute: '  ', second: '  ' };

function localizedMask(culture, options) {
  return new Intl.DateTimeFormat(culture, options).formatToParts(sample)
    .map(part => emptyParts[part.type] ?? part.value.replaceAll('\u202f', ' ')).join('');
}

function maskCulture(settings, fallback) {
  const language = settings.get('L') ?? settings.get('Л');
  if (!language) return fallback;
  try {
    return Intl.getCanonicalLocales(language.replaceAll('_', '-'))[0] ?? fallback;
  } catch {
    return fallback;
  }
}

// Designer's empty edit field retains separators and day periods, but leaves its numeric slots blank.
function authoredMask(pattern, dateParts, culture) {
  const tokens = /"((?:""|[^"])*)"|'((?:''|[^'])*)'|(\p{L})\3*|[^\p{L}'"]+|['"]/gu;
  let mask = '', numeric = false;
  for (const [token, double, single, letter] of pattern.matchAll(tokens)) {
    if (double !== undefined || single !== undefined) {
      mask += double?.replaceAll('""', '"') ?? single.replaceAll("''", "'");
    } else if ((letter === undefined && token !== '"' && token !== "'") || token === 'T') {
      mask += token;
    } else if (/^(?:[dдMМ]{1,2}|[yг]{1,2}|y{4}|г{4})$/u.test(token) && dateParts !== 'Time') {
      mask += token.length === 4 ? '    ' : '  ';
      numeric = true;
    } else if (/^[hHчЧmмsс]{1,2}$/u.test(token) && dateParts !== 'Date') {
      mask += '  ';
      numeric = true;
    } else if ((token === 'tt' || token === 'вв') && dateParts !== 'Date') {
      const parts = new Intl.DateTimeFormat(culture, { hour: 'numeric', hourCycle: 'h12' }).formatToParts(sample);
      mask += parts.find(part => part.type === 'dayPeriod')?.value ?? '';
    } else {
      return;
    }
  }
  if (numeric) return mask;
}

export function emptyDateMask(dateParts, culture, settings) {
  const pattern = settings?.get('DF') ?? settings?.get('ДФ');
  if (pattern) {
    const mask = authoredMask(pattern, dateParts, maskCulture(settings, culture));
    if (mask !== undefined) return mask;
  }
  const date = () => localizedMask(culture, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = () => localizedMask(culture, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  if (dateParts === 'Date') return date();
  if (dateParts === 'Time') return time();
  return date() + ' ' + time();
}
