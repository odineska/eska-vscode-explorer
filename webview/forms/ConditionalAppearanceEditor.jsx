import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import { ColorField, LocalizedFields } from './FormEditorFields.jsx';
import { defaultLanguage } from './editor-model.mjs';

const operandOptions = {
  field: 'editField', string: 'editString', number: 'editNumber', boolean: 'editBoolean', reference: 'editReference',
};
const emptyCondition = () => ({ kind: 'comparison', enabled: true, field: '', operator: 'Equal', operand: { kind: 'string', value: '' } });
const emptyRule = () => ({ original: null, enabled: true, fields: [], conditions: [], format: [] });
const toggles = { bold: 'editBold', italic: 'editItalic', underline: 'editUnderline', strikeout: 'editStrikeout' };
const tabs = { conditions: 'editConditions', format: 'editFormat', fields: 'editFields' };

function emptyOperand(kind) {
  return { kind, value: kind === 'boolean' ? false : '' };
}

function emptySetting(option, language) {
  const values = { color: '#FFFFC0', boolean: true, localized: [{ language, content: '' }],
    font: { reference: 'sys:DefaultGUIFont', effects: [], scale: null } };
  return { parameter: option.parameter, enabled: true, value: { kind: option.editor, value: values[option.editor] } };
}

function Conditions(props) {
  const s = props.strings;
  const types = ['AndGroup', 'OrGroup', 'NotGroup'];
  function patch(index, value) {
    props.change(props.items.map((item, i) => i === index ? { ...item, ...value } : item));
  }
  function setOperator(index, operator) {
    const need = props.comparisons.find(item => item.operator === operator)?.needsOperand;
    patch(index, { operator, operand: need ? props.items[index].operand ?? emptyOperand('string') : null });
  }
  return <div class="form-edit-conditions">

    <Index each={props.items}>{(condition, index) =>
      <div class="form-edit-condition" data-condition={condition().kind}>
        <div class="form-edit-condition-header">
          <label class="form-edit-check"><input type="checkbox" checked={condition().enabled}
            onChange={event => patch(index, { enabled: event.currentTarget.checked })}/>{s.editEnabled}</label>
          <button class="form-edit-secondary" type="button" onClick={() => props.change(props.items.filter((_, i) => i !== index))}>{s.editDelete}</button>
        </div>
        <Show when={condition().kind === 'group'} fallback={
          <div class="form-edit-compare">
            <label>{s.editField}<input type="text" required list="form-appearance-data-paths" value={condition().field}
              onInput={event => patch(index, { field: event.currentTarget.value })}/></label>
            <label>{s.editComparison}<select value={condition().operator} onChange={event => setOperator(index, event.currentTarget.value)}>
              <For each={props.comparisons}>{item => <option value={item.operator} selected={item.operator === condition().operator}>{s[`edit.operator.${item.operator}`]}</option>}</For>
            </select></label>
            <Show when={condition().operand}>{operand => <div class="form-edit-operand">
              <label>{s.editType}<select value={operand().kind} onChange={event => patch(index, { operand: emptyOperand(event.currentTarget.value) })}>
                <For each={Object.entries(operandOptions)}>{([kind, label]) => <option value={kind} selected={kind === operand().kind}>{s[label]}</option>}</For>
              </select></label>
              <label>{s.editValue}<Show when={operand().kind === 'boolean'} fallback={
                <input type={operand().kind === 'number' ? 'number' : 'text'} step="any" value={operand().value}
                  required={operand().kind !== 'string'} list={operand().kind === 'field' ? 'form-appearance-data-paths' : undefined}
                  onInput={event => patch(index, { operand: { ...operand(), value: event.currentTarget.value } })}/>
              }><select value={String(operand().value)} onChange={event => patch(index, { operand: { kind: 'boolean', value: event.currentTarget.value === 'true' } })}>
                <option value="true" selected={operand().value}>{s.editTrue}</option>
                <option value="false" selected={!operand().value}>{s.editFalse}</option>
              </select></Show></label>
            </div>}</Show>
          </div>
        }>
          <label>{s.editGroup}<select value={condition().group} onChange={event => patch(index, { group: event.currentTarget.value })}>
            <For each={types}>{group => <option value={group} selected={group === condition().group}>{s[`edit.group.${group}`]}</option>}</For>
          </select></label>
          <Conditions {...props} items={condition().items} depth={props.depth + 1} change={items => patch(index, { items })}/>
        </Show>
      </div>
    }</Index>
    <div class="form-edit-actions">
      <button class="form-edit-secondary" type="button" onClick={() => props.change([...props.items, emptyCondition()])}>{s.editAddCondition}</button>
      <Show when={props.depth < 16}><button class="form-edit-secondary" type="button" onClick={() => props.change([...props.items, {
        kind: 'group', enabled: true, group: 'AndGroup', items: [emptyCondition()],
      }])}>{s.editAddGroup}</button></Show>
    </div>
  </div>;
}

