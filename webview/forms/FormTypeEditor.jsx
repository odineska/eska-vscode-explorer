import { For, Show, createMemo, createSignal } from 'solid-js';
import { CORE_NS, property, scalar } from './editor-model.mjs';

const memberKind = item => ['Type', 'TypeSet'].includes(item.key.name) && item.key.namespace === CORE_NS;
const memberKey = item => item.value.QualifiedText?.key;
const qualifierOrder = ['NumberQualifiers', 'StringQualifiers', 'DateQualifiers', 'BinaryDataQualifiers'];

function defaultQualifier(qualifier) {
  return property(qualifier.name, { Record: qualifier.defaults
    .map(([name, text]) => property(name, { Text: text }, [], CORE_NS)) }, [], CORE_NS);
}
export const formTypeId = key => key ? JSON.stringify([key.namespace, key.name]) : '';

function numericLimits(name, values, limits) {
  if (name === 'Digits') return { min: limits.numberDigitsMin, max: limits.numberDigitsMax };
  if (name === 'FractionDigits') return { min: 0, max: Number(values.Digits ?? limits.numberDigitsMax) };
  if (values.AllowedLength === 'Fixed') return { min: limits.stringFixedLengthMin, max: limits.stringFixedLengthMax };
  return { min: limits.stringLengthMin, max: limits.stringLengthMax };
}

function Qualifiers(props) {
  const value = () => Object.fromEntries(props.group.value.Record.map(field => [field.key.name, scalar(field.value)]));
  function update(name, next) {
    props.change(property(props.group.key.name, {
      Record: props.group.value.Record.map(field =>
        field.key.name === name ? property(name, { Text: next }, [], CORE_NS) : field),
    }, [], CORE_NS));
  }
  return <div class="form-type-qualifiers">
    <For each={props.group.value.Record.map(field => field.key.name)}>{name => {
      const descriptor = props.options.qualifiers[name];
      const choices = descriptor?.choices ?? [];
      const caption = descriptor?.caption[props.locale] ?? name;
      const limits = () => numericLimits(name, value(), props.options.limits);
      return <label>{caption}<Show when={choices.length} fallback={
        <input type="number" required min={limits().min} max={limits().max} step="1" value={value()[name]}
          data-type-qualifier={name} onInput={event => update(name, event.currentTarget.value)}/>
      }>
        <select data-type-qualifier={name} value={value()[name]} onChange={event => update(name, event.currentTarget.value)}>
          <For each={choices}>{option => <option value={option.value} selected={value()[name] === option.value}>{option.caption[props.locale]}</option>}</For>
        </select>
      </Show></label>;
    }}</For>
  </div>;
}

export function FormTypeEditor(props) {
  const [search, setSearch] = createSignal('');
  const records = () => props.value?.Record ?? [];
  const members = () => records().filter(memberKind);
  const groups = () => records().filter(item => !memberKind(item));
  const byId = new Map(props.options.choices.map(option => [formTypeId(option.key), option]));
  const optionFor = item => byId.get(formTypeId(memberKey(item)));
  const group = name => groups().find(item => item.key.name === name);
  const caption = option => option.caption?.[props.locale] ?? option.key.name;
  const available = createMemo(() => {
    const selected = new Set(members().map(item => formTypeId(memberKey(item))));
    const query = search().trim().toLocaleLowerCase(props.locale);
    return props.options.choices.filter(option => !selected.has(formTypeId(option.key)) && (
      !query || (caption(option) + ' ' + option.key.name).toLocaleLowerCase(props.locale).includes(query)
    ));
  });
  function save(types, qualifiers) {
    const ordered = [...qualifiers].sort((a, b) => qualifierOrder.indexOf(a.key.name) - qualifierOrder.indexOf(b.key.name));
    props.change({ Record: [...types, ...ordered] });
  }
  function add(option) {
    const entry = property(option.member, { QualifiedText: { text: option.key.name, key: option.key } }, [], CORE_NS);
    const qualifier = option.qualifier;
    const qualifiers = [...groups()];
    if (qualifier && !group(qualifier.name)) qualifiers.push(defaultQualifier(qualifier));
    save([...members(), entry], qualifiers);
    setSearch('');
  }
  function remove(index, option) {
    const remaining = members().filter((_, position) => position !== index);
    const removedQualifier = option?.qualifier?.name;
    save(remaining, groups().filter(item => item.key.name !== removedQualifier));
  }
  return <div class="form-type-editor">
    <For each={members()}>{(item, index) => {
      const option = optionFor(item);
      return <div class="form-type-member">
        <div class="form-edit-condition-header">
          <span class="form-type-caption">{option ? caption(option) : memberKey(item)?.name ?? scalar(item.value)}</span>
          <button type="button" class="form-edit-secondary" onClick={() => remove(index(), option)}>{props.strings.editDelete}</button>
        </div>
        <Show when={option?.qualifier}>{qualifier =>
          <Qualifiers options={props.options} group={group(qualifier().name) ?? defaultQualifier(qualifier())} locale={props.locale}
            change={next => save(members(), [...groups().filter(item => item.key.name !== next.key.name), next])}/>
        }</Show>
      </div>;
    }}</For>
    <label>{props.strings.editSearchTypes}<input type="search" value={search()} onInput={event => setSearch(event.currentTarget.value)}/></label>
    <select aria-label={props.strings.editType} value="" onChange={event => {
      const option = byId.get(event.currentTarget.value);
      if (option) add(option);
      event.currentTarget.value = '';
    }}>
      <option value="">{props.strings.editAddType}</option>
      <For each={available().slice(0, 100)}>{option => <option value={formTypeId(option.key)}>{caption(option)}</option>}</For>
    </select>
    <Show when={available().length > 100}><small>{props.strings.editFilterTypes}</small></Show>
  </div>;
}
