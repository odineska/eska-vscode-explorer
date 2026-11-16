import { For, Show } from 'solid-js';
import { FormSearch } from './FormSearch.jsx';
import { InspectorIcon, InspectorIconButton } from './InspectorIcon.jsx';

export function FormToolbar(props) {
  const c = props.controller, s = c.state.strings;
  function toggle(event) {
    if (c.menu.menu()?.anchor === event.currentTarget) { c.menu.close(); return; }
    const actions = [
      { id: 'appearance', label: s.editAppearance, icon: 'format', disabled: !c.writable(), run: () => c.openEditor('appearance') },
      { id: 'source', label: s.xml, icon: 'xml', run: () => c.post({ type: 'source' }) },
      { id: 'refresh', label: s.refresh, icon: 'reset', run: () => c.post({ type: 'refresh' }) },
    ];
    if (c.state.detached) actions.push(
      { id: 'revealPreview', label: s.revealPreview, icon: 'preview', run: () => c.post({ type: 'revealPreview' }) },
      { id: 'dock', label: s.dock, icon: 'pip', run: () => c.post({ type: 'dock' }) },
    );
    if (c.state.draftStatus?.dirty) actions.push({
      id: 'discard', label: s.editDiscard, icon: 'clear', run: () => c.post({ type: 'confirmDiscard' }),
    });
    c.menu.open({ anchor: event.currentTarget, label: s.form, actions });
  }
  return <>
    <FormSearch controller={c} index={props.index}/>
    <InspectorIconButton icon="undo" label={s.editUndo} action="undo" disabled={!c.history().undo || c.replaying()} onClick={() => c.replayForm('undo')}/>
    <InspectorIconButton icon="redo" label={s.editRedo} action="redo" disabled={!c.history().redo || c.replaying()} onClick={() => c.replayForm('redo')}/>
    <button type="button" class="form-menu-toggle" data-edit-action="formMenu" aria-haspopup="menu"
      aria-expanded={c.menu.menu()?.anchor.dataset.editAction === 'formMenu'} onClick={toggle}>{s.form}<InspectorIcon name="down"/></button>
    <Show when={c.state.authoring || c.state.draftStatus?.dirty}><InspectorIconButton icon="save" label={s.editSave} action="save"
      disabled={!c.dirty() || c.state.draftStatus?.saving || c.state.draftStatus?.conflict} onClick={c.save}/></Show>
  </>;
}

export function PreviewToolbar(props) {
  const c = props.controller, state = c.state, s = state.strings;
  const detached = () => state.role === 'preview';
  return <div class="form-preview-toolbar">
    <span>{s.preview}</span>
    <label class="form-zoom">{s.zoom}<select aria-label={s.zoom} value={state.ui.zoom}
      onChange={event => c.ui('zoom', Number(event.currentTarget.value))}>
      <For each={[50, 75, 100, 125, 150, 200]}>{value => <option value={value}>{value}%</option>}</For>
    </select></label>
    <InspectorIconButton icon="pip" label={detached() ? s.dock : s.detach} action={detached() ? 'dockPreview' : 'detachPreview'}
      onClick={() => c.post({ type: detached() ? 'dock' : 'detach' })}/>
  </div>;
}
