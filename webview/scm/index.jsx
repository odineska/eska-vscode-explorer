import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';
import { Button, Toolbar } from '../ui/controls.jsx';
import { iconPaths } from '../ui/icons.mjs';
import { acknowledgeDraft, acknowledgeInput, reconcilePendingCommits, selectRow } from './model.mjs';
import './style.css';

const vscode = acquireVsCodeApi();
const saved = vscode.getState() ?? {};
const [state, setState] = createStore({ revision: 0, labels: {}, repositories: [], busy: false });
const [drafts, setDrafts] = createSignal(new Map());
const [pending, setPending] = createSignal(new Map());
const [selection, setSelection] = createSignal({ keys: saved.selection ?? [], anchor: saved.anchor });
const [collapsed, setCollapsed] = createSignal(saved.collapsed ?? {});
const [activeRow, setActiveRow] = createSignal(saved.activeRow);
const rowsByKey = new Map();
const selectedKeys = createMemo(() => new Set(selection().keys));

const paths = {
  ...iconPaths,
  remove: ['M3 8h10'],
  close: iconPaths.remove,
  repo: ['M3 2h10v10H4a1 1 0 0 0 0 2h9M3 2v11M6 5h4'],
  check: ['M3 8l3 3 7-7'],
  discard: ['M2 7h5M2 7V2m0 5a6 6 0 1 1 2 6'],
  diff: ['M4 2h6l3 3v9H4zM10 2v4h3M6 8h4M6 11h4'],
  file: ['M4 2h6l3 3v9H4zM10 2v4h3'],
  'compare-changes': ['M2 2h5v12H2zM9 2h5v12H9zM4 6h1m6 0h1M4 10h1m6 0h1'],
  'diff-multiple': ['M3 11H2V2h7v1m-5 1h7l2 2v8H4zM11 4v3h2M6 9h4m-2-2v4m-2 1h4'],
  refresh: ['M13 6a5.5 5.5 0 1 0 0 4M13 2v4H9'],
  ellipsis: ['M3 8h1m3.5 0h1m3.5 0h1'],
  branch: ['M4 5v6m7-6v1a4 4 0 0 1-4 4H4M2 3a2 2 0 1 1 4 0 2 2 0 0 1-4 0m7 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0M2 13a2 2 0 1 1 4 0 2 2 0 0 1-4 0']
};
const aliases = { 'arrow-up': 'up', 'arrow-down': 'down', 'git-commit': 'check',
  'git-branch': 'branch', 'chevron-right': 'right', 'chevron-down': 'down',
  'go-to-file': 'file', 'file-code': 'file', plus: 'add', minus: 'remove' };

function Icon(props) {
  const name = () => props.name?.replace(/^\$\(([^)]+)\)$/, '$1') ?? 'ellipsis';
  return <svg class="scm-icon" viewBox="0 0 16 16" aria-hidden="true">
    <For each={paths[aliases[name()] ?? name()] ?? paths.ellipsis}>{d => <path d={d} />}</For>
  </svg>;
}

function persist() {
  vscode.setState({ selection: selection().keys, anchor: selection().anchor, collapsed: collapsed(), activeRow: activeRow() });
}

const visibleRows = createMemo(() => {
  return state.repositories.flatMap(repository => repository.groups.flatMap(group =>
    collapsed()[group.key] ? [] : group.rows.map(row => row.key)));
});

const tabbableRow = createMemo(() => visibleRows().includes(activeRow()) ? activeRow() : visibleRows()[0]);

function select(key, event) {
  setSelection(selectRow(selection().keys, selection().anchor, key, visibleRows(), {
    toggle: event.ctrlKey || event.metaKey,
    range: event.shiftKey
  }));
  setActiveRow(key);
  persist();
}

function context(data, rowKey) {
  const keys = selection().keys;
  return JSON.stringify({
    ...data,
    eskaScmSelection: rowKey && !selectedKeys().has(rowKey) ? [rowKey] : keys,
    eskaScmRevision: state.revision,
    preventDefaultContextMenuItems: true
  });
}

