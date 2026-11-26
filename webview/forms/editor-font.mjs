const attributes = new Set(['ref', 'kind', 'faceName', 'height', 'scale', 'bold', 'italic', 'underline', 'strikeout']);
export const fontEffects = { bold: 'editBold', italic: 'editItalic', underline: 'editUnderline', strikeout: 'editStrikeout' };
export const fontReferences = ['0', 'sys:DefaultGUIFont', 'style:NormalTextFont', 'style:SmallTextFont', 'style:LargeTextFont', 'style:ExtraLargeTextFont', 'style:TextFont'];

export function fontAttribute(qualifiers, name) {
  return qualifiers?.find(([key]) => !key.namespace && key.name === name)?.[1] ?? '';
}

export function validFontAttribute(name, value) {
  if (!value) return true;
  if (name === 'ref') return value === '0' || /^(?:style|sys):[\p{L}_][\p{L}\p{N}_]*$/u.test(value);
  if (name === 'kind') return ['StyleItem', 'WindowsFont'].includes(value);
  if (name in fontEffects) return ['true', 'false', '1', '0'].includes(value);
  if (name === 'scale') return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
  if (name === 'height') return /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 0.1 && Number.isFinite(Number(value));
  return name === 'faceName';
}

/** Unknown XML shapes stay in the source editor instead of being flattened. */
export function editableFont(property) {
  if (!property) return true;
  if (typeof property.value?.Text !== 'string' || property.value.Text.trim()) return false;
  const seen = new Set();
  return property.qualifiers.every(([key, value]) => {
    if (key.namespace || !attributes.has(key.name) || seen.has(key.name) || !validFontAttribute(key.name, value)) return false;
    seen.add(key.name);
    return true;
  });
}

/** Patch annotations, retaining the spelling and order of every untouched attribute. */
export function patchFont(qualifiers = [], name, value) {
  if (!attributes.has(name) || !validFontAttribute(name, value)) return undefined;
  const result = qualifiers.map(([key, text]) => [{ ...key }, text]);
  const set = (name, value) => {
    const index = result.findIndex(([key]) => !key.namespace && key.name === name);
    if (!value) { if (index >= 0) result.splice(index, 1); }
    else if (index >= 0) result[index][1] = value;
    else result.push([{ namespace: null, name }, value]);
  };
  set(name, value);
  if (!fontAttribute(result, 'ref')) set('ref', '0');
  if (!fontAttribute(result, 'kind')) set('kind', fontAttribute(result, 'ref').startsWith('sys:') ? 'WindowsFont' : 'StyleItem');
  if (name === 'ref') set('kind', value.startsWith('sys:') ? 'WindowsFont' : 'StyleItem');
  if (name === 'faceName' && value && fontAttribute(result, 'kind') !== 'WindowsFont') {
    set('ref', 'sys:DefaultGUIFont');
    set('kind', 'WindowsFont');
  }
  return result;
}
