import { createStore, reconcile, unwrap } from 'solid-js/store';
import { batch, createSignal } from 'solid-js';
import { prepare, key, formElementPath, pageSelections } from './model.mjs';
import { parsePreviewNavigation } from '../../src/form-preview/navigation.js';
import { defaultInspectorUi, parseInspectorState } from '../../src/form-preview/inspector-state.js';

/** Only UI state is persisted. Models and backend session handles are refreshed after reload. */
export function controller(api) {
  const saved = api.getState(), navigation = parsePreviewNavigation(saved?.ui) ?? {pages:{},collapsed:{}};
  const [state, set] = createStore({ role: 'main', phase: 'loading', sequence: 0, locale: 'en-US', culture: 'en-US', os: 'linux', strings: {}, model: null, palette: null, revision: null, formSessionId: null, detached: false, handlerNavigation: false,
    notice: '', restore: null, selected: '', copiedType: false,
    ui: { ...defaultInspectorUi(), ...parseInspectorState(saved)?.ui, ...navigation } });
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
      if (value.type === 'previewNavigation') {
        applyNavigation(value.previewNavigation);
        persist();
        return;
      }
      if (value.type === 'selection') {
        if (value.identity) {
          selectIdentity(value.identity, value.external === true);
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
      for (const field of ['role', 'phase', 'sequence', 'locale', 'culture', 'os', 'strings', 'detached', 'handlerNavigation', 'notice', 'restore', 'title']) {
        if (value[field] !== undefined) set(field, value[field]);
      }
      if (value.palette !== undefined) set('palette', reconcile(value.palette, { key: 'id', merge: true }));
      if (value.model) {
        set('revision', value.revision ?? null);
        set('formSessionId', value.formSessionId ?? null);
        set('model', reconcile(prepare(value.model), { key: 'reconcileKey', merge: true }));
        if (!state.selected) set('selected', state.ui.selected ?? key(value.model.root));
      }
      if (value.selection) selectIdentity(value.selection);
      persist();
    });
  }
  window.addEventListener('message', receive);
  const select = node => {
    batch(() => selectIdentity(node.identity, true));
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
  return { state, selection, select, ui, post, previewReveal, showOnForm, copyType, dispose: () => { window.removeEventListener('message', receive); cancelAnimationFrame(persistFrame); } };
}
