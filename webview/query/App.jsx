import { createEffect, createMemo, For, onCleanup, Show, untrack } from 'solid-js';
import { Button, Toolbar } from '../ui/controls.jsx';

/** Rust supplies every statement, capability and selection; this frame stores presentation only. */
export function ConstructorApp(props) {
  const view = props.view, controller = props.controller;
  const labels = () => view()?.state.labels ?? {};
  const locked = () => !view() || view().state.busy || view().state.paused;
  const child = () => !!view()?.child;
  const label = page => page === 'index' ? labels().indexes : page === 'text' ? labels().text : labels()[page];
  const activate = page => { if (!locked() && !child()) controller.activate(page); };
  const position = () => view()?.pages.indexOf(view().page) ?? 0;
  let preview, text, fullText, lastPaint, mounted;

  // Existing checked editor widgets are leaf components. A busy publication never destroys their inputs.
  const panes = createMemo(previous => {
    const current = view();
    if (!current || current.state.busy) return previous;
    if (previous?.key === current.bodyKey) return previous;
    if (!previous || mounted === previous.key) controller.layout.capture();
    return { key: current.bodyKey, nodes: untrack(() => controller.panes()) };
  });
  const scope = () => view()?.state.model.scopes?.[view().scope?.scope];
  const statements = () => {
    const state = view()?.state;
    return state?.model.scopes ? state.model.scopes.filter(s => s.parent === null).map(s => state.model.statements[s.branches[0]]) : state?.model.statements ?? [];
  };
  const navigate = value => { if (!locked() && !child()) controller.navigate(Number(value)); };

  function locate(node) {
    const selection = window.getSelection();
    if (!node || !selection?.focusNode || !node.contains(selection.focusNode)) return;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(selection.focusNode, selection.focusOffset);
    controller.post({type:'locate', target:{kind:'offset',offset:range.cloneContents().textContent.length},navigate:true});
  }

  const fragments = createMemo(() => view()?.state.features.linkedText ? (view().state.model.statements ?? []).flatMap(owner => owner.clauses.flatMap(clause => clause.items.map(item => ({
    selection:{statement:owner.index,clause:clause.index,item:item.index},range:item.range
  })))).sort((a,b) => a.range.start-b.range.start) : []);

  /** Navigation follows core ranges and identities, without inspecting query tokens. */
  function TextNavigation(props) {
    const move = direction => {
      const items=fragments(), at=items.findIndex(item => item.range.start === view().state.location?.range.start);
      const index=at<0 ? direction<0 ? items.length-1 : 0 : (at+direction+items.length)%items.length;
      controller.post({type:'locate',target:{kind:'item',selection:items[index].selection},navigate:true});
    };
    return <Show when={view().state.features.linkedText}><Toolbar class="text-navigation" label={labels().textTools}>
      <Button quiet class="locate-query-text" disabled={locked() || child()} onMouseDown={event => event.preventDefault()} onClick={() => locate(props.target())}>{labels().findInModel}</Button>
      <Button quiet class="text-fragment" disabled={locked() || child() || !fragments().length} onClick={() => move(-1)}>{labels().previousFragment}</Button>
      <Button quiet class="text-fragment" disabled={locked() || child() || !fragments().length} onClick={() => move(1)}>{labels().nextFragment}</Button>
    </Toolbar></Show>;
  }

  createEffect(() => {
    const current = view(), body = panes();
    if (!current) return;
    const paint = `${current.state.model.revision}:${current.state.location?.serial ?? ''}`;
    if (paint !== lastPaint) {
      if (text) controller.paintText(text);
      if (fullText) controller.paintText(fullText);
      lastPaint = paint;
    }
    queueMicrotask(() => {
      if (view() !== current) return;
      if (!current.state.busy) controller.overlays();
      else for (const dialog of document.querySelectorAll('#root > :not(.constructor-shell)')) dialog.inert = true;
      if (body && mounted !== body.key) { controller.layout.mount(current.selected, current.page, current.state.labels); mounted = body.key; }
      if (preview && current.page === 'text') preview.hidden = true;
      else if (preview) preview.hidden = false;
    });
  });
  onCleanup(() => controller.dispose());

  return <div class="constructor-shell" onKeyDown={event => {
    if (child() || locked()) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault(); if (!view().state.model.issues?.length && view().state.model.writable) controller.post({type:'apply'});
    }
  }}>
    <Show when={view()}>
      <nav class="tabs classic-tabs" role="tablist" aria-label={labels().sections}>
        <For each={view().pages}>{page => <Button role="tab" id={`tab-${page}`} aria-controls="query-page"
          aria-selected={view().page === page} tabIndex={view().page === page ? 0 : -1} disabled={locked() || child()}
          onClick={() => activate(page)} onKeyDown={event => {
            const index = view().pages.indexOf(page), count = view().pages.length;
            const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
            if (next >= 0) { event.preventDefault(); activate(view().pages[next]); queueMicrotask(() => document.getElementById(`tab-${view().page}`)?.focus()); }
          }}>{label(page)}</Button>}</For>
      </nav>
      <Show when={statements().length > 1 || scope()?.parent != null || scope()?.branches.length > 1}><div class="constructor-context">
        <Show when={scope()?.parent != null} fallback={<label>{labels().statement}
          <select aria-label={labels().statement} disabled={locked() || child()} value={String(scope()?.branches[0] ?? view().selected)} onChange={event => navigate(event.currentTarget.value)}>
            <For each={statements()}>{statement => <option value={String(statement.index)} selected={statement.index === (scope()?.branches[0] ?? view().selected)}>{`${labels().statement} ${statement.index + 1}`}</option>}</For>
          </select>
        </label>}><Button class="back-parent" disabled={locked() || child()} onClick={() => navigate(scope().parent)}>{labels().backParent}</Button></Show>
        <Show when={scope()?.branches.length > 1}><label>{labels().branch}
          <select aria-label={labels().branch} disabled={locked() || child()} value={String(view().selected)} onChange={event => navigate(event.currentTarget.value)}>
            <For each={scope().branches}>{(id,index) => <option value={String(id)} selected={id === view().selected}>{`${labels().branch} ${index() + 1}`}</option>}</For>
          </select>
        </label></Show>
      </div></Show>
      <Show when={view().state.features.packageTree && view().scope?.path?.length > 1}><nav class="scope-path" aria-label={labels().scopePath}>
        <For each={view().scope.path}>{id => <Button quiet class="scope-crumb" disabled={locked() || child() || id === view().selected} onClick={() => navigate(id)}>{view().state.model.statements[id].preview.slice(0,24)}</Button>}</For>
      </nav></Show>
      <Show when={view().error}><div class="error constructor-error" role="alert">{view().error}<Button quiet onClick={() => controller.clearError()}>{labels().close}</Button></div></Show>
      <Show when={view().state.paused}><p class="error" role="status">{view().state.pausedText}</p></Show>
      <For each={view().state.model.issues ?? []}>{issue => <p class="error" role="alert">{issue.code === 'union_field_count' ? labels().unionMismatch : `${labels().packageIssue}: ${issue.table}${issue.column ? `.${issue.column}` : ''}`}</p>}</For>
      <div class="sections classic-workspace" id="query-page" role="tabpanel" aria-labelledby={`tab-${view().page}`}
        inert={locked() || child()} data-statement={view().selected} data-page={view().page}>
        <Show when={view().page === 'text'} fallback={panes()?.nodes}>
          <section class="query-pane full-text-pane"><h2>{labels().text}</h2>
            <Toolbar label={labels().textTools}>
              <Button class="edit-query-text" disabled={!view().state.model.writable || !view().state.features.linkedText} onClick={() => controller.editText()}>{labels().editText}</Button>
              <Button class="query-diff" disabled={!view().state.features.linkedText} onClick={() => controller.post({type:'textDiff'})}>{labels().diff}</Button>
              <Button class="query-comments" disabled={!view().state.features.linkedText} onClick={() => controller.post({type:'comments'})}>{labels().comments}</Button>
            </Toolbar>
            <TextNavigation target={() => fullText} />
            <pre ref={node => { fullText = node; queueMicrotask(() => controller.paintText(node)); }} id="query-full-text" tabIndex="0" onDblClick={event => locate(event.currentTarget)} />
          </section>
        </Show>
      </div>
      <details class="query-preview" ref={preview}><summary>{labels().text}</summary>
        <TextNavigation target={() => text} />
        <pre id="query-text" ref={text} tabIndex="0" aria-label={labels().text} onDblClick={event => locate(event.currentTarget)} />
      </details>
      <footer class="constructor-footer">
        <Button quiet class="text-page-button" disabled={locked() || child()} aria-label={labels().text} onClick={() => activate('text')}>{labels().query}</Button>
        <Button quiet class="catalog-toggle" aria-label={labels().toggleCatalog} disabled={locked() || child()} onClick={() => { controller.layout.preferences.catalogCollapsed = !controller.layout.collapsed(); controller.layout.grid(); controller.layout.save(); }}>{labels().database}</Button>
        <span class="constructor-status" role="status">{view().state.busy ? labels().working : view().state.paused ? view().state.pausedText : !view().state.model.writable ? view().state.reasons.read_only : labels().opened}</span>
        <div class="header-actions eska-toolbar">
          <Button class="previous-page" disabled={locked() || child() || position() === 0} onClick={() => activate(view().pages[position()-1])}>{labels().previous}</Button>
          <Button class="next-page" disabled={locked() || child() || position() + 1 === view().pages.length} onClick={() => activate(view().pages[position()+1])}>{labels().next}</Button>
          <Button primary title={labels().apply} class="constructor-apply" disabled={locked() || child() || !view().state.model.writable || !!view().state.model.issues?.length}
            onClick={() => controller.post({type:'apply'})}>{labels().ok}</Button>
          <Button class="constructor-cancel" disabled={view().state.busy || child()} title={labels().cancel} onClick={() => controller.post({type:'cancel'})}>{labels().dismiss}</Button>
        </div>
      </footer>
    </Show>
  </div>;
}
