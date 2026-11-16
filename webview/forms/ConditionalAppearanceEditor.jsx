import { For, Index, Show, createMemo, createSignal } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import { ColorField, LocalizedFields } from './FormEditorFields.jsx';
import { defaultLanguage } from './editor-model.mjs';
import { AppearanceOperandEditor, emptyOperand } from './AppearanceOperandEditor.jsx';

const emptyCondition = () => ({ kind: 'comparison', enabled: true, field: '', operator: 'Equal', operand: { kind: 'string', value: '' } });
const emptyRule = () => ({ original: null, enabled: true, fields: [], conditions: [], format: [] });
const toggles = { bold: 'editBold', italic: 'editItalic', underline: 'editUnderline', strikeout: 'editStrikeout' };
const tabs = { conditions: 'editConditions', format: 'editFormat', fields: 'editFields' };

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
    const comparison = props.comparisons.find(item => item.operator === operator);
    const previous = props.items[index].operand;
    const useList = comparison?.usesList;
    const retained = previous && (useList ? ['values', 'field'].includes(previous.kind) : previous.kind !== 'values');
    const operand = comparison?.needsOperand ? (retained ? previous : emptyOperand(useList ? 'values' : 'string')) : null;
    patch(index, { operator, operand });
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
            <Show when={condition().operand}>{operand =>
              <AppearanceOperandEditor strings={s} operand={operand()} extended={props.extended}
                usesList={props.comparisons.find(item => item.operator === condition().operator)?.usesList}
                change={value => patch(index, { operand: value })}/>
            }</Show>
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
  const candidate = () => next().trim();
  const canAdd = () => candidate() && !props.items.some(item => item.name === candidate())
    && (props.allowCustom || available().includes(candidate()));
  function add() {
    if (!canAdd()) return;
    props.change([...props.items, { name: candidate(), enabled: true }]);
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
    <Show when={props.allowCustom || available().length}><div class="form-edit-actions">
      <input aria-label={s.editFields} type="text" list="form-appearance-elements" value={next()} onInput={event => setNext(event.currentTarget.value)}/>
      <datalist id="form-appearance-elements"><For each={available()}>{name => <option value={name}/>}</For></datalist>
      <button class="form-edit-secondary" type="button" disabled={!canAdd()} onClick={add}>{s.editAdd}</button>
    </div></Show>
  </div>;
}

