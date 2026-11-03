import { For, Show, Switch, Match, createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { Preview } from './Preview.jsx';
import { PropertyValue } from './PropertyValue.jsx';
import { flatten, treeChildren, find, property, automaticCommands, text, key } from './model.mjs';

function handlerLinks(model, matches) {
  const result=[];
  for (const [index,handler] of (model.handlers??[]).entries()) if(matches(handler)) result.push({handler,index});
  return result;
}

function Splitter(props) {
  let start, initial;
  return <div role="separator" tabindex="0" aria-orientation={props.vertical ? 'vertical' : 'horizontal'} class={`form-splitter ${props.vertical ? 'form-splitter--vertical' : ''}`}
    onPointerDown={event => { event.preventDefault(); start = props.vertical ? event.clientX : event.clientY; initial = props.value(); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) props.change(initial + ((props.vertical ? event.clientX : event.clientY) - start) * (props.factor?.() ?? 1)); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); props.change(props.value() + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 10 : -10)); } }}/>
}
function ElementTree(props) {
  const c = props.controller, state = c.state;
  const [scroll, setScroll] = createSignal(0), [height, setHeight] = createSignal(180);
  const rows = createMemo(() => flatten(state.model.root, state.ui.folded));
  const start = createMemo(() => Math.max(0, Math.floor(scroll() / 22) - 8));
  const visible = createMemo(() => rows().slice(start(), start() + Math.ceil(height() / 22) + 16));
  let list;
  onMount(() => { const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height)); observer.observe(list); onCleanup(() => observer.disconnect()); });
  createEffect(() => { const selected = state.selected; const index = rows().findIndex(row => row.node.key === selected); if (!list || index < 0) return; const top = index * 22; if (top < list.scrollTop) list.scrollTop = top; else if (top + 22 > list.scrollTop + height()) list.scrollTop = top + 22 - height(); });
  const fold = node => c.ui('folded', { ...state.ui.folded, [node.key]: !state.ui.folded[node.key] });
  function keyboard(event) {
    const index = rows().findIndex(row => row.node.key === state.selected), row = rows()[index];
    let next;
    if (event.key === 'ArrowDown') next = rows()[Math.min(rows().length - 1, index + 1)];
    if (event.key === 'ArrowUp') next = rows()[Math.max(0, index - 1)];
    if (event.key === 'Home') next = rows()[0]; if (event.key === 'End') next = rows().at(-1);
    if (event.key === 'ArrowRight' && row && state.ui.folded[row.node.key]) fold(row.node);
    if (event.key === 'ArrowLeft' && row) { if (!state.ui.folded[row.node.key] && treeChildren(row.node).length) fold(row.node); else next = rows().slice(0, index).reverse().find(parent => parent.depth < row.depth); }
    if (event.key === 'F12' && row) c.post({ type: 'locate', target: { kind: event.ctrlKey ? 'binding' : 'element', identity: row.node.identity } });
    if (next) c.select(next.node); if (next || ['ArrowLeft', 'ArrowRight', 'F12'].includes(event.key)) event.preventDefault();
  }
  return <div ref={list} role="tree" tabindex="0" class="form-tree" aria-label={state.strings.elements} aria-activedescendant={`form-row-${state.selected}`} onScroll={event => setScroll(event.currentTarget.scrollTop)} onKeyDown={keyboard}>
    <div style={{ height: `${rows().length * 22}px`, position: 'relative', 'min-width': 'max-content' }}><For each={visible()}>{(row, index) => <div role="treeitem" id={`form-row-${row.node.key}`} aria-level={row.depth + 1} aria-selected={state.selected === row.node.key}
      aria-expanded={treeChildren(row.node).length ? !state.ui.folded[row.node.key] : undefined} classList={{ 'form-tree-row': true, selected: state.selected === row.node.key }}
      style={{ top: `${(start() + index()) * 22}px`, 'padding-left': `${row.depth * 16 + 4}px` }} onClick={() => c.select(row.node)} onDblClick={() => c.post({ type: 'locate', target: { kind: 'element', identity: row.node.identity } })}>
      <button type="button" tabindex="-1" class="form-tree-expander" aria-label={state.strings.expand} onClick={event => { event.stopPropagation(); fold(row.node); }}>{treeChildren(row.node).length ? state.ui.folded[row.node.key] ? '›' : '⌄' : ''}</button>
      <span class={`form-node-icon form-node-icon--${row.node.kind ?? 'unknown'}`} aria-hidden="true"/><span>{row.node.kind === 'Form' ? state.strings.form : row.node.kind === 'AutoCommandBar' ? state.strings.commandBar : row.node.name || row.node.kind}</span>
    </div>}</For></div>
  </div>;
}
function Definitions(props) {
  const c = props.controller, state = c.state;
  const definitions = () => state.model[state.ui.tab] ?? state.model.attributes;
  const locate = definition => c.post({ type: 'locate', target: { kind: 'definition', section: state.ui.tab, name: definition.name } });
  return <><div class="form-table-scroll"><table class="form-definitions"><thead><tr><th>{state.strings[state.ui.tab] ?? state.strings.attributes}</th><th>{state.ui.tab==='commands'?state.strings.action:state.strings.type}</th></tr></thead><tbody><For each={definitions()}>{definition => <tr tabindex="0"
    onDblClick={event => { if (!event.target.closest('summary,button,input')) locate(definition); }}
    onKeyDown={event => { if (event.target === event.currentTarget && ['F12', 'Enter'].includes(event.key)) { event.preventDefault(); locate(definition); } }}>
    <td>{definition.name}</td><td><Show when={property(definition, 'Type')}>{field => <PropertyValue field={field()} state={state}/>}</Show>
      <Show when={state.handlerNavigation&&state.ui.tab==='commands'}><For each={handlerLinks(state.model,handler=>handler.owner.kind==='command'&&handler.owner.name===definition.name)}>{entry=><button class="form-handler" type="button" title={state.strings.handler} onClick={()=>c.post({type:'handler',index:entry.index})}>{entry.handler.name}</button>}</For></Show>
    </td>
  </tr>}</For></tbody></table></div><div class="form-tabs" role="tablist"><For each={['attributes', 'commands', 'parameters']}>{name => <button role="tab" aria-selected={state.ui.tab === name} classList={{ active: state.ui.tab === name }} onClick={() => c.ui('tab', name)}>{state.strings[name]}</button>}</For></div></>;
}
function Properties(props) {
  const c = props.controller, state = c.state;
  const node = createMemo(() => find(state.model.root, state.selected) ?? state.model.root);
  const handlers = createMemo(() => state.handlerNavigation ? handlerLinks(state.model,handler=>handler.owner.kind==='element'&&key({identity:handler.owner.identity})===node().key) : []);
  const locate = field => c.post({ type: 'locate', target: { kind: 'property', identity: node().identity, property: field.key } });
  return <><div class="form-pane-title">{state.strings.properties}<span>{node().name || state.strings.form}</span></div><div class="form-table-scroll"><table class="form-properties"><tbody>
    <tr><th>{state.strings.name}</th><td>{node().name ?? state.strings.form}</td></tr><tr><th>{state.strings.kind}</th><td>{node().kind}</td></tr>
    <For each={node().properties}>{field => <tr tabindex="0" data-property-name={field.key.name} data-property-namespace={field.key.namespace ?? ''} title={`{${field.key.namespace ?? ''}}${field.key.name} — ${state.strings.source}`}
      onDblClick={event => { if (!event.target.closest('summary,button,input')) locate(field); }}
      onKeyDown={event => { if (event.target === event.currentTarget && ['F12', 'Enter'].includes(event.key)) { event.preventDefault(); locate(field); } }}>
      <th>{field.caption?.[state.locale.startsWith('ru') ? 'ru-RU' : 'en-US'] ?? field.key.name}</th><td><PropertyValue field={field} state={state}/></td>
    </tr>}</For>
    <Show when={handlers().length}><tr><th colspan="2">{state.strings.events}</th></tr></Show>
    <For each={handlers()}>{entry=><tr class="form-event"><th>{entry.handler.event}</th><td><button class="form-handler" type="button" title={state.strings.handler} onClick={()=>c.post({type:'handler',index:entry.index})}>{entry.handler.name}</button></td></tr>}</For>
  </tbody></table></div><div class="form-property-actions"><button type="button" onClick={() => c.post({ type: 'locate', target: { kind: 'element', identity: node().identity } })}>{state.strings.source}</button>
    <Show when={node().presentation.binding}><button type="button" onClick={() => c.post({ type: 'locate', target: { kind: 'binding', identity: node().identity } })}>{state.strings.binding}</button></Show></div></>;
}
function CommandInterface(props) {
  const state = props.controller.state;
  return <div class="form-table-scroll"><table class="form-definitions"><thead><tr><th>{state.strings.commands}</th><th>{state.strings.visible}</th></tr></thead><tbody>
    <For each={automaticCommands(state.model.root)}>{item => <tr><td>{text(item.caption, state.locale, state.strings)}</td><td>✓</td></tr>}</For>
    <For each={state.model.commands}>{command => <tr><td>{command.name}</td><td>✓</td></tr>}</For>
  </tbody></table></div>;
}
export function App(props) {
  const c = props.controller, state = c.state;
  let shell;
  return <main class="form-shell" ref={shell} data-view-role={state.role}>
    <div class="form-toolbar"><span id="title">{state.title ?? state.strings.title}</span><span class="form-toolbar-spacer"/>
      <button type="button" onClick={() => c.post({ type: 'source' })}>{state.strings.xml}</button><button type="button" onClick={() => c.post({ type: 'refresh' })}>{state.strings.refresh}</button>
      <Show when={state.role === 'main'} fallback={<button type="button" onClick={() => c.post({ type: 'dock' })}>{state.strings.dock}</button>}>
        <button type="button" onClick={() => c.post({ type: state.detached ? 'revealPreview' : 'detach' })}>{state.detached ? state.strings.revealPreview : state.strings.detach}</button>
      </Show><label class="form-zoom">{state.strings.zoom}<select value={state.ui.zoom} onChange={event => c.ui('zoom', Number(event.currentTarget.value))}><For each={[50, 75, 100, 125, 150, 200]}>{value => <option value={value}>{value}%</option>}</For></select></label>
    </div>
    <Show when={state.model} fallback={<div class="form-empty" role="status">{state.notice || state.strings.loading}</div>}>
      <Show when={state.role === 'main'}><div class="form-inspectors" style={{ height: `${state.ui.upper}px`, 'grid-template-columns': `calc(${state.ui.left}% - 4px) 4px calc(${state.ui.right - state.ui.left}% - 4px) 4px minmax(180px, 1fr)` }}>
        <section class="form-pane"><div class="form-pane-title">{state.strings.elements}</div><Show when={state.ui.treeTab === 'elements'} fallback={<CommandInterface controller={c}/>}><ElementTree controller={c}/></Show>
          <div class="form-tabs" role="tablist"><For each={['elements', 'commandInterface']}>{name => <button role="tab" aria-selected={state.ui.treeTab === name} classList={{ active: state.ui.treeTab === name }} onClick={() => c.ui('treeTab', name)}>{state.strings[name]}</button>}</For></div>
        </section>
        <Splitter vertical value={() => state.ui.left} factor={() => 100 / shell.clientWidth} change={value => c.ui('left', Math.max(15, Math.min(state.ui.right - 15, value)))}/>
        <section class="form-pane"><Definitions controller={c}/></section>
        <Splitter vertical value={() => state.ui.right} factor={() => 100 / shell.clientWidth} change={value => c.ui('right', Math.max(state.ui.left + 15, Math.min(82, value)))}/>
        <section class="form-pane"><Properties controller={c}/></section>
      </div><Splitter value={() => state.ui.upper} change={value => c.ui('upper', Math.max(100, Math.min(shell.clientHeight - 150, value)))}/></Show>
      <Show when={state.role === 'preview' || !state.detached} fallback={<div class="form-detached-placeholder"><button type="button" onClick={() => c.post({ type: 'revealPreview' })}>{state.strings.revealPreview}</button></div>}><Preview controller={c}/></Show>
    </Show>
    <footer classList={{ 'form-status': true, 'form-status--stale': state.phase === 'stale' || state.phase === 'disconnected' }} role="status"><span>{state.notice || (state.phase === 'loading' ? state.strings.loading : c.nativeText?.failed() ? state.strings.nativeTextApproximate : state.strings.readOnly)}</span><span>1С 8.3.27 · {state.strings.taxi} · {state.os === 'win32' ? 'Windows' : 'Linux'}</span></footer>
  </main>;
}
