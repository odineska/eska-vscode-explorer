import { batch, createComputed, onCleanup, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { tableLayout } from './table-model.mjs';

function keepItems(previous, next) {
  return previous && previous.length === next.length && next.every((item, index) => previous[index] === item)
    ? previous : next;
}

function identity(model) { return `${model.node.kind}:${model.node.key}`; }

function update(cache, key, value) {
  let entry = cache.get(key);
  if (!entry) {
    const [state, set] = createStore(value);
    entry = { state, set };
    cache.set(key, entry);
  } else {
    // Shallow assignment keeps node/field references in the controller's store.
    // Deep reconciliation here could mutate a source node that was replaced.
    entry.set(value);
  }
  return entry.state;
}

function prune(cache, active) {
  for (const key of cache.keys()) if (!active.has(key)) cache.delete(key);
}

/** Preserve keyed header/column owners while publishing the existing geometry atomically. */
export function createTableLayout(table, locale) {
  const headers = new Map(), columns = new Map();
  const [layout, setLayout] = createStore({});
  createComputed(() => {
    const next = tableLayout(table(), locale());
    untrack(() => batch(() => {
      const activeHeaders = new Set(), activeColumns = new Set();
      function projectColumn(value) {
        const key = identity(value);
        if (activeColumns.has(key)) return columns.get(key).state;
        activeColumns.add(key);
        const previous = columns.get(key)?.state;
        return update(columns, key, { ...value, fields: keepItems(previous?.fields, value.fields) });
      }
      function projectHeader(value) {
        const key = identity(value), previous = headers.get(key)?.state;
        activeHeaders.add(key);
        const children = keepItems(previous?.children, value.children.map(projectHeader));
        const physical = keepItems(previous?.columns, value.columns.map(projectColumn));
        return update(headers, key, { ...value, children, columns: physical });
      }
      const children = keepItems(layout.children, next.children.map(projectHeader));
      const physical = keepItems(layout.columns, next.columns.map(projectColumn));
      setLayout({ ...next, children, columns: physical });
      prune(headers, activeHeaders);
      prune(columns, activeColumns);
    }));
  });
  onCleanup(() => { headers.clear(); columns.clear(); });
  return () => layout;
}