export function ConditionalAppearanceEditor(props) {
  const s = props.strings;
  const language = defaultLanguage(props.model);
  const scopes = [
    { attribute: null, appearance: props.schema.conditionalAppearance },
    ...(props.schema.dynamicListAppearance ?? []),
  ].filter(scope => scope.appearance);
  const [draft, setDraft] = createStore({ scopes: scopes.map(scope => structuredClone(unwrap(scope.appearance.rules))) });
  const modified = new Set();
  const [active, setActive] = createSignal(0);
  const [selected, select] = createSignal(0);
  const [tab, setTab] = createSignal('format');
  const [confirmation, setConfirmation] = createSignal(false);
  const scope = () => scopes[active()];
  const rules = () => draft.scopes[active()];
  const rule = () => rules()[selected()];
  const list = () => scope().attribute !== null;
  const extended = props.schema.dynamicListAppearance !== undefined;
  const listPaths = createMemo(() => {
    if (!list()) return [];
    const prefix = scope().attribute + '.';
    return [...scope().fields, ...props.paths.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))];
  });
  const paths = () => list() ? [...new Set(listPaths())] : props.paths;
  const elements = createMemo(() => {
    const names = list() ? listPaths() : props.schema.nodes.filter(node => node.target.kind === 'element' && node.name).map(node => node.name);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, props.locale));
  });
  function changeRules(update) {
    modified.add(active());
    setDraft('scopes', active(), update);
  }
  function changeRule(key, value) {
    modified.add(active());
    setDraft('scopes', active(), selected(), key, value);
  }
  const opaque = item => [item.enabled, item.fields, item.conditions, item.format].some(part => part === null);
  const label = (item, index) => (item.fields?.map(field => field.name).join(', ') || s.editAllFields) + ` · ${s.editRule} ${index + 1}`;
  function add(item = emptyRule()) {
    select(rules().length);
    changeRules(entries => [...entries, item]);
  }
  function remove() {
    const index = selected();
    changeRules(entries => entries.filter((_, i) => i !== index));
    select(Math.min(index, Math.max(rules().length - 1, 0)));
    setConfirmation(false);
  }
  function move(offset) {
    const index = selected(), next = index + offset;
    if (next < 0 || next >= rules().length) return;
    changeRules(produce(entries => { const [item] = entries.splice(index, 1); entries.splice(next, 0, item); }));
    select(next);
  }
  return <form id="form-edit-draft" class="form-edit-form form-edit-appearance" onSubmit={event => {
    event.preventDefault();
    props.submit([...modified].map(index => ({
      ...(scopes[index].attribute === null
        ? { kind: 'setConditionalAppearance' }
        : { kind: 'setListConditionalAppearance', attribute: scopes[index].attribute }),
      rules: structuredClone(unwrap(draft.scopes[index])),
    })));
  }}>
    <Show when={scopes.length > 1}>
      <label>{s.editAppearanceScope}<select data-form-edit-scope value={active()} onChange={event => {
        setActive(Number(event.currentTarget.value)); select(0); setConfirmation(false);
      }}>
        <For each={scopes}>{(item, index) => <option value={index()} selected={active() === index()}>{item.attribute ?? s.form}</option>}</For>
      </select></label>
    </Show>
    <div class="form-edit-actions">
      <button class="form-edit-secondary" type="button" onClick={() => { setConfirmation(false); add(); }}>{s.editAddRule}</button>
      <Show when={rule()}>
        <button class="form-edit-secondary" type="button" disabled={opaque(rule())}
          onClick={() => add({ ...structuredClone(unwrap(rule())), original: null })}>{s.editDuplicateRule}</button>
        <button class="form-edit-secondary" type="button" disabled={!selected()} onClick={() => move(-1)}>{s.editUp}</button>
        <button class="form-edit-secondary" type="button" disabled={selected() >= rules().length - 1} onClick={() => move(1)}>{s.editDown}</button>
        <button class="form-edit-secondary" type="button" onClick={() => setConfirmation(true)}>{s.editDelete}</button>
      </Show>
    </div>
    <Show when={confirmation()}><div class="form-edit-actions" role="group" aria-label={s.editRemove}>
      <button type="button" onClick={remove}>{s.editDelete} · {selected() + 1}</button>
      <button type="button" class="form-edit-secondary" onClick={() => setConfirmation(false)}>{s.editCancel}</button>
    </div></Show>
    <Show when={rule()} fallback={<p>{s.editNoRules}</p>}>
      <label>{s.editRule}<select value={selected()} onChange={event => { select(Number(event.currentTarget.value)); setConfirmation(false); }}>
        <Index each={rules()}>{(item, index) => <option value={index} selected={index === selected()}>{label(item(), index)}</option>}</Index>
      </select></label>
      <Show when={rule().enabled !== null}>
        <label class="form-edit-check"><input type="checkbox" checked={rule().enabled}
          onChange={event => changeRule('enabled', event.currentTarget.checked)}/>{s.editEnabled}</label>
      </Show>
      <div class="form-edit-tabs" role="group" aria-label={s.editRule}>
        <For each={Object.entries(tabs)}>{([key, label]) => <button type="button" aria-pressed={tab() === key} onClick={() => setTab(key)}>{s[label]}</button>}</For>
      </div>
      <Show when={rule()[tab()] !== null} fallback={<p>{s.editUnsupported}</p>}>
        <Show when={tab() === 'conditions'}>
          <Show when={!rule().conditions.length}><p>{s.editAlways}</p></Show>
          <Conditions items={rule().conditions} comparisons={scope().appearance.comparisons} extended={extended} strings={s} depth={0}
            change={values => changeRule('conditions', values)}/>
        </Show>
        <Show when={tab() === 'format'}>
          <FormatSettings items={rule().format} parameters={scope().appearance.parameters} strings={s} language={language}
            change={values => changeRule('format', values)}/>
        </Show>
        <Show when={tab() === 'fields'}>
          <FormattedFields items={rule().fields} elements={elements()} allowCustom={list()} strings={s}
            change={values => changeRule('fields', values)}/>
        </Show>
      </Show>
    </Show>
    <datalist id="form-appearance-data-paths"><For each={paths()}>{path => <option value={path}/>}</For></datalist>
  </form>;
}
