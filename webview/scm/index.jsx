import { createEffect, createMemo, createSignal, createStore, flush, For, onSettled, reconcile, Show } from 'solid-js';
import { render } from '@solidjs/web';
import { Button, Toolbar } from '../ui/controls.jsx';
import { iconPaths } from '../ui/icons.mjs';
import { acknowledgeDraft, acknowledgeInput, reconcilePendingCommits, groupCount, rowWindow, positionRange, positionSelected, togglePosition, selectRow, SCM_ROW_HEIGHT } from './model.mjs';
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
const groupElements = new Map();
const [ranges, setRanges] = createSignal([]);
const [anchorPosition, setAnchorPosition] = createSignal(undefined);
const [activePosition, setActivePosition] = createSignal(undefined);
const [viewport, setViewport] = createSignal({ top: saved.scrollTop ?? 0, height: window.innerHeight });
const [pages, setPages] = createSignal(new Map());
const requests = new Set();
const pageSize = 128;
let pendingFocus;
let restoreScroll = saved.scrollTop;
function updateViewport() { setViewport({ top: window.scrollY, height: window.innerHeight }); }
let scrollFrame;
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = undefined; updateViewport(); persist(); });
}, { passive: true });
document.documentElement.style.setProperty('--scm-row-height', `${SCM_ROW_HEIGHT}px`);
window.addEventListener('resize', updateViewport);
const groups = createMemo(() => state.repositories.flatMap(repo => repo.groups));
const expandedGroups = createMemo(() => groups().filter(group => !collapsed()[group.key] && groupCount(group)));
const smallList = createMemo(() => expandedGroups().reduce((count, group) => count + groupCount(group), 0) <= 200);
function positionKey(position) { return `${position.group}:${position.index}`; }
function rowAt(group, index) {
  return group.rows?.[index] ?? pages().get(`${group.key}:${Math.floor(index / pageSize) * pageSize}`)?.[index % pageSize];
}
const tabPosition = createMemo(() => {
  const view = viewport();
  const visible = expandedGroups();
  const active = activePosition();
  if (active) {
    const group = visible.find(item => item.key === active.group);
    const list = groupElements.get(active.group);
    const top = (list?.getBoundingClientRect().top ?? -Infinity) + active.index * SCM_ROW_HEIGHT;
    if (group && rowAt(group, active.index) && top + SCM_ROW_HEIGHT > 0 && top < view.height) return positionKey(active);
  }
  for (const group of visible) {
    const list = groupElements.get(group.key);
    if (!list) continue;
    const top = list.getBoundingClientRect().top;
    if (top >= view.height || top + groupCount(group) * SCM_ROW_HEIGHT <= 0) continue;
    const index = Math.max(0, Math.min(groupCount(group) - 1, Math.floor(-top / SCM_ROW_HEIGHT)));
    if (rowAt(group, index)) return positionKey({ group: group.key, index });
  }
  // Tab can scroll a row into view even when a narrow SCM pane shows only its commit box.
  const first = visible[0];
  return first && rowAt(first, 0) ? positionKey({ group: first.key, index: 0 }) : undefined;
});
function selectedWire() {
  return { selection: selection().keys, selectionRanges: ranges() };
}
function focusPosition(position) {
  setActivePosition(position);
  pendingFocus = positionKey(position);
  const list = groupElements.get(position.group);
  if (list) {
    const top = list.getBoundingClientRect().top + window.scrollY + position.index * SCM_ROW_HEIGHT;
    if (top < window.scrollY) window.scrollTo(0, top);
    else if (top + SCM_ROW_HEIGHT > window.scrollY + window.innerHeight) window.scrollTo(0, top + SCM_ROW_HEIGHT - window.innerHeight);
  }
  updateViewport();
  flush();
  const target = rowsByKey.get(pendingFocus);
  if (target) { target.focus(); pendingFocus = undefined; }
}
function selectPosition(position, event = {}) {
  const toggle = event.ctrlKey || event.metaKey;
  const group = groups().find(item => item.key === position.group);
  const row = group && rowAt(group, position.index);
  const eager = expandedGroups().every(item => item.rows?.length === groupCount(item));
  if (eager && row) {
    const visible = expandedGroups().flatMap(item => item.rows.map(entry => entry.key));
    setSelection(selectRow(selection().keys, selection().anchor, row.key, visible, { toggle, range: event.shiftKey }));
    setRanges([]);
  } else if (event.shiftKey) {
    const interval = positionRange(expandedGroups(), anchorPosition(), position);
    setRanges(toggle ? [...ranges(), ...interval] : interval);
    if (!toggle) setSelection({ keys: [], anchor: undefined });
  } else {
    const inRange = positionSelected(ranges(), position);
    setRanges(toggle ? (inRange ? togglePosition(ranges(), position) : ranges()) : []);
    if (row) {
      const keys = selection().keys;
      setSelection({ keys: toggle ? (keys.includes(row.key) || inRange ? keys.filter(key => key !== row.key) : [...keys, row.key]) : [row.key], anchor: row.key });
    } else {
      const single = { group: position.group, start: position.index, end: position.index };
      setRanges(toggle ? togglePosition(ranges(), position) : [single]);
      if (!toggle) setSelection({ keys: [], anchor: undefined });
    }
  }
  if (!event.shiftKey) setAnchorPosition(position);
  setActivePosition(position);
  persist();
}
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
  sync: ['M13 5a5 5 0 0 0-9-1L2 6m0-4v4h4m-3 5a5 5 0 0 0 9 1l2-2m0 4v-4h-4'],
  'cloud-upload': ['M4 12H3a2.5 2.5 0 1 1 .4-5 4.5 4.5 0 0 1 8.8.4A2.4 2.4 0 0 1 12 12h-1M8 14V8m-2 2 2-2 2 2'],
  sparkle: ['M7 2c0 3-2 5-5 5 3 0 5 2 5 5 0-3 2-5 5-5-3 0-5-2-5-5M12.5 9v5M10 11.5h5'],
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
  // Menu actions in the same event also read this newly selected row.
  flush();
  vscode.setState({ selection: selection().keys, anchor: selection().anchor, collapsed: collapsed(), activeRow: activeRow(), scrollTop: window.scrollY });
}

