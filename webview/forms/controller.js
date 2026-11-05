import { createStore, reconcile, unwrap } from 'solid-js/store';
import { batch, createSignal } from 'solid-js';
import { prepare, key, pageSelections } from './model.mjs';

function previewNavigation(value) {
  if (!value || typeof value !== 'object' || !value.pages || typeof value.pages !== 'object' || Array.isArray(value.pages)
    || !value.collapsed || typeof value.collapsed !== 'object' || Array.isArray(value.collapsed)
    || !Object.entries(value.pages).every(([owner,page])=>owner.includes(':')&&typeof page==='string'&&page.includes(':'))
    || !Object.entries(value.collapsed).every(([owner,collapsed])=>owner.includes(':')&&typeof collapsed==='boolean')) return;
  return {pages:{...value.pages},collapsed:{...value.collapsed}};
}

/** Only UI state is persisted. Models and backend session handles are refreshed after reload. */
export function controller(api) {
  const saved = api.getState(), navigation = previewNavigation(saved?.ui) ?? {pages:{},collapsed:{}};
  const [state, set] = createStore({ role: 'main', phase: 'loading', sequence: 0, locale: 'en-US', culture: 'en-US', os: 'linux', strings: {}, model: null, detached: false, handlerNavigation: false,
    notice: '', restore: null, selected: '', ui: { upper: 230, left: 40, right: 65, tab: 'attributes', treeTab: 'elements', folded: {}, pages: {}, collapsed: {}, zoom: 100, ...saved?.ui, ...navigation } });
  const [selection, setSelection] = createSignal(saved?.selection ?? null);
  // Store proxies cannot cross VS Code's structured-clone message boundary.
  const post = value => api.postMessage(unwrap(value));
  const navigationState = () => ({pages:unwrap(state.ui.pages),collapsed:unwrap(state.ui.collapsed)});
  const shareNavigation = () => post({type:'previewNavigation',previewNavigation:navigationState()});
  function applyNavigation(value) {
    const navigation=previewNavigation(value);if(!navigation)return;
    set('ui','pages',reconcile(navigation.pages));set('ui','collapsed',reconcile(navigation.collapsed));
  }
  function selectIdentity(identity) {
    const selected = key({ identity }); set('selected', selected); setSelection(identity);
    const pages = pageSelections(state.model?.root, selected);
    if (Object.entries(pages).some(([owner, page]) => state.ui.pages[owner] !== page)) {
      set('ui', 'pages', { ...state.ui.pages, ...pages });shareNavigation();
    }
  }
  let persistFrame;
  const persist = () => { cancelAnimationFrame(persistFrame); persistFrame = requestAnimationFrame(() => api.setState({ schemaVersion: 1, ...unwrap(state.restore), selection: unwrap(selection()), ui: { ...unwrap(state.ui), selected: state.selected } })); };
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
          selectIdentity(value.identity);
          persist();
        }
        return;
      }
      if (value.type !== 'state' || !Number.isSafeInteger(value.sequence) || value.sequence < state.sequence) return;

      if (value.previewNavigation) applyNavigation(value.previewNavigation);
      for (const field of ['role', 'phase', 'sequence', 'locale', 'culture', 'os', 'strings', 'detached', 'handlerNavigation', 'notice', 'restore', 'title']) {
        if (value[field] !== undefined) set(field, value[field]);
      }
      if (value.model) {
        set('model', reconcile(prepare(value.model), { key: 'reconcileKey', merge: true }));
        if (!state.selected) set('selected', state.ui.selected ?? key(value.model.root));
      }
      if (value.selection) selectIdentity(value.selection);
      persist();
    });
  }
  window.addEventListener('message', receive);
  const select = node => { selectIdentity(node.identity); post({ type: 'select', identity: node.identity }); persist(); };
  const ui = (name, value) => { set('ui', name, value);if(name==='pages'||name==='collapsed')shareNavigation();persist(); };
  post({ type: 'ready', ...(Object.keys(navigation.pages).length||Object.keys(navigation.collapsed).length?{previewNavigation:navigation}:{}) });
  return { state, selection, select, ui, post, dispose: () => { window.removeEventListener('message', receive); cancelAnimationFrame(persistFrame); } };
}
