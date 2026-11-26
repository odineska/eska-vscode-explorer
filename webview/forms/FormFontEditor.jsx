import { For } from 'solid-js';
import { fontAttribute, fontEffects, patchFont } from './editor-font.mjs';

export function FormFontEditor(props) {
  const s = props.strings;
  const value = name => fontAttribute(props.qualifiers, name);
  function change(name, text) {
    const qualifiers = patchFont(props.qualifiers, name, text);
    if (!qualifiers) props.invalid();
    else props.change({ Text: '' }, qualifiers);
  }
  return <details class="form-inline-font">
    <summary>{value('faceName') || (value('ref') !== '0' && value('ref')) || s.editAutomatic}</summary>
    <div class="form-font-fields">
      <label>{s.editFontBase}<input type="text" aria-label={s.editFontBase} list="form-edit-font-references"
        value={value('ref') || '0'} onInput={event => change('ref', event.currentTarget.value.trim())}/></label>
      <label>{s.editFontFamily}<input type="text" aria-label={s.editFontFamily} value={value('faceName')}
        onInput={event => change('faceName', event.currentTarget.value)}/></label>
      <For each={['height', 'scale']}>{name => <label>{name === 'height' ? s.editFontSize : s.editScale}
        <input type="number" min={name === 'height' ? '0.1' : '1'} max={name === 'scale' ? '65535' : undefined} step={name === 'height' ? 'any' : '1'} aria-label={name === 'height' ? s.editFontSize : s.editScale}
          value={value(name)} placeholder={s.editAutomatic} onInput={event => {
            if (event.currentTarget.validity.badInput) props.invalid();
            else change(name, event.currentTarget.value);
          }}/>
      </label>}</For>
      <For each={Object.entries(fontEffects)}>{([name, caption]) => <label>{s[caption]}
        <select aria-label={s[caption]} value={value(name) === '1' ? 'true' : value(name) === '0' ? 'false' : value(name)}
          onChange={event => change(name, event.currentTarget.value)}>
          <option value="">{s.editAutomatic}</option><option value="true">{s.editTrue}</option><option value="false">{s.editFalse}</option>
        </select>
      </label>}</For>
    </div>
  </details>;
}