function action(key, id) {
  vscode.postMessage({ type: 'action', key, action: id, revision: state.revision, selection: selection().keys });
}

function ActionButtons(props) {
  return <Show when={props.actions.length}>
    <Toolbar label={props.label} class="scm-actions">
      <For each={props.actions}>{item =>
        <Button quiet class="scm-icon-button" title={item.title} aria-label={item.title}
          disabled={props.disabled} tabIndex={props.tabIndex} onClick={() => props.run(item.id)}>
          <Icon name={item.icon} />
        </Button>
      }</For>
    </Toolbar>
  </Show>;
}

function editMessage(repository, value) {
  const current = drafts().get(repository);
  const draft = { repositoryToken: current.repositoryToken, editId: current.editId + 1, value };
  setDrafts(new Map(drafts()).set(repository, draft));
  vscode.postMessage({ type: 'message', repository, ...draft });
}

function Repository(props) {
  const repo = () => props.repository;
  const disabled = () => state.busy || repo().busy || pending().has(repo().key);
  const draft = () => drafts().get(repo().key);
  let input;
  // Avoid resetting the caret when the host echoes the current draft.
  createEffect(() => {
    const value = draft()?.value ?? '';
    if (input.value !== value) input.value = value;
  });

  function commit() {
    if (disabled()) return;
    const { key, repositoryToken, acknowledgedCommitId } = repo();
    const { editId, value } = draft();
    const commitId = acknowledgedCommitId + 1;
    const revision = state.revision;
    setPending(new Map(pending()).set(key, { repositoryToken, commitId }));
    vscode.postMessage({ type: 'commit', repository: key, repositoryToken, editId, value, commitId, revision });
  }

  return <section class="scm-repository" aria-label={repo().label} data-vscode-context={context(repo().context)}>
    <header class="scm-heading scm-repo-heading" title={repo().description}>
      <Icon name="repo" /><span class="scm-label">{repo().label}</span>
      <Show when={repo().branch}>
        <span class="scm-branch" title={repo().branch}><Icon name="branch" /><span>{repo().branch}</span></span>
      </Show>
      <ActionButtons actions={repo().actions} label={repo().label} disabled={disabled()}
        run={id => action(repo().key, id)} />
    </header>
    <div class="scm-editor">
      <textarea ref={input} rows="2" aria-label={state.labels.message} placeholder={state.labels.message}
        disabled={disabled()} onInput={event => editMessage(repo().key, event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
            event.preventDefault();
            commit();
          }
        }} />
      <Button primary class="scm-commit" aria-keyshortcuts="Control+Enter Meta+Enter" disabled={disabled()} onClick={commit}>
        <Icon name="check" />{state.labels.commit}
      </Button>
    </div>
    <Show when={repo().groups.some(group => group.rows.length)} fallback={<div class="scm-empty">{state.labels.noChanges}</div>}>
      <For each={repo().groups}>{group => <Group group={group} disabled={disabled()} />}</For>
    </Show>
  </section>;
}

function Group(props) {
  const group = () => props.group;
  const folded = () => Boolean(collapsed()[group().key]);
  const toggle = () => {
    setCollapsed({ ...collapsed(), [group().key]: !folded() });
    persist();
  };
  return <section class="scm-group" aria-label={group().label} data-vscode-context={context(group().context)}>
    <div class="scm-heading scm-group-heading">
      <Button quiet class="scm-toggle" aria-expanded={!folded()} title={folded() ? state.labels.expand : state.labels.collapse} onClick={toggle}>
        <span classList={{ 'scm-chevron-open': !folded() }}><Icon name="right" /></span>
        <span class="scm-label">{group().label}</span>
      </Button>
      <ActionButtons actions={group().actions} label={group().label} disabled={props.disabled}
        run={id => action(group().key, id)} />
      <span class="scm-count">{group().rows.length}</span>
    </div>
    <Show when={!folded()}>
      <ul class="scm-rows" aria-label={group().label}>
        <For each={group().rows}>{row => <Row row={row} disabled={props.disabled} />}</For>
      </ul>
    </Show>
  </section>;
}