function context(data, rowKey) {
  const keys = selection().keys;
  return JSON.stringify({
    ...data,
    eskaScmSelection: rowKey && !selectedKeys().has(rowKey) && !ranges().length ? [rowKey] : keys,
    eskaScmSelectionRanges: ranges(),
    eskaScmRevision: state.revision,
    preventDefaultContextMenuItems: true
  });
}

function action(key, id) {
  vscode.postMessage({ type: 'action', key, action: id, revision: state.revision, ...selectedWire() });
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
  createEffect(() => draft()?.value ?? '', value => {
    if (input.value !== value) input.value = value;
  });

  function toolbar(actionId) {
    if (disabled()) return;
    const { key, repositoryToken } = repo();
    if (actionId === 'refresh') { action(key, actionId); return; }
    vscode.postMessage({ type: 'toolbar', repository: key, repositoryToken, action: actionId });
  }

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
        <Show when={repo().canCheckout} fallback={<span class="scm-branch" title={repo().branch}>
          <Icon name="branch" /><span>{repo().branch}</span>
        </span>}>
          <Button quiet class="scm-branch" title={state.labels.checkout} disabled={disabled()} onClick={() => toolbar('git.checkout')}>
            <Icon name="branch" /><span>{repo().branch}</span>
          </Button>
        </Show>
      </Show>
      <ActionButtons actions={repo().hasMenu ? [...repo().actions, { id: 'menu', title: state.labels.repositoryActions, icon: 'ellipsis' }] : repo().actions}
        label={state.labels.repositoryActions} disabled={disabled()} run={toolbar} />
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
      <Button primary class="scm-commit" title={state.labels.commitHint} aria-keyshortcuts="Control+Enter Meta+Enter" disabled={disabled()} onClick={commit}>
        <Icon name="check" />{state.labels.commit}
      </Button>
    </div>
    <Show when={repo().groups.some(group => groupCount(group))} fallback={<div class="scm-empty">{state.labels.noChanges}</div>}>
      <For each={repo().groups}>{group => <Group group={group} disabled={disabled()} />}</For>
    </Show>
  </section>;
}

