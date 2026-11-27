import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { render } from '@solidjs/web';
import { historyGraph, historyDate } from './model.mjs';
import './style.css';
const vscode = acquireVsCodeApi();
const [state, setState] = createSignal({ labels: {}, repositories: [], busy: true });
const [selected, setSelected] = createSignal(undefined);
let pendingLanes = [];
const [rows, setRows] = createSignal([]);
const chosen = createMemo(() => rows().find(row => row.commit.id === selected())?.commit);
const width = createMemo(() => rows().reduce((width, row) => Math.max(width, row.width), 1) * 14 + 10);
const label = key => state().labels[key] ?? '';
const send = (type, values = {}) => vscode.postMessage({ type, ...values });
const date = commit => historyDate(commit.authored_at.seconds).text;
window.addEventListener('message', event => {
  if (event.data?.type !== 'state') return;
  const { append, reset, ...status } = event.data;
  setState(status);
  if (reset) { pendingLanes = []; setRows([]); setSelected(undefined); }
  if (append?.length) {
    const graph = historyGraph(append, pendingLanes);
    pendingLanes = graph.lanes;
    setRows(existing => [...existing, ...graph.rows]);
  }
});
function keyboard(event, index) {
  const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rows().length - 1 : undefined;
  if (next === undefined) return;
  event.preventDefault();
  document.querySelectorAll('.history-row')[Math.max(0, Math.min(rows().length - 1, next))]?.focus();
}
function RepositorySelect() {
  let select;
  // Replacing options can reset the browser selection even when the ID is unchanged.
  // Apply the value after Solid commits both the selection and the option list.
  createEffect(() => ({ repository: state().repository, repositories: state().repositories }), value => {
    select.value = value.repository ?? '';
  });
  return <select ref={select} id="history-repository" onChange={event => send('repository', { repository: event.currentTarget.value })}>
    <For each={state().repositories}>{repository => <option value={repository.id}>{repository.label}</option>}</For>
  </select>;
}
render(() => <>
  <Show when={state().repositories.length > 1} fallback={<Show when={state().repositories.length === 1}><div class="history-repository-name">{state().repositories[0]?.label}</div></Show>}>
  <div class="history-toolbar">
    <label for="history-repository">{label('repository')}</label>
    <RepositorySelect />
  </div></Show>
  <Show when={state().error}><div class="history-error" role="alert">{state().error} <button type="button" onClick={() => send(state().more ? 'more' : 'refresh')}>{label('retry')}</button></div></Show>
  <div class="history-status" role="status" aria-live="polite">
    {state().busy ? label('loading') : !state().repositories.length ? label('noRepositories') : !rows().length && !state().error ? label('empty') : ''}
  </div>
  <div class="history-list" role="list" aria-label={label('title')} aria-busy={state().busy ? 'true' : 'false'}>
    <For each={rows()}>{(row, index) => <div role="listitem">
      <button type="button" class={`history-row ${selected() === row.commit.id ? 'selected' : ''}`} data-id={row.commit.id}
        aria-pressed={selected() === row.commit.id ? 'true' : 'false'} onClick={() => setSelected(row.commit.id)} onKeyDown={event => keyboard(event, index())}
        title={`${row.commit.subject}\n${label('author')}: ${row.commit.author.name} <${row.commit.author.email}>\n${label('date')}: ${date(row.commit)}\n${label('hash')}: ${row.commit.id}\n${label('parents')}: ${row.commit.parents.join(', ')}`}>
        <svg class="history-graph" width={width()} height="48" viewBox={`0 0 ${width()} 48`} aria-hidden="true">
          <For each={row.incoming}>{lane => <path d={`M ${lane * 14 + 10} 0 V 24`} class={`lane lane-${lane % 6}`} />}</For>
          <For each={row.edges}>{edge => <path data-parent-id={edge.parent} d={`M ${edge.from * 14 + 10} 24 C ${edge.from * 14 + 10} 36 ${edge.to * 14 + 10} 36 ${edge.to * 14 + 10} 48`} class={`lane lane-${edge.from % 6}`} />}</For>
          <circle cx={row.column * 14 + 10} cy="24" r="4" class={`node lane-${row.column % 6}`} />
        </svg>
        <span class="history-description"><span class="history-subject"><For each={row.commit.refs}>{ref => <span class={`history-ref ref-${ref.kind}`}>{ref.name}</span>}</For>{row.commit.subject}</span>
          <span class="history-meta"><span>{row.commit.author.name}</span><time dateTime={historyDate(row.commit.authored_at.seconds).iso}>{date(row.commit)}</time><code>{row.commit.id.slice(0, 8)}</code></span>
        </span>
      </button>
    </div>}</For>
  </div>
  <Show when={chosen()}>{commit => <section class="history-details" aria-label={label('commit')}>
    <strong>{commit().subject}</strong>
    <dl><dt>{label('hash')}</dt><dd><code>{commit().id}</code></dd>
    <dt>{label('author')}</dt><dd>{commit().author.name} &lt;{commit().author.email}&gt;</dd>
    <dt>{label('date')}</dt><dd>{date(commit())}</dd>
    <dt>{label('parents')}</dt><dd><For each={commit().parents}>{id => <code class="history-parent">{id}</code>}</For></dd></dl>
  </section>}</Show>
  <Show when={state().more}><button type="button" class="history-more" disabled={state().busy} onClick={() => send('more')}>{label('loadMore')}</button></Show>
</>, document.getElementById('root'));
send('ready');