function Row(props) {
  const row = () => props.row;
  const key = () => row().key;
  const selected = () => selectedKeys().has(key());
  onCleanup(() => rowsByKey.delete(key()));

  function open() {
    if (!props.disabled) action(key(), 'openChange');
  }

  function handleKey(event) {
    const visible = visibleRows();
    const index = visible.indexOf(key());
    const next = {
      ArrowUp: visible[index - 1], ArrowDown: visible[index + 1],
      Home: visible[0], End: visible.at(-1)
    }[event.key];
    if (next) {
      event.preventDefault();
      if (event.shiftKey || !(event.ctrlKey || event.metaKey)) select(next, event);
      rowsByKey.get(next)?.focus();
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (!selected()) select(key(), event);
      open();
    } else if (event.key === ' ') {
      event.preventDefault();
      select(key(), event);
    }
  }

  function selectForMenu() {
    if (!selected()) select(key(), {});
  }

  return <li class="scm-row" classList={{ 'scm-selected': selected() }}
    data-vscode-context={context(row().context, key())}
    onPointerDown={event => { if (event.button === 2) selectForMenu(); }}
    onContextMenu={selectForMenu}>
    <Button quiet class="scm-row-target" ref={element => rowsByKey.set(key(), element)}
      tabIndex={tabbableRow() === key() ? 0 : -1}
      title={row().title} aria-pressed={selected()} aria-disabled={props.disabled}
      onFocus={() => { setActiveRow(key()); persist(); }} onKeyDown={handleKey}
      onClick={event => {
        select(key(), event);
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) open();
      }}>
      <Icon name="file" />
      <span class="scm-label">{row().label}</span>
      <span class="scm-description">{row().description}</span>
    </Button>
    <ActionButtons actions={row().actions} label={row().label} disabled={props.disabled}
      tabIndex={tabbableRow() === key() ? 0 : -1}
      run={id => {
        if (!selected()) select(key(), {});
        action(key(), id);
      }} />
    <Show when={row().statusLetter}>
      <span class="scm-status" style={{ color: row().color }}>{row().statusLetter}</span>
    </Show>
  </li>;
}

function App() {
  return <>
    <Show when={state.notice}><div role="status" class="scm-notice">{state.notice}</div></Show>
    <Show when={state.labels.repository && !state.repositories.length}>
      <div class="scm-empty">{state.labels.noChanges}</div>
    </Show>
    <For each={state.repositories}>{repository => <Repository repository={repository} />}</For>
  </>;
}

window.addEventListener('message', event => {
  const snapshot = event.data;
  if (snapshot?.type === 'input') {
    const draft = drafts().get(snapshot.repository);
    const updated = acknowledgeInput(draft, snapshot);
    if (updated !== draft) setDrafts(new Map(drafts()).set(snapshot.repository, updated));
    return;
  }
  if (snapshot?.type !== 'snapshot' || snapshot.revision < state.revision) return;
  const keys = new Set(snapshot.repositories.flatMap(repo => repo.groups.flatMap(group => group.rows.map(row => row.key))));
  batch(() => {
    setDrafts(new Map(snapshot.repositories.map(repo => [repo.key, acknowledgeDraft(drafts().get(repo.key), repo)])));
    setSelection({ keys: selection().keys.filter(key => keys.has(key)), anchor: selection().anchor });
    setPending(reconcilePendingCommits(pending(), snapshot.repositories));
    setState(reconcile(snapshot, { key: 'key' }));
  });
});
render(App, document.getElementById('root'));
vscode.postMessage({ type: 'ready' });
