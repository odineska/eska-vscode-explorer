import { For, Show, createMemo, createSignal } from 'solid-js';
import { TypeChoice } from './FormEditorFields.jsx';
import { FormTypeEditor } from './FormTypeEditor.jsx';
import { addType, definitionSections, property, targetKey } from './editor-model.mjs';

function pathLabel(node, index, strings) {
  if (node.target.kind === 'root') return strings.form;
  const label = node.name ?? strings[`elementKind.${node.kind}`] ?? node.kind;
  const parent = index.get(targetKey(node.parent));
  return parent && parent.target.kind !== 'root' ? `${pathLabel(parent, index, strings)} / ${label}` : label;
}

export function FormStructureEditor(props) {
  const { intent, node, schema, strings: s } = props;
  const index = new Map(schema.nodes.map(node => [targetKey(node.target), node]));
  const children = new Map(schema.elementKinds.map(kind => [kind.kind, kind.childKinds]));
  const containers = schema.nodes.filter(candidate => ['root', 'element'].includes(candidate.target.kind) && children.get(candidate.kind)?.length);
  const isAdd = intent === 'addElement';
  const isCopy = intent === 'copy';
  const defaultParent = isAdd && children.get(node?.kind)?.length ? node : index.get(targetKey(node?.parent));
  function ownSubtree(candidate) {
    for (let current = candidate; current; current = index.get(targetKey(current.parent))) {
      if (targetKey(current.target) === targetKey(node.target)) return true;
    }
    return false;
  }
  const parents = isAdd ? containers : containers.filter(candidate =>
    children.get(candidate.kind).includes(node?.kind) && (isCopy || !ownSubtree(candidate)));
  const [parent, setParent] = createSignal(parents.includes(defaultParent) ? defaultParent : parents[0]);
  const [name, setName] = createSignal(isCopy && node?.name ? node.name + 'Copy' : '');
  const [kind, setKind] = createSignal('');
  const [before, setBefore] = createSignal('');
  const [confirm, setConfirm] = createSignal(false);
  const kindLabel = kind => s[`elementKind.${kind}`] ?? kind;
  const kinds = () => children.get(parent()?.kind) ?? [];
  const sortedKinds = createMemo(() => [...kinds()].sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), props.locale)));
  const siblings = createMemo(() => schema.nodes.filter(candidate => candidate.layoutChild
    && targetKey(candidate.parent) === targetKey(parent()?.target)
    && (intent !== 'move' || targetKey(candidate.target) !== targetKey(node?.target))));
  const allowed = intent === 'remove' ? node?.layoutChild || node && ['attribute', 'command', 'parameter'].includes(node.target.kind)
    : parents.length && (isAdd || node?.layoutChild);
  function submit(event) {
    event.preventDefault();
    if (!allowed) return;
    if (intent === 'remove') {
      if (confirm()) props.submit([{ kind: 'remove', target: node.target, force: false }]);
      return;
    }
    if (!parent()) return;
    const placement = { parent: parent().target, before: before() ? Number(before()) : null };
    if (isAdd) {
      if (!kinds().includes(kind()) || !name().trim()) return;
      props.submit([{ kind: 'addElement', ...placement, element: {
        kind: kind(), name: name().trim(), properties: [], children: [], auxiliary: [],
      } }]);
    } else if (isCopy) {
      if (name().trim()) props.submit([{ kind: 'copyElement', target: node.target, ...placement, name: name().trim() }]);
    } else {
      props.submit([{ kind: 'moveElement', target: node.target, ...placement }]);
    }
  }
  return <Show when={allowed} fallback={<p>{s.editNoOptions}</p>}>
    <form id="form-edit-draft" class="form-edit-form" onSubmit={submit}>
      <Show when={intent === 'remove'} fallback={<>
        <label>{s.editParent}<select value={targetKey(parent()?.target)} onChange={event => {
          setParent(index.get(event.currentTarget.value)); setKind(''); setBefore('');
        }}><For each={parents}>{candidate => <option value={targetKey(candidate.target)} selected={candidate === parent()}>
          {pathLabel(candidate, index, s)}
        </option>}</For></select></label>
        <Show when={isAdd}>
          <label>{s.editKind}<select required value={kind()} onChange={event => setKind(event.currentTarget.value)}>
            <option value="">{s.editChoose}</option>
            <For each={sortedKinds()}>{item => <option value={item} selected={item === kind()}>{kindLabel(item)}</option>}</For>
          </select></label>
        </Show>
        <Show when={isAdd || isCopy}>
          <label>{s.editName}<input type="text" required value={name()} onInput={event => setName(event.currentTarget.value)}/></label>
        </Show>
        <label>{s.editPosition}<select value={before()} onChange={event => setBefore(event.currentTarget.value)}>
          <option value="">{s.editAtEnd}</option>
          <For each={siblings()}>{item => <option value={item.target.id} selected={String(item.target.id) === before()}>{item.name}</option>}</For>
        </select></label>
      </>}>
        <strong>{node.name}</strong>
        <label class="form-edit-check"><input type="checkbox" required checked={confirm()}
          onChange={event => setConfirm(event.currentTarget.checked)}/>{s.editRemoveCheck}</label>
      </Show>
    </form>
  </Show>;
}

export function FormDefinitionEditor(props) {
  const s = props.strings;
  const [name, setName] = createSignal('');
  const [type, setType] = createSignal(undefined);
  const section = definitionSections[props.section];
  const canColumn = section === 'attribute' && props.node?.target.kind === 'attribute';
  const [column, setColumn] = createSignal(false);
  function submit(event) {
    event.preventDefault();
    if (!name().trim() || !section) return;
    props.submit([{ kind: 'addDefinition', section, parent: column() ? props.node.target : null,
      name: name().trim(), properties: type() ? [property('Type', type())] : [] }]);
  }
  return <form id="form-edit-draft" class="form-edit-form" onSubmit={submit}>
    <Show when={canColumn} fallback={<strong>{s[section === 'attribute' ? 'editAttribute' : section === 'command' ? 'editCommand' : 'editParameter']}</strong>}>
      <label>{s.editKind}<select onChange={event => setColumn(event.currentTarget.value === 'column')}>
        <option value="attribute">{s.editAttribute}</option><option value="column">{s.editColumn} · {props.node.name}</option>
      </select></label>
    </Show>
    <label>{s.editName}<input type="text" required value={name()} onInput={event => setName(event.currentTarget.value)}/></label>
    <Show when={section !== 'command'}><Show when={props.options} fallback={<label>{s.editType}<TypeChoice
      value={type()?.Record[0]?.value.QualifiedText?.key} change={key => setType(key ? addType(key).value : undefined)} strings={s}/></label>}>
      <FormTypeEditor strings={s} locale={props.locale} options={props.options} value={type()} change={setType}/>
    </Show></Show>
  </form>;
}
