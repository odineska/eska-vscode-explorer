import { For, Index, Show, createMemo, createSignal, onCleanup } from 'solid-js';
import { CORE_NS, XS_NS, addType, defaultLanguage, localized, property, scalar } from './editor-model.mjs';
import { FORM_NS } from './model.mjs';
import { FormTypeEditor, formTypeId } from './FormTypeEditor.jsx';

const supported = new Set(['text', 'boolean', 'number', 'localized', 'enum', 'binding', 'reference', 'shortcut', 'color', 'event']);
const typeOptions = [
  [XS_NS, 'string', 'editString'], [XS_NS, 'decimal', 'editNumber'], [XS_NS, 'boolean', 'editBoolean'], [XS_NS, 'dateTime', 'editDate'],
  [CORE_NS, 'ValueTable', 'dataType.ValueTable'], [CORE_NS, 'ValueTree', 'dataType.ValueTree'], [CORE_NS, 'ValueList', 'dataType.ValueList'],
];
export const editCategories = ['main', 'usage', 'appearance', 'layout', 'events'];

export function TypeChoice(props) {
  const choices = createMemo(() => {
    const selected = props.value;
    const result = typeOptions.map(([namespace, name, label]) => ({ key: { namespace, name }, label: props.strings[label] ?? name }));
    if (selected && !result.some(item => formTypeId(item.key) === formTypeId(selected))) result.push({ key: selected, label: selected.name });
    return result;
  });
  return <select aria-label={props.strings.editType} value={formTypeId(props.value)} onChange={event => {
    props.change(choices().find(item => formTypeId(item.key) === event.currentTarget.value)?.key);
  }}>
    <option value="">{props.strings.editChoose}</option>
    <For each={choices()}>{item => <option value={formTypeId(item.key)} selected={formTypeId(item.key) === formTypeId(props.value)}>{item.label}</option>}</For>
  </select>;
}



export function LocalizedFields(props) {
  const values = () => props.values.length ? props.values : [{ language: props.language, content: '' }];
  return <div class="form-edit-localized">
    <Index each={values()}>{(item, i) =>
      <label class="form-edit-localized-row">
        <Show when={values().length > 1}><span>{item().language}</span></Show>
        <input type="text" aria-label={values().length > 1 ? `${props.label} (${item().language})` : props.label}
          value={item().content} onInput={event => props.change(values().map((value, index) =>
            index === i ? { ...value, content: event.currentTarget.value } : value))}/>
      </label>
    }</Index>
  </div>;
}

