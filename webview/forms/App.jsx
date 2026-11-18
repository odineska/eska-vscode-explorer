import { Show, createSignal, createMemo, createEffect, on, onMount, onCleanup } from 'solid-js';
import { PreviewSurface } from './PreviewSurface.jsx';
import { Splitter } from './Splitter.jsx';
import { FormEditor } from './FormEditor.jsx';
import { Inspector } from './Inspector.jsx';
import { inspectorLayout } from './inspector-layout.mjs';
import { indexInspector } from './inspector-model.mjs';
import { createFormDrag } from './form-drag.mjs';
import { FormMenu, createFormMenu } from './FormMenu.jsx';
import { FormToolbar, PreviewToolbar } from './FormToolbar.jsx';

export function App(props) {
  const c = props.controller, state = c.state;
  let shell, toolbar, status;
  // The same revision-scoped index serves the inspector and both drag surfaces.
  const index = createMemo(on([() => state.revision, () => state.model, () => state.locale],
    () => indexInspector(state.model, state.locale, state.strings)));
  const drag = c.drag = createFormDrag(c, index);
  createEffect(on([
    () => state.revision, () => state.formSessionId, () => state.model, () => state.detached,
    c.writable, c.edit,
  ], drag.clear, { defer: true }));
  c.menu = createFormMenu();
  const [size, setSize] = createSignal({ width: 0, height: 0, toolbar: 34, status: 23 });
  const inspectors = createMemo(() => inspectorLayout(size(), state.ui, state.role === 'main' && state.detached));
  createEffect(() => {
    const request = c.previewReveal();
    if (!request) return;
    const frame = requestAnimationFrame(() => {
      const viewport = shell.querySelector('.preview-scroll');
      if (!viewport) return;
      const target = request.endsWith(':root') ? viewport.querySelector('.taxi-form-frame')
        : viewport.querySelector(`[data-element="${CSS.escape(request)}"]`);
      if (target?.getClientRects().length) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  onMount(() => {
    const measure = () => {
      const next = { width: shell.clientWidth, height: shell.clientHeight,
        toolbar: toolbar.getBoundingClientRect().height, status: status.getBoundingClientRect().height };
      setSize(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [shell, toolbar, status]) observer.observe(element);
    measure();
    onCleanup(() => { observer.disconnect(); drag.clear(); });
  });
  return <main class="form-shell" ref={shell} data-view-role={state.role} data-form-title={state.title} aria-busy={c.replaying()}
    onDragStart={drag.start} onDragEnd={drag.clear} onDragOver={drag.over} onDragLeave={drag.leave} onDrop={drag.drop} onKeyDown={c.historyKey}>
    <div class="form-toolbar" ref={toolbar} hidden={state.role !== 'main'}>
      <FormToolbar controller={c} index={index()}/>
    </div>
    <Show when={state.model} fallback={<div class="form-empty" role="status">{state.notice || state.strings.loading}</div>}>
      <Show when={state.role === 'main'}><Inspector controller={c} layout={inspectors()} index={index()}/>
        <Show when={!state.detached}><Splitter label={state.strings.resizeInspector}
          range={{ minimum: inspectors().minimumHeight, maximum: inspectors().maximumHeight }}
          value={() => inspectors().height} change={value => c.ui('upper', Math.max(inspectors().minimumHeight, Math.min(inspectors().maximumHeight, value)))}/>
        </Show>
      </Show>
      <Show when={state.role === 'preview' || !state.detached}><PreviewToolbar controller={c}/><PreviewSurface controller={c}/></Show>
    </Show>
    <FormMenu controller={c.menu}/>
    <Show when={c.edit()} keyed>{draft => <FormEditor controller={c} draft={draft}/>}</Show>
    <footer ref={status} classList={{ 'form-status': true, 'form-status--stale': state.phase === 'stale' || state.phase === 'disconnected' }} role="status"><span>{state.notice || state.strings[c.editStatus()] || (state.phase === 'loading' ? state.strings.loading : c.nativeText?.failed() ? state.strings.nativeTextApproximate : state.authoring ? state.strings.editClean : state.strings.readOnly)}</span><span>{state.strings.beta} · 1С 8.3.27 · {state.strings.taxi} · {state.os === 'win32' ? 'Windows' : 'Linux'}</span></footer>
  </main>;
}
