import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { ConditionalAppearanceEditor } from './ConditionalAppearanceEditor.jsx';
import { FormPropertyEditor } from './FormEditorFields.jsx';
import { FormDefinitionEditor, FormStructureEditor } from './FormEditorStructure.jsx';
import { targetKey } from './editor-model.mjs';

const titles = {
  properties: 'editProperties', addElement: 'editAddElement', copy: 'editCopy', move: 'editMove',
  remove: 'editRemove', addDefinition: 'editAddDefinition', appearance: 'editAppearance',
};

export function FormEditor(props) {
  const c = props.controller, s = c.state.strings, { intent, target } = props.draft;
  const [schema, setSchema] = createSignal(null);
  const [review, setReview] = createSignal(null);
  const [error, setError] = createSignal('');
  const [references, setReferences] = createSignal([]);
  const [pending, setPending] = createSignal('editLoading');
  let dialog;
  onMount(() => dialog.showModal());
  onCleanup(() => { if (dialog.open) dialog.close(); });

  createEffect(() => {
    const result = c.editResult();
    if (!result) return;
    setPending('');
    if (result.phase === 'ready') setSchema(result.schema);
    if (result.phase === 'preview') {
      setReview(result.changed ? result.changes : null);
      if (!result.changed) setError('editNoChanges');
    }
    if (result.phase === 'error') {
      setReview(null);
      setError(result.message);
      setReferences(result.references ?? []);
    }
  });

  const selection = createMemo(() => schema()?.nodes.find(node => targetKey(node.target) === targetKey(target)));
  const catalogue = createMemo(() => {
    const node = selection();
    if (!node) return [];
    const definitions = ['attribute', 'command', 'parameter'].includes(node.target.kind);
    const kinds = definitions ? schema().definitionKinds : schema().elementKinds;
    return kinds.find(item => item.kind === node.kind)?.catalog ?? [];
  });
  const dataPaths = createMemo(() => {
    const paths = new Set(schema()?.nodes.filter(node => node.target.kind === 'attribute').map(node => node.target.name) ?? []);
    for (const field of c.state.model?.dataFields ?? []) paths.add(field.path.join('.'));
    return [...paths].sort((a, b) => a.localeCompare(b, c.state.locale)).slice(0, 4096);
  });
  const title = () => s[titles[intent]];
  const locale = () => c.state.locale.startsWith('ru') ? 'ru-RU' : 'en-US';
  const appearanceAvailable = () => schema()?.conditionalAppearance || schema()?.dynamicListAppearance?.some(list => list.appearance);
  const canPreview = () => schema()?.writable && !(intent === 'appearance' && !appearanceAvailable())
    && (intent === 'addDefinition' || intent === 'appearance' || selection());
  const blocked = () => c.editResult()?.fatal || ['editUnknownWrite', 'editSavedRefresh', 'editConflict'].includes(error());
  function preview(operations) {
    setReferences([]);
    if (!operations.length) { setError('editNoChanges'); return; }
    setError('');
    setPending('editWorking');
    c.editAction('preview', { operations });
  }
  function save() {
    setError('');
    setPending('editSaving');
    c.editAction('save');
  }
  function back() {
    c.editAction('back');
    setReview(null);
  }
  function cancel() {
    if (pending() !== 'editSaving') c.closeEditor();
  }
  return <dialog class="form-editor" ref={dialog} aria-labelledby="form-edit-title"
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <div class="form-edit-shell">
      <header class="form-edit-heading">
        <h2 id="form-edit-title">{title()}</h2>
        <Show when={selection()?.name}><span class="form-truncate">{selection().name}</span></Show>
      </header>
      <div class="form-edit-content">
        <div hidden={!!review()} inert={!!pending()}>
          <Show when={schema()?.writable} fallback={<Show when={schema()}><p>{s.editLocked}</p></Show>}>
            <Switch>
              <Match when={intent === 'appearance'}>
                <Show when={appearanceAvailable()} fallback={<p>{s.editUnsupported}</p>}>
                  <ConditionalAppearanceEditor schema={schema()} strings={s} locale={locale()} paths={dataPaths()}
                    model={c.state.model} submit={preview}/>
                </Show>
              </Match>
              <Match when={intent === 'properties' && selection()}>
                <FormPropertyEditor schema={schema()} strings={s} locale={locale()} paths={dataPaths()}
                  node={selection()} catalog={catalogue()} model={c.state.model} submit={preview}/>
              </Match>
              <Match when={intent === 'addDefinition'}>
                <FormDefinitionEditor strings={s} locale={locale()} options={schema().typeOptions} node={selection()} section={props.draft.section} submit={preview}/>
              </Match>
              <Match when={selection()}>
                <FormStructureEditor intent={intent} strings={s} node={selection()} schema={schema()}
                  locale={locale()} submit={preview}/>
              </Match>
            </Switch>
          </Show>
        </div>
        <Show when={review()}><section class="form-edit-review" aria-label={s.editReview}>
          <For each={review()}>{part => <div class="form-edit-review-part">
            <section><h3>{s.editBefore}</h3><pre tabindex="0">{part.before}</pre></section>
            <section><h3>{s.editAfter}</h3><pre tabindex="0">{part.after}</pre></section>
          </div>}</For>
        </section></Show>
      </div>
      <div class="form-edit-status" role={error() ? 'alert' : 'status'}>
        <Show when={pending() || error()}><p>{s[pending() || error()]}</p></Show>
        <Show when={references().length}><ul><For each={references()}>{path => <li><code>{path}</code></li>}</For></ul></Show>
      </div>
      <footer class="form-edit-actions">
        <Show when={review()} fallback={
          <Show when={canPreview() && !blocked()}><button type="submit" form="form-edit-draft" disabled={!!pending()}>{s.editReview}</button></Show>
        }>
          <button type="button" onClick={save} disabled={!!pending()}>{s.editSave}</button>
          <button type="button" class="form-edit-secondary" onClick={back} disabled={!!pending()}>{s.editBack}</button>
        </Show>
        <button type="button" class="form-edit-secondary" onClick={cancel} disabled={pending() === 'editSaving'}
          >{schema() ? s.editCancel : s.editClose}</button>
      </footer>
    </div>
  </dialog>;
}