export function ColorField(props) {
  const value = () => props.value ?? '';
  return <div class="form-edit-color">
    <input type="color" aria-label={props.strings.editColor} value={/^#[a-f\d]{6}$/i.test(value()) ? value() : '#000000'}
      onInput={event => props.change(event.currentTarget.value.toUpperCase())}/>
    <input type="text" aria-label={props.label} value={value()} placeholder={props.strings.editAutomatic}
      onInput={event => props.change(event.currentTarget.value)}/>
  </div>;
}

export function declaredFormProperty(node, field) {
  if (field.source === 'qualifier') {
    const value = node.qualifiers.find(([key]) => key.name === field.name)?.[1];
    return value === undefined ? undefined : { writable: true, property: property(field.name, { Text: value }) };
  }
  if (field.source === 'event' && field.name !== 'Action') {
    const event = node.properties.find(({ property }) => property.key.namespace === FORM_NS && property.key.name === 'Events');
    const found = event?.property.value.Record?.find(item => item.qualifiers.some(([key, value]) => key.name === 'name' && value === field.name));
    return found ? { writable: true, property: found } : undefined;
  }
  const candidates = node.properties.filter(({ property }) => property.key.namespace === FORM_NS && property.key.name === field.name);
  return candidates.length > 1 ? { writable: false, property: candidates[0].property } : candidates[0];
}

export function canEditFormProperty(node, field, current) {
  if (!['event', 'property', 'qualifier'].includes(field.source) || current?.writable === false) return false;
  if (field.name === 'ConditionalAppearance') return false;
  const type = field.name === 'Type' && ['Attribute', 'Column', 'Parameter'].includes(node.kind);
  if (type) return true;
  if (!supported.has(field.editor) || field.editor === 'enum' && !field.values.length) return false;
  if (!current) return true;
  if (field.editor === 'localized' && current.property.value.Record) {
    return current.property.value.Record.every(item =>
      item.key.namespace === CORE_NS && item.key.name === 'item' && item.qualifiers.length === 0
      && item.value.Record?.length === 2
      && item.value.Record.every(entry => entry.key.namespace === CORE_NS
        && ['lang', 'content'].includes(entry.key.name) && entry.qualifiers.length === 0
        && typeof entry.value.Text === 'string')
      && item.value.Record.some(entry => entry.key.name === 'lang' && entry.value.Text.trim())
      && item.value.Record.some(entry => entry.key.name === 'content'));
  }
  return current.property.value.Text !== undefined || current.property.value.TypedText !== undefined;
}

export function formPropertyLabel(field, props) {
  if (field.name === 'Type' && ['Attribute', 'Column', 'Parameter'].includes(props.node.kind)) return props.strings.editType;
  return props.schema.propertyCaptions[field.id]?.[props.locale] ?? field.id;
}

function ValueEditor(props) {
  const field = props.field, s = props.strings;
  const value = () => props.value;
  const automatic = ['auto', 'autoStretch'].includes(field.default.kind) && field.values.includes('Auto');
  const fallback = automatic ? 'Auto' : ['boolean', 'number', 'choice'].includes(field.default.kind)
    ? String(field.default.value) : '';
  const text = () => value() ? scalar(value()) : fallback;
  const changeText = text => props.change(value()?.TypedText ? { TypedText: { ...value().TypedText, text } } : { Text: text });
  const caption = option => props.schema.choiceCaptions[field.id]?.[option]?.[props.locale] ?? (option === 'Auto' ? s.editAutomatic : option);

  if (field.name === 'Type' && ['Attribute', 'Column', 'Parameter'].includes(props.node.kind)) {
    // A single-type selector must never flatten an existing composite type.
    const parts = () => value()?.Record ?? [];
    const type = () => parts().find(item => item.key.namespace === CORE_NS && item.key.name === 'Type');
    const simple = () => <Show when={!parts().some(item => item !== type())} fallback={<span>{s.editUnsupported}</span>}>
      <TypeChoice value={type()?.value.QualifiedText?.key} strings={s}
        change={key => props.change(key ? addType(key).value : undefined)}/>
    </Show>;
    return <Show when={props.schema.typeOptions} fallback={simple()}>{options =>
      <FormTypeEditor strings={s} locale={props.locale} options={options()} value={value()} change={props.change}/>
    }</Show>;
  }
  switch (field.editor) {
    case 'boolean':
      return <input type="checkbox" aria-label={props.label} checked={['true', '1'].includes(text())}
        onChange={event => changeText(String(event.currentTarget.checked))}/>;
    case 'localized':
      return <LocalizedFields values={localized(value(), defaultLanguage(props.model))} language={defaultLanguage(props.model)}
        label={props.label} change={values => props.change({ Localized: values })}/>;
    case 'enum':
      return <select aria-label={props.label} value={text()} onChange={event => {
        const value = event.currentTarget.value;
        if (automatic && value === 'Auto') props.change(undefined);
        else changeText(value);
      }}>
        <Show when={!field.values.includes(text())}><option value={text()} selected>{text() || s.editChoose}</option></Show>
        <For each={field.values}>{option => <option value={option} selected={text() === option}>{caption(option)}</option>}</For>
      </select>;
    case 'color':
      return <ColorField label={props.label} strings={s} value={text()} change={changeText}/>;
    default:
      return <input type={field.editor === 'number' ? 'number' : 'text'} step="any" aria-label={props.label} value={text()}
        list={field.editor === 'binding' ? 'form-edit-data-paths' : field.name === 'CommandName' ? 'form-edit-commands' : undefined}
        onInput={event => {
          if (event.currentTarget.validity.badInput) props.invalid();
          else changeText(event.currentTarget.value);
        }}/>;
  }
}

/** Keep the input node and its pending value while new model revisions arrive. */
export function InlineFormProperty(props) {
  const { controller: c, field } = props;
  const s = c.state.strings;
  const [local, setLocal] = createSignal(null);
  const [error, setError] = createSignal('');
  const current = () => declaredFormProperty(props.node, field);
  const composite = () => field.name === 'Type' && ['Attribute', 'Column', 'Parameter'].includes(props.node.kind);
  const value = () => local() ? local().value : current()?.property.value;
  const label = () => formPropertyLabel(field, props);
  const key = Symbol(field.id);
  let session, ticket = 0, sent = 0, focused = false, element;
  function send(value, version, group, target, qualifiers) {
    let operation;
    if (field.source === 'event')
      operation = { kind: 'setEvent', target, event: field.name, handler: scalar(value).trim() || null };
    else if (value === undefined)
      operation = { kind: 'removeProperty', target, key: { namespace: FORM_NS, name: field.name } };
    else
      operation = { kind: 'setProperty', target, property: property(field.name, value, qualifiers) };
    void c.change([operation], group).then(result => {
      if (version !== ticket) return;
      sent = version;
      setError(result.message ?? '');
      if (!focused && !result.message) setLocal(null);
    });
  }
  function update(value) {
    if (!c.writable()) {
      setError(c.state.draftStatus?.conflict ? 'editConflict' : 'editLocked');
      return;
    }
    const version = ++ticket;
    session ??= 'field-' + c.nextFieldId();
    const group = session;
    setError('');
    setLocal({ value });
    const delay = field.editor === 'boolean' || field.editor === 'enum' ? 0 : 150;
    const target = props.node.target, qualifiers = current()?.property.qualifiers ?? [];
    c.scheduleField(key, () => send(value, version, group, target, qualifiers), delay);
  }
  function invalid() {
    ticket++;
    c.discardField(key);
    setError('editInvalid');
  }
  function blur(event) {
    if (element.contains(event.relatedTarget)) return;
    focused = false;
    c.flushField(key);
    session = undefined;
    if (sent === ticket && !error()) setLocal(null);
  }
  onCleanup(() => c.flushField(key));
  return <div ref={element} class="form-inline-property" data-edit-property={field.name} data-edit-field={field.id}
    onFocusIn={() => { focused = true; }} onFocusOut={blur} aria-invalid={!!error()}>
    <Show when={composite()} fallback={
      <ValueEditor {...props} field={field} label={label()} value={value()} change={update} invalid={invalid}/>
    }>
      <details class="form-inline-type">
        <summary>{props.typeLabel || s.editType}</summary>
        <ValueEditor {...props} field={field} label={label()} value={value()} change={update} invalid={invalid}/>
      </details>
    </Show>
    <Show when={current() && !composite()}><button type="button" class="form-icon-button form-inline-reset"
      title={s.editReset} aria-label={s.editReset} onClick={() => update(undefined)}>↺</button></Show>
    <Show when={error()}><small role="alert" class="form-inline-error">{s[error()]}</small></Show>
  </div>;
}

export function FormPropertyChoices(props) {
  return <>
    <datalist id="form-edit-data-paths"><For each={props.paths}>{path => <option value={path}/>}</For></datalist>
    <datalist id="form-edit-commands"><For each={props.schema.nodes.filter(node => node.target.kind === 'command')}>
      {node => <option value={'Form.Command.' + node.name}/>}
    </For></datalist>
  </>;
}
