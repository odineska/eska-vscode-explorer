import { createStore, reconcile, unwrap } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { prepare, key } from './model.mjs';

/** Only UI state is persisted. Models and backend session handles are refreshed after reload. */
export function controller(api) {
  const saved = api.getState();
  const [state, set] = createStore({ role: 'main', phase: 'loading', sequence: 0, locale: 'en-US', os: 'linux', strings: {}, model: null, detached: false,
    notice: '', restore: null, selected: '', ui: { upper: 230, left: 40, right: 65, tab: 'attributes', treeTab: 'elements', folded: {}, pages: {}, collapsed: {}, zoom: 100, ...saved?.ui } });
  const [selection, setSelection] = createSignal(null);
  let persistFrame;
  const persist = () => { cancelAnimationFrame(persistFrame); persistFrame = requestAnimationFrame(() => api.setState({ schemaVersion: 1, ...unwrap(state.restore), ui: { ...unwrap(state.ui), selected: state.selected } })); };
  function receive(event) {
    const value = event.data; if (!value || typeof value !== 'object') return;
    if (value.type === 'selection') { if (value.identity) { set('selected', key({ identity: value.identity })); setSelection(value.identity); persist(); } return; }
    if (value.type !== 'state' || !Number.isSafeInteger(value.sequence) || value.sequence < state.sequence) return;
    for (const field of ['role', 'phase', 'sequence', 'locale', 'os', 'strings', 'detached', 'notice', 'restore', 'title']) if (value[field] !== undefined) set(field, value[field]);
    if (value.model) { set('model', reconcile(prepare(value.model), { key: 'key', merge: true })); if (!state.selected) set('selected', state.ui.selected ?? key(value.model.root)); }
    if (value.selection) { set('selected', key({ identity: value.selection })); setSelection(value.selection); }
    persist();
  }
  window.addEventListener('message', receive);
  const post = value => api.postMessage(value);
  const select = node => { set('selected', node.key); setSelection(node.identity); post({ type: 'select', identity: node.identity }); persist(); };
  const ui = (name, value) => { set('ui', name, value); persist(); };
  post({ type: 'ready' });
  return { state, selection, select, ui, post, dispose: () => { window.removeEventListener('message', receive); cancelAnimationFrame(persistFrame); } };
}