function Group(props) {
  const group = () => props.group;
  const folded = () => Boolean(collapsed()[group().key]);
  let list;
  const [offset, setOffset] = createSignal(0);
  const measure = () => { if (list) setOffset(list.getBoundingClientRect().top + window.scrollY); };
  const observer = new ResizeObserver(() => { measure(); updateViewport(); });
  onSettled(() => {
    observer.observe(document.body);
    measure();
    return () => { observer.disconnect(); groupElements.delete(group().key); };
  });
  const windowRows = createMemo(() => {
    const view = viewport();
    const count = folded() ? 0 : groupCount(group());
    if (smallList()) return { start: 0, end: count };
    if (!list || !count) return { start: 0, end: Math.min(count, 40) };
    const window = rowWindow(count, view.top - offset(), view.height);
    if (window.start === window.end && expandedGroups()[0]?.key === group().key) return { start: 0, end: 1 };
    return window;
  });
  createEffect(() => ({ window: windowRows(), folded: folded(), group: group(), revision: state.revision, pages: pages() }), value => {
    const { start, end } = value.window;
    if (value.folded || value.group.rows?.length === groupCount(value.group)) return;
    for (let index = Math.floor(start / pageSize) * pageSize; index < end; index += pageSize) {
      const key = `${value.group.key}:${index}`;
      if (value.pages.has(key) || requests.has(key)) continue;
      requests.add(key);
      vscode.postMessage({ type: 'rows', revision: value.revision, group: value.group.key, start: index, count: pageSize });
    }
  });
  const toggle = () => {
    setCollapsed({ ...collapsed(), [group().key]: !folded() });
    flush(); measure(); updateViewport(); persist();
  };
  return <section class="scm-group" aria-label={group().label} data-vscode-context={context(group().context)}>
    <div class="scm-heading scm-group-heading">
      <Button quiet class="scm-toggle" aria-expanded={String(!folded())} title={folded() ? state.labels.expand : state.labels.collapse} onClick={toggle}>
        <span class={folded() ? '' : 'scm-chevron-open'}><Icon name="right" /></span>
        <span class="scm-label">{group().label}</span>
      </Button>
      <ActionButtons actions={group().actions} label={group().label} disabled={props.disabled} run={id => action(group().key, id)} />
      <span class="scm-count">{groupCount(group())}</span>
    </div>
    <Show when={!folded()}>
      <ul class="scm-rows" aria-label={group().label} ref={element => { list = element; groupElements.set(group().key, element); }} style={{ height: `${groupCount(group()) * SCM_ROW_HEIGHT}px` }}>
        <For each={Array.from({ length: windowRows().end - windowRows().start }, (_, i) => windowRows().start + i)}>{index =>
          <Show when={rowAt(group(), index)} fallback={<li class="scm-row scm-loading" aria-hidden="true" style={{ top: `${index * SCM_ROW_HEIGHT}px` }} />}>
            <Row row={rowAt(group(), index)} position={{ group: group().key, index }} count={groupCount(group())} disabled={props.disabled} />
          </Show>
        }</For>
      </ul>
    </Show>
  </section>;
}

