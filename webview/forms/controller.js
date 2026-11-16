import { createStore, reconcile, unwrap } from 'solid-js/store';
import { batch, createSignal } from 'solid-js';
import { prepare, key, formElementPath, pageSelections } from './model.mjs';
import { parsePreviewNavigation } from '../../src/form-preview/navigation.js';
import { defaultInspectorUi, parseInspectorState } from '../../src/form-preview/inspector-state.js';

/** Only UI state is persisted. Models and backend session handles are refreshed after reload. */
export function controller(api) {
  const saved = api.getState(), navigation = parsePreviewNavigation(saved?.ui) ?? {pages:{},collapsed:{}};
  const [state, set] = createStore({ role: 'main', phase: 'loading', sequence: 0, modelSequence: 0, locale: 'en-US', culture: 'en-US', os: 'linux', strings: {}, model: null, palette: null, revision: null, formSessionId: null, detached: false, handlerNavigation: false, referenceData: false,
    notice: '', restore: null, selected: '', copiedType: false, authoring: false, formLayout: null, editSchema: null, draftStatus: null, propertySearch: false, propertyMatches: null,
    ui: { ...defaultInspectorUi(), ...parseInspectorState(saved)?.ui, ...navigation } });
  const [edit, setEdit] = createSignal(null);
  const [fieldPending, setFieldPending] = createSignal(0);
  const [changing, setChanging] = createSignal(0);
  const [replaying, setReplaying] = createSignal(false);
  const [propertyReveal, revealProperty] = createSignal('', { equals: false });
  const [dataReveal, setDataReveal] = createSignal('', { equals: false });
  const [actionNotice, setActionNotice] = createSignal('');
  const pending = new Map(), fields = new Map();
  let draftId = 0;
  let fieldId = 0;
  const fieldPrefix = Date.now().toString(36) + '-';
  const editStatus = () => state.draftStatus?.saving ? 'editSaving'
    : actionNotice() || state.draftStatus?.notice || (dirty() ? 'editUnsaved' : '');
  const history = () => state.draftStatus ?? { undo: false, redo: false };
  const dirty = () => state.draftStatus?.dirty || fieldPending() + changing() > 0;
  const writable = () => state.authoring && !state.draftStatus?.conflict && !state.draftStatus?.saving;
  function draftAction(action, payload) {
    const id = ++draftId;
    setActionNotice('');
    return new Promise(resolve => {
      pending.set(id, resolve);
      post({ type: 'formDraft', action, id, ...payload });
    });
  }
  function flushField(key) {
    const entry = fields.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    fields.delete(key);
    setFieldPending(fields.size);
    entry.run();
  }
  function discardField(key) {
    clearTimeout(fields.get(key)?.timer);
    fields.delete(key);
    setFieldPending(fields.size);
  }
  function scheduleField(key, run, delay) {
    discardField(key);
    fields.set(key, { run, timer: setTimeout(() => flushField(key), delay) });
    setFieldPending(fields.size);
  }
  function flushFields() { for (const key of fields.keys()) flushField(key); }
  function change(operations, merge, action = 'change') {
    setChanging(count => count + 1);
    return draftAction(action, { operations, merge }).finally(() => setChanging(count => count - 1));
  }
  function save() {
    if (!dirty() || state.draftStatus?.saving || state.draftStatus?.conflict) return;
    flushFields();
    void draftAction('save');
  }
  async function replayForm(action) {
    if (edit() || replaying() || !history()[action] && !fieldPending()) return;
    flushFields();
    setReplaying(true);
    try { await draftAction(action); }
    finally { setReplaying(false); }
  }
  function historyKey(event) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing) return;
    if (event.code === 'KeyS' && dirty()) {
      event.preventDefault();
      save();
      return;
    }
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    const action = event.code === 'KeyZ' ? (event.shiftKey ? 'redo' : 'undo')
      : event.code === 'KeyY' ? 'redo' : undefined;
    if (action && (history()[action] || fieldPending())) { event.preventDefault(); void replayForm(action); }
  }
  function openEditor(intent, target, section, placement) {
    if (!writable() || edit() || replaying()) return;
    flushFields();
    setEdit({ intent, target, section, placement });
  }
  const closeEditor = () => setEdit(null);
  function revealData(row) {
    batch(() => {
      set('ui', 'tab', row.section);
      set('ui', 'inspectedData', row.id);
      setDataReveal(row.id);
      persist(true);
    });
  }
  const [selection, setSelection] = createSignal(saved?.selection ?? null);
  const [previewReveal, setPreviewReveal] = createSignal('', { equals: false });
  // Store proxies cannot cross VS Code's structured-clone message boundary.
  const post = value => api.postMessage(unwrap(value));
  const navigationState = () => ({pages:unwrap(state.ui.pages),collapsed:unwrap(state.ui.collapsed)});
  const shareNavigation = () => post({type:'previewNavigation',previewNavigation:navigationState()});
  function applyNavigation(value) {
    const navigation = parsePreviewNavigation(value);
    if (!navigation) return;
    set('ui', 'pages', reconcile(navigation.pages));
    set('ui', 'collapsed', reconcile(navigation.collapsed));
  }
  function selectIdentity(identity, explicit = false) {
    set('selected', key({ identity }));
    setSelection(identity);
    if (explicit) set('ui', 'inspectedData', '');
  }
  function revealInPreview(identity) {
    const selected = key({ identity });
    const path = formElementPath(state.model?.root, selected);
    if (!path.length) return;
    const pages = pageSelections(state.model.root, selected);
    const collapsed = { ...state.ui.collapsed };
    for (const node of path.slice(0, -1)) if (collapsed[node.key]) collapsed[node.key] = false;
    selectIdentity(identity, true);
    set('ui', 'pages', { ...state.ui.pages, ...pages });
    set('ui', 'collapsed', collapsed);
    shareNavigation();
    setPreviewReveal(selected);
  }
  let persistFrame, shareInspector = false;
  function persist(userChange = false) {
    shareInspector ||= userChange;
    cancelAnimationFrame(persistFrame);
    persistFrame = requestAnimationFrame(() => {
      const saved = { schemaVersion: 1, ...unwrap(state.restore), selection: unwrap(selection()),
        ui: { ...unwrap(state.ui), selected: state.selected } };
      api.setState(saved);
      if (shareInspector && state.role === 'main') {
        const preferences = parseInspectorState(saved);
        if (preferences) post({ type: 'inspectorState', ...preferences });
      }
      shareInspector = false;
    });
  }
  function receive(event) {
    const value = event.data;
    if (!value || typeof value !== 'object') return;

    batch(() => {
      if (value.type === 'formDraftResult') {
        const resolve = pending.get(value.id);
        pending.delete(value.id);
        if (!resolve) return;
        if (value.message) setActionNotice(value.message);
        if (value.target?.name) {
          const section = { attribute: 'attributes', command: 'commands', parameter: 'parameters' }[value.target.kind];
          if (section) {
            set('ui', 'tab', section);
            set('ui', 'inspectedData', section + ':' + value.target.name);
            persist(true);
          }
        }
        resolve(value);
        return;
      }
      if (value.type === 'propertyMatches') {
        if (value.revision === state.revision && value.formSessionId === state.formSessionId && value.query === state.ui.search)
          set('propertyMatches', value);
        return;
      }
      if (value.type === 'previewNavigation') {
        applyNavigation(value.previewNavigation);
        persist();
        return;
      }
      if (value.type === 'selection') {
        if (value.identity) {
          selectIdentity(value.identity, value.external === true);
          if (value.external) revealInInspector(value.identity);
          persist();
        }
        return;
      }
      if (value.type === 'showOnForm' && value.identity) {
        revealInPreview(value.identity);
        persist();
        return;
      }
      if (value.type === 'inspectorTypeCopied') {
        set('copiedType', true);
        return;
      }
      if (value.type !== 'state' || !Number.isSafeInteger(value.sequence) || value.sequence < state.sequence) return;

      if (value.previewNavigation) applyNavigation(value.previewNavigation);
      const inspector = parseInspectorState(value.inspectorState);
      if (inspector) set('ui', inspector.ui);
      for (const field of ['role', 'phase', 'sequence', 'locale', 'culture', 'os', 'strings', 'detached', 'handlerNavigation', 'referenceData', 'authoring', 'formLayout', 'draftStatus', 'propertySearch', 'notice', 'restore', 'title']) {
        if (value[field] !== undefined) set(field, value[field]);
      }
      if (value.editSchema !== undefined) set('editSchema', reconcile(value.editSchema, { key: 'id', merge: true }));
      if (value.palette !== undefined) set('palette', reconcile(value.palette, { key: 'id', merge: true }));
      const revision = value.revision ?? null, formSessionId = value.formSessionId ?? null;
      const hadModel = !!state.model;
      // Palette and status messages advance the delivery sequence without invalidating native paint.
      if (value.model && (!state.model || revision === null || formSessionId === null
        || revision !== state.revision || formSessionId !== state.formSessionId)) {
        set('revision', revision);
        set('formSessionId', formSessionId);
        set('modelSequence', value.sequence);
        set('model', reconcile(prepare(value.model), { key: 'reconcileKey', merge: true }));
        if (!state.selected) set('selected', state.ui.selected ?? key(value.model.root));
      }
      if (value.selection) {
        const changed = key({ identity: value.selection }) !== state.selected;
        selectIdentity(value.selection);
        if (changed && value.model && hadModel && !inspector) revealInInspector(value.selection);
      }
      persist();
    });
  }
  window.addEventListener('message', receive);
  function revealInInspector(identity) {
    if (state.role !== 'main') return;
    const path = formElementPath(state.model?.root, key({ identity }));
    if (!path.length) return;
    const folded = { ...state.ui.folded };
    for (const ancestor of path.slice(0, -1)) delete folded[ancestor.key];
    set('ui', 'folded', folded);
    set('ui', 'treeTab', 'elements');
    set('ui', 'inspectedData', '');
  }
  const select = (node, reveal = false) => {
    batch(() => {
      selectIdentity(node.identity, true);
      if (reveal) revealInInspector(node.identity);
    });
    post({ type: 'select', identity: node.identity });
    persist();
  };
  const showOnForm = node => {
    select(node);
    post({ type: 'showOnForm', identity: node.identity });
  };
  const copyType = value => {
    set('copiedType', false);
    post({ type: 'copyInspectorType', value });
  };
  const ui = (name, value) => {
    set('ui', name, value);
    const shared = name === 'pages' || name === 'collapsed';
    if (shared) shareNavigation();
    persist(!shared);
  };
  post({ type: 'ready', ...(Object.keys(navigation.pages).length||Object.keys(navigation.collapsed).length?{previewNavigation:navigation}:{}) });
  return { state, selection, select, ui, post, previewReveal, showOnForm, copyType, openEditor, edit, editStatus, closeEditor,
    history, replaying, replayForm, historyKey, draftAction, change, save, dirty, writable, propertyReveal, revealProperty, dataReveal, revealData,
    fieldPending, scheduleField, flushField, discardField, nextFieldId: () => fieldPrefix + ++fieldId,
    dispose: () => {
      window.removeEventListener('message', receive);
      cancelAnimationFrame(persistFrame);
      for (const key of fields.keys()) discardField(key);
      for (const resolve of pending.values()) resolve({ message: 'editUnavailable' });
      pending.clear();
    } };
}
