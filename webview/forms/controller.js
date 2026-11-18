import { createProjection, createRoot, createSignal, createStore, flush, merge, snapshot } from 'solid-js';
import { prepare, key, formElementPath, pageSelections } from './model.mjs';
import { parsePreviewNavigation } from '../../src/form-preview/navigation.js';
import { property } from './editor-model.mjs';
import { defaultInspectorUi, parseInspectorState } from '../../src/form-preview/inspector-state.js';

/** Only UI state is persisted. Models and backend session handles are refreshed after reload. */
export function controller(api) {
  const saved = api.getState(), navigation = parsePreviewNavigation(saved?.ui) ?? {pages:{},collapsed:{}};
  const [presentation, set] = createStore({ role: 'main', phase: 'loading', sequence: 0, modelSequence: 0, locale: 'en-US', culture: 'en-US', os: 'linux', strings: {}, revision: null, formSessionId: null, detached: false, handlerNavigation: false, handlerAuthoring: false, referenceData: false,
    notice: '', restore: null, selected: '', copiedType: false, authoring: false, formLayout: null, draftStatus: null, propertySearch: false, propertyMatches: null,
    ui: { ...defaultInspectorUi(), ...parseInspectorState(saved)?.ui, ...navigation } });
  const [model, setModel] = createSignal(null);
  const [schema, setSchema] = createSignal({ editSchema: null, palette: null });
  const { disposeProjection, state } = createRoot(dispose => {
    // Solid's derived stores keep nested keyed array identities across snapshots.
    const view = createProjection(() => ({ model: model() }), { model: null }, { key: 'reconcileKey' });
    const properties = createProjection(() => schema(), { editSchema: null, palette: null }, { key: 'id' });
    return { disposeProjection: dispose, state: merge(presentation, view, properties) };
  });
  const [edit, setEdit] = createSignal(null);
  const [fieldPending, setFieldPending] = createSignal(0);
  const [changing, setChanging] = createSignal(0);
  const [replaying, setReplaying] = createSignal(false);
  const [handlerBusy, setHandlerBusy] = createSignal(false);
  const [propertyReveal, revealProperty] = createSignal('', { equals: false });
  const [dataReveal, setDataReveal] = createSignal('', { equals: false });
  const [actionNotice, setActionNotice] = createSignal('');
  const pending = new Map(), fields = new Map(), changes = new Set();
  let draftId = 0;
  let fieldId = 0;
  const fieldPrefix = Date.now().toString(36) + '-';
  const editStatus = () => state.draftStatus?.saving ? 'editSaving'
    : actionNotice() || state.draftStatus?.notice || (dirty() ? 'editUnsaved' : '');
  const history = () => state.draftStatus ?? { undo: false, redo: false };
  const dirty = () => state.draftStatus?.dirty || fieldPending() + changing() > 0;
  const writable = () => state.authoring && !replaying() && !handlerBusy() && !state.draftStatus?.conflict;
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
    const request = draftAction(action, { operations, merge }).finally(() => {
      changes.delete(request);
      setChanging(count => count - 1);
    });
    changes.add(request);
    return request;
  }
  async function editHandler(target, event) {
    if (!state.handlerAuthoring || !writable()) return;
    target = { ...target };
    const session = state.formSessionId;
    flushFields();
    setHandlerBusy(true);
    flush();
    try {
      // A handler may belong to an element just created by a queued form edit.
      const results = await Promise.all([...changes]);
      if (session !== state.formSessionId || results.some(result => result.message) || state.draftStatus?.conflict) return;
      const result = await new Promise(resolve => {
        const id = ++draftId;
        pending.set(id, resolve);
        post({ type: 'handlerEdit', id, target, event });
      });
      if (!result.name || result.message || result.bound || session !== state.formSessionId) return;
      const operation = target.kind === 'command'
        ? { kind: 'setProperty', target, property: property('Action', { Text: result.name }) }
        : { kind: 'setEvent', target, event, handler: result.name };
      await change([operation]);
    } finally { setHandlerBusy(false); }
  }
  function save() {
    if (!dirty() || replaying() || handlerBusy() || state.draftStatus?.saving || state.draftStatus?.conflict) return;
    flushFields();
    void draftAction('save');
  }
  async function replayForm(action) {
    if (edit() || replaying() || handlerBusy() || !history()[action] && !fieldPending()) return;
    flushFields();
    setReplaying(true);
    flush();
    try { await draftAction(action); }
    finally { setReplaying(false); }
  }
  function historyKey(event) {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.isComposing) return;
    if (event.code === 'KeyS' && dirty()) {
      event.preventDefault();
      event.stopPropagation();
      save();
      return;
    }
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    const action = event.code === 'KeyZ' ? (event.shiftKey ? 'redo' : 'undo')
      : event.code === 'KeyY' ? 'redo' : undefined;
    if (action && (history()[action] || fieldPending())) {
      event.preventDefault();
      // VS Code forwards window-level webview shortcuts back to the workbench.
      event.stopPropagation();
      void replayForm(action);
    }
  }
  function openEditor(intent, target, section, placement) {
    if (!writable() || edit() || replaying()) return;
    flushFields();
    setEdit({ intent, target, section, placement });
    flush();
  }
  function closeEditor() {
    setEdit(null);
    flush();
  }
  function revealData(row) {
    set(draft => {
      draft.ui.tab = row.section;
      draft.ui.inspectedData = row.id;
    });
    setDataReveal(row.id);
    persist(true);
  }
  const [selection, setSelection] = createSignal(saved?.selection ?? null);
  const [previewReveal, setPreviewReveal] = createSignal('', { equals: false });
  const [treeReveal, setTreeReveal] = createSignal('', { equals: false });
  // Store proxies cannot cross VS Code's structured-clone message boundary.
  const post = value => api.postMessage(snapshot(value));
  const navigationState = () => {
    const { pages, collapsed } = snapshot(state.ui);
    return { pages, collapsed };
  };
  const shareNavigation = () => post({type:'previewNavigation',previewNavigation:navigationState()});
  function applyNavigation(value) {
    const navigation = parsePreviewNavigation(value);
    if (!navigation) return;
    set(draft => {
      draft.ui.pages = navigation.pages;
      draft.ui.collapsed = navigation.collapsed;
    });
  }
  function selectIdentity(identity, explicit = false) {
    set(draft => {
      draft.selected = key({ identity });
      if (explicit) draft.ui.inspectedData = '';
    });
    setSelection(identity);
  }
  function revealInPreview(identity) {
    const selected = key({ identity });
    const path = formElementPath(state.model?.root, selected);
    if (!path.length) return;
    const pages = pageSelections(state.model.root, selected);
    const collapsed = { ...state.ui.collapsed };
    for (const node of path.slice(0, -1)) if (collapsed[node.key]) collapsed[node.key] = false;
    selectIdentity(identity, true);
    set(draft => {
      Object.assign(draft.ui.pages, pages);
      draft.ui.collapsed = collapsed;
    });
    shareNavigation();
    setPreviewReveal(selected);
  }
  let persistFrame, shareInspector = false;
  function persist(userChange = false) {
    shareInspector ||= userChange;
    cancelAnimationFrame(persistFrame);
    persistFrame = requestAnimationFrame(() => {
      const saved = { schemaVersion: 1, ...snapshot(state.restore), selection: snapshot(selection()),
        ui: { ...snapshot(state.ui), selected: state.selected } };
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

    try {
      if (value.type === 'formDraftResult' || value.type === 'formHandlerResult') {
        const resolve = pending.get(value.id);
        pending.delete(value.id);
        if (!resolve) return;
        if (value.message) setActionNotice(value.message);
        if (value.type === 'formDraftResult' && value.target?.name) {
          const section = { attribute: 'attributes', command: 'commands', parameter: 'parameters' }[value.target.kind];
          if (section) {
            set(draft => {
              draft.ui.tab = section;
              draft.ui.inspectedData = section + ':' + value.target.name;
            });
            persist(true);
          }
        }
        resolve(value);
        return;
      }
      if (value.type === 'propertyMatches') {
        if (value.revision === state.revision && value.formSessionId === state.formSessionId && value.query === state.ui.search)
          set(draft => { draft.propertyMatches = value; });
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
          let result;
          if (value.external === true) {
            const selected = key({ identity: value.identity });
            set(draft => { result = revealInInspector(draft, selected); });
            if (result) setTreeReveal(selected);
          }
          persist(result?.changed);
        }
        return;
      }
      if (value.type === 'showOnForm' && value.identity) {
        revealInPreview(value.identity);
        persist();
        return;
      }
      if (value.type === 'inspectorTypeCopied') {
        set(draft => { draft.copiedType = true; });
        return;
      }
      if (value.type !== 'state' || !Number.isSafeInteger(value.sequence) || value.sequence < state.sequence) return;

      if (value.previewNavigation) applyNavigation(value.previewNavigation);
      const inspector = parseInspectorState(value.inspectorState);
      const revision = value.revision ?? null, formSessionId = value.formSessionId ?? null;
      const hadModel = !!state.model;
      // Palette and status messages advance the delivery sequence without invalidating native paint.
      const newModel = value.model && (!hadModel || revision === null || formSessionId === null
        || revision !== state.revision || formSessionId !== state.formSessionId);
      const model = newModel ? prepare(value.model) : undefined;
      if (model) setModel(model);
      if (value.editSchema !== undefined || value.palette !== undefined) setSchema(previous => ({
        editSchema: value.editSchema === undefined ? previous.editSchema : value.editSchema,
        palette: value.palette === undefined ? previous.palette : value.palette,
      }));
      let reveal = '';
      set(draft => {
        if (inspector) Object.assign(draft.ui, inspector.ui);
        for (const field of ['role', 'phase', 'sequence', 'locale', 'culture', 'os', 'strings', 'detached', 'handlerNavigation', 'handlerAuthoring', 'referenceData', 'authoring', 'formLayout', 'draftStatus', 'propertySearch', 'notice', 'restore', 'title']) {
          if (value[field] !== undefined) draft[field] = value[field];
        }
        if (model) {
          draft.revision = revision;
          draft.formSessionId = formSessionId;
          draft.modelSequence = value.sequence;
          if (!draft.selected) draft.selected = draft.ui.selected ?? key(value.model.root);
        }
        if (value.selection) {
          const selected = key({ identity: value.selection });
          if (selected !== draft.selected && value.model && hadModel && !inspector) {
            const result = revealInInspector(draft, selected, model ?? state.model);
            if (result) reveal = selected;
          }
          draft.selected = selected;
        }
      });
      if (value.selection) setSelection(value.selection);
      if (reveal) setTreeReveal(reveal);
      persist();
    } finally {
      flush();
    }
  }
  window.addEventListener('message', receive);
  function revealInInspector(draft, selected, model = state.model) {
    if (draft.role !== 'main') return;
    const path = formElementPath(model?.root, selected);
    if (!path.length) return;
    const folds = path.slice(0, -1).filter(node => draft.ui.folded[node.key]);
    const changed = folds.length > 0 || draft.ui.treeTab !== 'elements';
    for (const ancestor of folds) delete draft.ui.folded[ancestor.key];
    draft.ui.treeTab = 'elements';
    draft.ui.inspectedData = '';
    return { changed };
  }
  function select(node, reveal = false) {
    selectIdentity(node.identity, true);
    let result;
    if (reveal) {
      const selected = key(node);
      set(draft => { result = revealInInspector(draft, selected); });
      if (result) setTreeReveal(selected);
    }
    post({ type: 'select', identity: node.identity });
    persist(result?.changed);
    flush();
  }
  const showOnForm = node => {
    select(node);
    post({ type: 'showOnForm', identity: node.identity });
  };
  const copyType = value => {
    set(draft => { draft.copiedType = false; });
    post({ type: 'copyInspectorType', value });
  };
  const ui = (name, value) => {
    set(draft => { draft.ui[name] = value; });
    const shared = name === 'pages' || name === 'collapsed';
    if (shared) shareNavigation();
    persist(!shared);
    flush();
  };
  post({ type: 'ready', ...(Object.keys(navigation.pages).length||Object.keys(navigation.collapsed).length?{previewNavigation:navigation}:{}) });
  return { state, selection, select, ui, post, previewReveal, treeReveal, showOnForm, copyType, openEditor, edit, editStatus, closeEditor,
    history, replaying, replayForm, historyKey, draftAction, change, save, dirty, writable, editHandler, handlerBusy, propertyReveal, revealProperty, dataReveal, revealData,
    fieldPending, scheduleField, flushField, discardField, nextFieldId: () => fieldPrefix + ++fieldId,
    dispose: () => {
      window.removeEventListener('message', receive);
      cancelAnimationFrame(persistFrame);
      for (const key of fields.keys()) discardField(key);
      for (const resolve of pending.values()) resolve({ message: 'editUnavailable' });
      pending.clear();
      disposeProjection();
    } };
}