function FontFields(props) {
  const s = props.strings;
  const change = (key, value) => props.change({ ...props.value, [key]: value });
  return <fieldset class="form-edit-font"><legend>{s['edit.format.font']}</legend>
    <label>{s.editReference}<input type="text" value={props.value.reference} required onInput={event => change('reference', event.currentTarget.value)}/></label>
    <label>{s.editScale}<input type="number" min="1" max="65535" value={props.value.scale ?? ''}
      onInput={event => change('scale', event.currentTarget.valueAsNumber || null)}/></label>
    <For each={Object.entries(toggles)}>{([key, label]) => <label class="form-edit-check"><input type="checkbox" checked={props.value.effects.includes(key)}
      onChange={event => change('effects', event.currentTarget.checked
        ? [...props.value.effects, key] : props.value.effects.filter(effect => effect !== key))}/>{s[label]}</label>}</For>
  </fieldset>;
}

function SettingValue(props) {
  // The setting's kind changes only by replacing a row, so these branches remain stable while typing.
  const value = () => props.value.value;
  const change = next => props.change({ kind: props.value.kind, value: next });
  switch (props.value.kind) {
    case 'boolean':
      return <input type="checkbox" aria-label={props.label} checked={value()} onChange={event => change(event.currentTarget.checked)}/>;
    case 'color':
      return <ColorField value={value()} change={change} label={props.label} strings={props.strings}/>;
    case 'localized':
      return <LocalizedFields values={value()} change={change} label={props.label} language={props.language}/>;
    case 'font':
      return <FontFields value={value()} change={change} strings={props.strings}/>;
  }
}

function FormatSettings(props) {
  const s = props.strings;
  const [next, setNext] = createSignal('');
  const available = () => props.parameters.filter(option => !props.items.some(item => item.parameter === option.parameter));
  const caption = parameter => s[`edit.format.${parameter}`];
  function add() {
    const option = available().find(item => item.parameter === next());
    if (option) props.change([...props.items, emptySetting(option, props.language)]);
    setNext('');
  }
  function patch(index, value) {
    props.change(props.items.map((item, i) => i === index ? { ...item, ...value } : item));
  }
  return <div class="form-edit-settings">
    <For each={props.items.map(item => item.parameter)}>{parameter => {
      const index = () => props.items.findIndex(item => item.parameter === parameter);
      const item = () => props.items[index()];
      return <Show when={item()}><div class="form-edit-setting" data-format={parameter}>
        <div class="form-edit-condition-header">
          <label class="form-edit-check"><input type="checkbox" checked={item().enabled}
            onChange={event => patch(index(), { enabled: event.currentTarget.checked })}/>{caption(parameter)}</label>
          <button class="form-edit-secondary" type="button" onClick={() => props.change(props.items.filter(other => other.parameter !== parameter))}>{s.editDelete}</button>
        </div>
        <SettingValue value={item().value} change={value => patch(index(), { value })} strings={s} label={caption(parameter)} language={props.language}/>
      </div></Show>;
    }}</For>
    <Show when={available().length}><div class="form-edit-actions">
      <select aria-label={s.editFormatParameter} value={next()} onChange={event => setNext(event.currentTarget.value)}>
        <option value="">{s.editChoose}</option>
        <For each={available()}>{item => <option value={item.parameter}>{caption(item.parameter)}</option>}</For>
      </select>
      <button class="form-edit-secondary" type="button" disabled={!next()} onClick={add}>{s.editAdd}</button>
    </div></Show>
  </div>;
}

function FormattedFields(props) {
  const s = props.strings;
  const [next, setNext] = createSignal('');
  const available = () => props.elements.filter(item => !props.items.some(field => field.name === item));
  function add() {
    if (!available().includes(next())) return;
    props.change([...props.items, { name: next(), enabled: true }]);
    setNext('');
  }
  return <div class="form-edit-formatted">
    <Show when={!props.items.length}><p>{s.editAllFields}</p></Show>
    <For each={props.items.map(item => item.name)}>{name =>
      <div class="form-edit-condition-header">
        <label class="form-edit-check"><input type="checkbox" checked={props.items.find(item => item.name === name)?.enabled}
          onChange={event => props.change(props.items.map(item => item.name === name ? { ...item, enabled: event.currentTarget.checked } : item))}/>{name}</label>
        <button class="form-edit-secondary" type="button" onClick={() => props.change(props.items.filter(item => item.name !== name))}>{s.editDelete}</button>
      </div>
    }</For>
    <Show when={available().length}><div class="form-edit-actions">
      <input aria-label={s.editFields} type="text" list="form-appearance-elements" value={next()} onInput={event => setNext(event.currentTarget.value)}/>
      <datalist id="form-appearance-elements"><For each={available()}>{name => <option value={name}/>}</For></datalist>
      <button class="form-edit-secondary" type="button" disabled={!available().includes(next())} onClick={add}>{s.editAdd}</button>
    </div></Show>
  </div>;
}