function Row(props) {
  const row = () => props.row;
  const key = () => row().key;
  const position = () => props.position;
  const selected = () => positionSelected(ranges(), position()) || selectedKeys().has(key());
  const tabbable = () => tabPosition() === positionKey(position());
  onSettled(() => {
    const rowKey = positionKey(position());
    if (pendingFocus === rowKey) { rowsByKey.get(rowKey)?.focus(); pendingFocus = undefined; }
    return () => rowsByKey.delete(rowKey);
  });

  function open() {
    if (!props.disabled) action(key(), 'openChange');
  }

  function handleKey(event) {
    const visible = expandedGroups();
    const groupIndex = visible.findIndex(group => group.key === position().group);
    const index = position().index;
    let next;
    if (event.key === 'Home' && visible.length) next = { group: visible[0].key, index: 0 };
    if (event.key === 'End' && visible.length) next = { group: visible.at(-1).key, index: groupCount(visible.at(-1)) - 1 };
    if (event.key === 'ArrowUp') next = index > 0 ? { ...position(), index: index - 1 } : groupIndex > 0 ? { group: visible[groupIndex - 1].key, index: groupCount(visible[groupIndex - 1]) - 1 } : undefined;
    if (event.key === 'ArrowDown') next = index + 1 < groupCount(visible[groupIndex]) ? { ...position(), index: index + 1 } : groupIndex + 1 < visible.length ? { group: visible[groupIndex + 1].key, index: 0 } : undefined;
    if (next) {
      event.preventDefault();
      if (event.shiftKey || !(event.ctrlKey || event.metaKey)) selectPosition(next, event);
      focusPosition(next);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (!selected()) selectPosition(position(), event);
      open();
    } else if (event.key === ' ') {
      event.preventDefault();
      selectPosition(position(), event);
    }
  }

  function selectForMenu() {
    if (!selected()) selectPosition(position(), {});
  }

  return <li class={selected() ? "scm-row scm-selected" : "scm-row"}
    style={{ top: `${position().index * SCM_ROW_HEIGHT}px` }} aria-setsize={props.count} aria-posinset={position().index + 1}
    data-vscode-context={context(row().context, key())}
    onPointerDown={event => { if (event.button === 2) selectForMenu(); }}
    onContextMenu={selectForMenu}>
    <Button quiet class="scm-row-target" ref={element => rowsByKey.set(positionKey(position()), element)}
      tabIndex={tabbable() ? 0 : -1}
      title={row().title} aria-pressed={String(selected())} aria-disabled={props.disabled?.toString()}
      onFocus={() => { setActiveRow(key()); setActivePosition(position()); persist(); }} onKeyDown={handleKey}
      onClick={event => {
        selectPosition(position(), event);
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) open();
      }}>
      <Icon name="file" />
      <span class="scm-label">{row().label}</span>
      <span class="scm-description">{row().description}</span>
    </Button>
    <ActionButtons actions={row().actions} label={row().label} disabled={props.disabled}
      tabIndex={tabbable() ? 0 : -1}
      run={id => {
        if (!selected()) selectPosition(position(), {});
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
  if (snapshot?.type === 'rows') {
    if (snapshot.revision !== state.revision) return;
    const key = `${snapshot.group}:${snapshot.start}`;
    requests.delete(key);
    const next = new Map(pages());
    next.set(key, snapshot.rows);
    if (next.size > 24) next.delete(next.keys().next().value);
    setPages(next);
    return;
  }
  if (snapshot?.type === 'input') {
    const draft = drafts().get(snapshot.repository);
    const updated = acknowledgeInput(draft, snapshot);
    if (updated !== draft) setDrafts(new Map(drafts()).set(snapshot.repository, updated));
    return;
  }
  if (snapshot?.type !== 'snapshot' || snapshot.revision < state.revision) return;
  const keys = new Set(snapshot.repositories.flatMap(repo => repo.groups.flatMap(group => (group.rows ?? []).map(row => row.key))));
  if (snapshot.revision !== state.revision) {
    requests.clear();
    setPages(new Map());
    setRanges([]);
    setAnchorPosition(undefined);
    setActivePosition(undefined);
    pendingFocus = undefined;
  }
  setDrafts(new Map(snapshot.repositories.map(repo => [repo.key, acknowledgeDraft(drafts().get(repo.key), repo)])));
  // Paged keys are validated by the host against the exact revision on use.
  const hasPagedGroups = snapshot.repositories.some(repo => repo.groups.some(group => !group.rows));
  setSelection({ keys: hasPagedGroups ? selection().keys : selection().keys.filter(key => keys.has(key)), anchor: keys.has(selection().anchor) ? selection().anchor : undefined });
  setPending(reconcilePendingCommits(pending(), snapshot.repositories));
  setState(draft => { reconcile(snapshot, 'key')(draft); });
  if (!activePosition() && activeRow()) {
    for (const repo of snapshot.repositories) {
      for (const group of repo.groups) {
        const index = group.rows?.findIndex(row => row.key === activeRow()) ?? -1;
        if (index >= 0) setActivePosition({ group: group.key, index });
      }
    }
  }
  requestAnimationFrame(() => {
    if (restoreScroll !== undefined) { window.scrollTo(0, restoreScroll); restoreScroll = undefined; }
    updateViewport();
  });
});
render(App, document.getElementById('root'));
vscode.postMessage({ type: 'ready' });
