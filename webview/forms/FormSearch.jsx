import { For, Show, createEffect, createMemo, createSignal, flush, onSettled } from 'solid-js';
import { InspectorIcon, InspectorIconButton } from './InspectorIcon.jsx';
import { searchForm } from './form-search.mjs';

export function FormSearch(props) {
  const c = props.controller, s = c.state.strings;
  const [open, setOpen] = createSignal(false), [active, setActive] = createSignal(0);
  const results = createMemo(() => open() ? searchForm(props.index, c.state, c.state.ui.search) : []);
  let input, resultsBox;
  const shown = () => open() && !!c.state.ui.search.trim();
  createEffect(() => {
    const { propertySearch, revision, formSessionId } = c.state;
    const query = c.state.ui.search;
    if (propertySearch && shown() && revision) return { type: 'searchProperties', query, revision, formSessionId };
  }, request => {
    if (!request) return;
    const timer = setTimeout(() => c.post(request), 120);
    return () => clearTimeout(timer);
  });
  function choose(item) {
    if (!item) return;
    if (item.kind === 'element') c.select(item.row.node, true);
    else c.revealData(item.row);
    if (item.property) c.revealProperty(item.property);
    setOpen(false);
  }
  function clear() {
    c.ui('search', '');
    setOpen(false);
    input.focus();
  }
  function keydown(event) {
    if (event.key === 'Escape' && shown()) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Enter' && shown()) {
      event.preventDefault();
      choose(results()[active()]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open()) {
        setOpen(true);
        flush();
      }
      if (!results().length) return;
      event.preventDefault();
      const next = (active() + results().length + (event.key === 'ArrowDown' ? 1 : -1)) % results().length;
      setActive(next);
      onSettled(() => { resultsBox?.children[next]?.scrollIntoView({ block: 'nearest' }); });
    }
  }
  const resultId = index => 'form-search-result-' + index;
  return <div class="form-global-search">
    <div class="form-inspector-search"><InspectorIcon name="search"/>
      <input ref={input} type="search" role="combobox" aria-autocomplete="list" aria-expanded={String(shown())}
        aria-controls="form-search-results" aria-activedescendant={shown() && results()[active()] ? resultId(active()) : undefined}
        aria-label={s.inspectorSearch} placeholder={s.inspectorSearch} value={c.state.ui.search} maxlength="512"
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onInput={event => { c.ui('search', event.currentTarget.value); setActive(0); setOpen(true); }} onKeyDown={keydown}/>
      <Show when={c.state.ui.search}><InspectorIconButton icon="clear" label={s.clearSearch} onClick={clear}/></Show>
    </div>
    <div hidden={!shown()} class="form-search-results" id="form-search-results" role="listbox" aria-label={s.editSearchResults}
      ref={resultsBox}>
      <For each={results()} fallback={<span class="form-list-empty">{s.noMatches}</span>}>{(item, index) =>
        <div id={resultId(index())} role="option" data-result-property={item.property}
          data-result-key={item.kind === 'element' ? item.row.key : item.row.id} aria-selected={String(active() === index())}
          onPointerDown={event => event.preventDefault()}
          onClick={() => choose(item)}>
          <span class="form-truncate"><small>{s[item.property ? 'properties' : item.kind === 'element' ? 'elements' : item.kind]}</small>{item.title}</span>
          <span class="form-truncate" title={item.context}>{item.context}</span>
        </div>}
      </For>
    </div>
  </div>;
}
