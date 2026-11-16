import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { ConditionalAppearanceEditor } from './ConditionalAppearanceEditor.jsx';
import { FormDefinitionEditor, FormStructureEditor } from './FormEditorStructure.jsx';
import { formEditIndex, targetKey } from './editor-model.mjs';

const titles = {
  addElement: 'editAddElement', copy: 'editCopy', move: 'editMove',
  remove: 'editRemove', addDefinition: 'editAddDefinition', appearance: 'editAppearance',
};

export function FormEditor(props) {
  const c = props.controller, s = c.state.strings, { intent, target } = props.draft;
  const [error, setError] = createSignal('');
  const [references, setReferences] = createSignal([]);
  const [pending, setPending] = createSignal(false);
  let dialog;
  onMount(() => dialog.showModal());
  onCleanup(() => { if (dialog.open) dialog.close(); });

  const schema = () => c.state.editSchema;
  const selection = createMemo(() => formEditIndex(schema()).get(targetKey(target)));
  const dataPaths = createMemo(() => {
    const paths = new Set(schema()?.nodes.filter(node => node.target.kind === 'attribute').map(node => node.target.name) ?? []);
    for (const field of c.state.model?.dataFields ?? []) paths.add(field.path.join('.'));
    return [...paths].sort((a, b) => a.localeCompare(b, c.state.locale));
  });
  const locale = () => c.state.locale.startsWith('ru') ? 'ru-RU' : 'en-US';
  const appearanceAvailable = () => schema()?.conditionalAppearance || schema()?.dynamicListAppearance?.some(list => list.appearance);
  const canSubmit = () => c.writable() && (intent === 'appearance' ? appearanceAvailable() : intent === 'addDefinition' || selection());
  async function submit(operations) {
    if (!operations.length || pending()) return;
    setError('');
    setReferences([]);
    setPending(true);
    try {
      const result = await c.change(operations);
      if (!result.message) c.closeEditor();
      else { setError(result.message); setReferences(result.references ?? []); }
    } finally {
      setPending(false);
    }
  }
  function cancel() {
    if (!pending()) c.closeEditor();
  }
  return <dialog class="form-editor" ref={dialog} aria-labelledby="form-edit-title"
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <div class="form-edit-shell">
      <header class="form-edit-heading">
        <h2 id="form-edit-title">{s[titles[intent]]}</h2>
        <Show when={selection()?.name}><span class="form-truncate">{selection().name}</span></Show>
      </header>
      <div class="form-edit-content" inert={pending()}>
        <Show when={schema()?.writable} fallback={<p>{s.editLocked}</p>}>
          <Switch>
            <Match when={intent === 'appearance'}>
              <Show when={appearanceAvailable()} fallback={<p>{s.editUnsupported}</p>}>
                <ConditionalAppearanceEditor schema={schema()} strings={s} locale={locale()} paths={dataPaths()}
                  model={c.state.model} submit={submit}/>
              </Show>
            </Match>
            <Match when={intent === 'addDefinition'}>
              <FormDefinitionEditor strings={s} locale={locale()} options={schema().typeOptions} node={selection()} section={props.draft.section} submit={submit}/>
            </Match>
            <Match when={selection()}>
              <FormStructureEditor intent={intent} placement={props.draft.placement} strings={s} node={selection()} schema={schema()}
                locale={locale()} submit={submit}/>
            </Match>
          </Switch>
        </Show>
      </div>
      <div class="form-edit-status" role={error() ? 'alert' : 'status'}>
        <Show when={pending() || error()}><p>{s[pending() ? 'editWorking' : error()]}</p></Show>
        <Show when={references().length}><ul><For each={references()}>{path => <li><code>{path}</code></li>}</For></ul></Show>
      </div>
      <footer class="form-edit-actions">
        <Show when={canSubmit()}><button type="submit" form="form-edit-draft" disabled={pending()}>{s[{
          addElement: 'editAdd', addDefinition: 'editAdd', copy: 'editDuplicate', move: 'editMoveHere',
          remove: 'editDelete', appearance: 'editApplyAppearance',
        }[intent]]}</button></Show>
        <button type="button" class="form-edit-secondary" onClick={cancel} disabled={pending()}>{s.editCancel}</button>
      </footer>
    </div>
  </dialog>;
}