export function ConditionalAppearanceEditor(props) {
  const s = props.strings, appearance = props.schema.conditionalAppearance;
  const language = defaultLanguage(props.model);
  const [draft, setDraft] = createStore({ rules: structuredClone(appearance.rules) });
  const [selected, select] = createSignal(0);
  const [tab, setTab] = createSignal('format');
  const [confirmation, setConfirmation] = createSignal(false);
  const rule = () => draft.rules[selected()];
  const elements = createMemo(() => [...new Set(props.schema.nodes.filter(node => node.target.kind === 'element' && node.name).map(node => node.name))]
    .sort((a, b) => a.localeCompare(b, props.locale)));
  const opaque = item => [item.enabled, item.fields, item.conditions, item.format].some(part => part === null);
  const label = (item, index) => (item.fields?.map(field => field.name).join(', ') || s.editAllFields) + ` · ${s.editRule} ${index + 1}`;
  function add(item = emptyRule()) {
    select(draft.rules.length);
    setDraft('rules', rules => [...rules, item]);
  }
  function remove() {
    const index = selected();
    setDraft('rules', rules => rules.filter((_, i) => i !== index));
    select(Math.min(index, Math.max(draft.rules.length - 1, 0)));
    setConfirmation(false);
  }
  function move(offset) {
    const index = selected(), next = index + offset;
    if (next < 0 || next >= draft.rules.length) return;
    setDraft(produce(state => { const [item] = state.rules.splice(index, 1); state.rules.splice(next, 0, item); }));
    select(next);
  }
  return <form id="form-edit-draft" class="form-edit-form form-edit-appearance" onSubmit={event => {
    event.preventDefault();
    props.submit([{ kind: 'setConditionalAppearance', rules: structuredClone(unwrap(draft.rules)) }]);
  }}>
    <div class="form-edit-actions">
      <button class="form-edit-secondary" type="button" onClick={() => { setConfirmation(false); add(); }}>{s.editAddRule}</button>
      <Show when={rule()}>
        <button class="form-edit-secondary" type="button" disabled={opaque(rule())}
          onClick={() => add({ ...structuredClone(unwrap(rule())), original: null })}>{s.editDuplicateRule}</button>
        <button class="form-edit-secondary" type="button" disabled={!selected()} onClick={() => move(-1)}>{s.editUp}</button>
        <button class="form-edit-secondary" type="button" disabled={selected() >= draft.rules.length - 1} onClick={() => move(1)}>{s.editDown}</button>
        <button class="form-edit-secondary" type="button" onClick={() => setConfirmation(true)}>{s.editDelete}</button>
      </Show>
    </div>
    <Show when={confirmation()}><div class="form-edit-actions" role="group" aria-label={s.editRemove}>
      <button type="button" onClick={remove}>{s.editDelete} · {selected() + 1}</button>
      <button type="button" class="form-edit-secondary" onClick={() => setConfirmation(false)}>{s.editCancel}</button>
    </div></Show>
    <Show when={rule()} fallback={<p>{s.editNoRules}</p>}>
      <label>{s.editRule}<select value={selected()} onChange={event => { select(Number(event.currentTarget.value)); setConfirmation(false); }}>
        <Index each={draft.rules}>{(item, index) => <option value={index} selected={index === selected()}>{label(item(), index)}</option>}</Index>
      </select></label>
      <Show when={rule().enabled !== null}>
        <label class="form-edit-check"><input type="checkbox" checked={rule().enabled}
          onChange={event => setDraft('rules', selected(), 'enabled', event.currentTarget.checked)}/>{s.editEnabled}</label>
      </Show>
      <div class="form-edit-tabs" role="group" aria-label={s.editRule}>
        <For each={Object.entries(tabs)}>{([key, label]) => <button type="button" aria-pressed={tab() === key} onClick={() => setTab(key)}>{s[label]}</button>}</For>
      </div>
      <Show when={rule()[tab()] !== null} fallback={<p>{s.editUnsupported}</p>}>
        <Show when={tab() === 'conditions'}>
          <Show when={!rule().conditions.length}><p>{s.editAlways}</p></Show>
          <Conditions items={rule().conditions} comparisons={appearance.comparisons} strings={s} depth={0}
            change={values => setDraft('rules', selected(), 'conditions', values)}/>
        </Show>
        <Show when={tab() === 'format'}>
          <FormatSettings items={rule().format} parameters={appearance.parameters} strings={s} language={language}
            change={values => setDraft('rules', selected(), 'format', values)}/>
        </Show>
        <Show when={tab() === 'fields'}>
          <FormattedFields items={rule().fields} elements={elements()} strings={s}
            change={values => setDraft('rules', selected(), 'fields', values)}/>
        </Show>
      </Show>
    </Show>
    <datalist id="form-appearance-data-paths"><For each={props.paths}>{path => <option value={path}/>}</For></datalist>
  </form>;
}
