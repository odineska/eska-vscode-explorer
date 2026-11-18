import { For, Show } from 'solid-js';

const literals = {
  string: 'editString', number: 'editNumber', boolean: 'editBoolean',
  reference: 'editReference', date: 'editDateTime',
};

export function emptyOperand(kind) {
  if (kind === 'values') return { kind, value: [] };
  return { kind, value: kind === 'boolean' ? false : '' };
}

function OperandType(props) {
  return <label>{props.strings.editType}<select value={props.kind} onChange={event => props.change(event.currentTarget.value)}>
    <For each={Object.entries(props.options)}>{([kind, label]) =>
      <option value={kind} selected={kind === props.kind}>{props.strings[label]}</option>
    }</For>
  </select></label>;
}

function ScalarOperand(props) {
  const s = props.strings;
  const kind = () => props.operand.kind;
  const value = () => props.operand.value;
  return <label>{s.editValue}<Show when={kind() === 'boolean'} fallback={
    <input type={kind() === 'date' ? 'datetime-local' : kind() === 'number' ? 'number' : 'text'}
      step={kind() === 'date' ? '1' : 'any'} value={value()} required={kind() !== 'string'}
      list={kind() === 'field' ? 'form-appearance-data-paths' : undefined} onInput={event => {
        const input = event.currentTarget.value;
        props.change(kind() === 'date' && input.length === 16 ? input + ':00' : input);
      }}/>
  }><select value={String(value())} onChange={event => props.change(event.currentTarget.value === 'true')}>
    <option value="true" selected={value()}>{s.editTrue}</option>
    <option value="false" selected={!value()}>{s.editFalse}</option>
  </select></Show></label>;
}

function ValueList(props) {
  const s = props.strings;
  const items = () => props.value;
  const changeValue = (index, value) => props.change(items().map((item, i) => i === index ? value : item));
  return <div class="form-edit-value-list" role="group" aria-label={s.editValueList}>
    <For each={items()} keyed={false}>{(item, index) => <div class="form-edit-list-value">
      <OperandType strings={s} options={literals} kind={item().kind}
        change={kind => changeValue(index, emptyOperand(kind))}/>
      <ScalarOperand strings={s} operand={item()}
        change={value => changeValue(index, { ...item(), value })}/>
      <button class="form-edit-secondary" type="button" onClick={() => props.change(items().filter((_, i) => i !== index))}>{s.editDelete}</button>
    </div>}</For>
    <button class="form-edit-secondary" type="button" disabled={items().length >= 512}
      onClick={() => props.change([...items(), emptyOperand('string')])}>{s.editAddValue}</button>
  </div>;
}

export function AppearanceOperandEditor(props) {
  const options = () => {
    const kinds = { field: 'editField', ...literals };
    if (!props.extended) delete kinds.date;
    return props.usesList ? { values: 'editValueList', ...kinds } : kinds;
  };
  return <div class="form-edit-operand">
    <OperandType strings={props.strings} options={options()} kind={props.operand.kind}
      change={kind => props.change(emptyOperand(kind))}/>
    <Show when={props.operand.kind === 'values'} fallback={
      <ScalarOperand strings={props.strings} operand={props.operand}
        change={value => props.change({ ...props.operand, value })}/>
    }>
      <ValueList strings={props.strings} value={props.operand.value}
        change={value => props.change({ kind: 'values', value })}/>
    </Show>
  </div>;
}
