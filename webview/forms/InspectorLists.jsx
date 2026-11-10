import { For, Show, createEffect, createMemo, createSignal, on, onMount, onCleanup } from 'solid-js';
import { automaticCommands, text } from './model.mjs';
import { dataRowExpanded, dataRows, definitionSections, treeRows } from './inspector-model.mjs';
import { InspectorIcon, InspectorIconButton, dataGlyph, nodeGlyph } from './InspectorIcon.jsx';
import { Splitter } from './Splitter.jsx';

const treeHeight = 24, dataHeight = 32;
const noRows = [];
const hasModifier = event => event.altKey || event.metaKey || event.shiftKey || event.ctrlKey;
const bound = (value, min, max) => Math.min(max, Math.max(min, value));

function virtualRows(rows, rowHeight, initialHeight, headerHeight = 0) {
  let area;
  const [scroll, setScroll] = createSignal(0), [height, setHeight] = createSignal(initialHeight);
  const limit = createMemo(() => Math.ceil(height() / rowHeight) + 16);
  const start = createMemo(() => Math.max(0, Math.min(rows().length - limit(), Math.floor(scroll() / rowHeight) - 8)));
  const visible = createMemo(() => rows().slice(start(), start() + limit()));
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(area);
    onCleanup(() => observer.disconnect());
  });
  function reveal(index) {
    if (index < 0 || !area) return;
    const top = index * rowHeight;
    const height = area.clientHeight - headerHeight;
    if (top < area.scrollTop) area.scrollTop = top;
    else if (top + rowHeight > area.scrollTop + height) area.scrollTop = top + rowHeight - height;
    setScroll(area.scrollTop);
  }
  function reset() {
    if (area) area.scrollTop = 0;
    setScroll(0);
  }
  return { mount: value => { area = value; }, scroll: event => setScroll(event.currentTarget.scrollTop),
    start, visible, reveal, reset, focus: () => area?.focus({ preventScroll: true }) };
}

export function InspectorTabs(props) {
  const activate = name => props.change(name);
  function keyboard(event) {
    if (hasModifier(event)) return;
    const current = props.tabs.indexOf(props.active);
    const index = { Home: 0, End: props.tabs.length - 1,
      ArrowLeft: (current + props.tabs.length - 1) % props.tabs.length, ArrowRight: (current + 1) % props.tabs.length }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    activate(props.tabs[index]);
    event.currentTarget.querySelectorAll('[role=tab]')[index]?.focus();
  }
  return <div class="form-tabs" role="tablist" aria-label={props.label} onKeyDown={keyboard}>
    <For each={props.tabs}>{name => <button type="button" role="tab" aria-selected={props.active === name} tabIndex={props.active === name ? 0 : -1}
      classList={{ active: props.active === name }} onClick={() => activate(name)}>{props.strings[name]}</button>}</For>
  </div>;
}

export function StructurePane(props) {
  const c = props.controller, state = c.state;
  const tree = () => state.ui.treeTab === 'elements';
  const rows = createMemo(() => tree() ? treeRows(props.index, state.ui.folded, props.terms) : noRows);
  const virtual = virtualRows(rows, treeHeight, 180);
  const selected = createMemo(() => props.index.nodes.get(state.selected));
  const positions = createMemo(() => new Map(rows().map((row, index) => [row.key, index])));
  const related = row => props.activeData && (props.activeData.section === 'attributes' && props.activeData.path === row.binding
    || props.activeData.section === 'commands' && props.activeData.name === row.command);
  const isSelected = row => !props.activeData && state.selected === row.key;
  const fold = row => {
    if (!row.children.length || props.terms.length) return;
    c.ui('folded', { ...state.ui.folded, [row.key]: !state.ui.folded[row.key] });
  };
  const all = collapse => c.ui('folded', collapse ? Object.fromEntries([...props.index.nodes.values()].filter(row => row.children.length).map(row => [row.key, true])) : {});
  const locate = row => c.post({ type: 'locate', target: { kind: 'element', identity: row.node.identity } });
  function keyboard(event) {
    if (hasModifier(event)) return;
    const list = rows();
    const index = positions().get(state.selected) ?? -1, row = list[index];
    let next;
    switch (event.key) {
      case 'ArrowDown': next = list[Math.min(list.length - 1, index + 1)]; break;
      case 'ArrowUp': next = list[Math.max(0, index - 1)]; break;
      case 'Home': next = list[0]; break;
      case 'End': next = list.at(-1); break;
      case 'ArrowRight':
        if (row?.children.length) {
          if (state.ui.folded[row.key] && !props.terms.length) fold(row);
          else if (list[index + 1]?.parent === row.key) next = list[index + 1];
        }
        break;
      case 'ArrowLeft':
        if (row?.children.length && !state.ui.folded[row.key] && !props.terms.length) fold(row);
        else next = props.index.nodes.get(row?.parent);
        break;
      case 'Enter': if (row) c.select(row.node); break;
      case 'F12': if (row) locate(row); break;
      default: return;
    }
    if (next) { c.select(next.node); virtual.reveal(list.indexOf(next)); }
    event.preventDefault();
  }
  createEffect(on(() => state.ui.search, virtual.reset));
  createEffect(on(() => props.reveal, key => {
    if (!key) return;
    virtual.reveal(positions().get(key) ?? -1);
  }));
  // Selection from the form must be visible without shifting focus to this window.
  createEffect(on(() => state.selected, key => {
    virtual.reveal(positions().get(key) ?? -1);
  }));

  return <section class="form-pane form-pane--structure" hidden={props.hidden} aria-label={state.strings.structure}>
    <header class="form-pane-heading"><h2>{state.strings.structure}</h2><div class="form-pane-tools">
      <Show when={tree()}>
        <InspectorIconButton icon="expand" label={state.strings.expandAll} disabled={!!props.terms.length} onClick={() => all(false)}/>
        <InspectorIconButton icon="collapse" label={state.strings.collapseAll} disabled={!!props.terms.length} onClick={() => all(true)}/>
      </Show>
    </div></header>
    <InspectorTabs tabs={['elements', 'commandInterface']} active={state.ui.treeTab} change={name => c.ui('treeTab', name)}
      strings={state.strings} label={state.strings.structure}/>
    <div ref={virtual.mount} hidden={!tree()} role="tree" tabIndex="0" class="form-tree" aria-label={state.strings.elements}
      aria-activedescendant={virtual.visible().some(isSelected) ? `form-row-${state.selected}` : undefined}
      onScroll={virtual.scroll} onKeyDown={keyboard}>
      <Show when={rows().length} fallback={<div class="form-list-empty">{state.strings.noMatches}</div>}>
        <div class="form-tree-canvas" style={{ height: `${rows().length * treeHeight}px` }}>
          <For each={virtual.visible()}>{(row, index) => {
            const expanded = () => !state.ui.folded[row.key] || !!props.terms.length;
            return <div role="treeitem" id={`form-row-${row.key}`} aria-level={row.depth + 1} aria-selected={isSelected(row)}
              aria-expanded={row.children.length ? expanded() : undefined} title={row.title && row.title !== row.label ? `${row.path}\n${row.title}` : row.path}
              classList={{ 'form-tree-row': true, selected: isSelected(row), related: related(row), 'form-tree-hidden': row.node.presentation.displayed === false }}
              style={{ top: `${(virtual.start() + index()) * treeHeight}px`, '--form-depth': row.depth }}
              onClick={() => { c.select(row.node); virtual.focus(); }} onDblClick={() => locate(row)}>
              <Show when={row.children.length} fallback={<span class="form-tree-expander"/>}>
                <button type="button" tabIndex="-1" class="form-tree-expander" aria-label={expanded() ? state.strings.collapse : state.strings.expand}
                  onClick={event => { event.stopPropagation(); fold(row); virtual.focus(); }}>
                  <InspectorIcon name={expanded() ? 'down' : 'right'}/>
                </button>
              </Show>
              <InspectorIcon name={nodeGlyph(row.node.kind)}/>
              <span class="form-truncate">{row.label}</span>
              <Show when={row.title && row.title !== row.label}><span class="form-tree-caption form-truncate">{row.title}</span></Show>
              <Show when={related(row)}><span class="form-row-link" title={state.strings.related}><InspectorIcon name="link"/></span></Show>
            </div>;
          }}</For>
        </div>
      </Show>
    </div>
    <Show when={!tree()}><CommandInterface controller={c} index={props.index} terms={props.terms} select={props.selectData}/></Show>
    <Show when={tree() && selected()}><div class="form-path-trail form-truncate" title={selected().path}>{selected().path}</div></Show>
  </section>;
}

function CommandInterface(props) {
  const state = props.controller.state;
  const contains = label => props.terms.every(term => label.toLocaleLowerCase(state.locale).includes(term));
  const commands = createMemo(() => automaticCommands(state.model.root, state));
  const hasVisible = item => contains(text(item.caption, state.locale, state.strings)) || item.items?.some(hasVisible);
  return <div class="form-table-scroll form-command-list">
    <For each={commands().filter(hasVisible)}>{item => <div class="form-command-entry" title={item.key}>
      <InspectorIcon name="command"/><span>{text(item.caption, state.locale, state.strings)}</span>
      <Show when={item.items?.length}><ul><For each={item.items.filter(hasVisible)}>{child => <li>{text(child.caption, state.locale, state.strings)}</li>}</For></ul></Show>
    </div>}</For>
    <For each={props.index.definitions.commands.filter(row => contains(row.name))}>{row =>
      <button class="form-command-entry form-link" type="button" onClick={() => props.select(row)}>
        <InspectorIcon name="command"/><span>{row.name}</span>
      </button>
    }</For>
  </div>;
}

export function DataTypeLabel(props) {
  const summary = () => {
    const type = props.type;
    const count = type.count;
    if (count <= 1) return type.label;
    const unit = props.pluralRules.select(count);
    return `${type.label} · ${props.strings[`typeCount.${unit}`].replace('{0}', String(count))}`;
  };
  return <Show when={props.type} fallback={<span class="form-truncate">{props.action}</span>}>{type =>
    <div class="form-type-label" title={type().count > 1 ? summary() : [type().category, type().label].filter(Boolean).join('.')}>
      <span class="form-truncate">{summary()}</span>
      <Show when={type().count <= 1 && type().category}><small class="form-truncate">{type().category}</small></Show>
    </div>
  }</Show>;
}

export function DataPane(props) {
  const c = props.controller, state = c.state;
  const rows = createMemo(() => dataRows(props.index, state.ui.tab, state.ui.dataFolded, props.terms, props.revealed));
  const visibleParents = createMemo(() => new Set(rows().map(row => row.parent)));
  const expanded = row => props.terms.length ? visibleParents().has(row.id)
    : dataRowExpanded(state.ui.dataFolded, row.id, props.revealed);
  const virtual = virtualRows(rows, dataHeight, 180, 24);
  const current = () => props.activeData ?? props.relatedData;
  const isSelected = row => props.activeData?.id === row.id;
  const linked = row => props.relatedData?.id === row.id && !isSelected(row);
  let grid;
  const fold = row => {
    if (props.terms.length) return;
    c.ui('dataFolded', { ...state.ui.dataFolded, [row.id]: expanded(row) });
    props.clearReveal();
  };
  function keyboard(event) {
    if (event.target.closest('button,[role=separator]') || hasModifier(event)) return;
    const list = rows().filter(row => !row.heading);
    const index = list.findIndex(row => row.id === current()?.id);
    const row = list[index];
    let next;
    switch (event.key) {
      case 'ArrowDown': next = list[Math.min(index + 1, list.length - 1)]; break;
      case 'ArrowUp': next = list[Math.max(index - 1, 0)]; break;
      case 'Home': next = list[0]; break;
      case 'End': next = list.at(-1); break;
      case 'ArrowRight':
        if (row && props.index.children.get(row.id)?.length) {
          if (!expanded(row)) fold(row);
          else if (list[index + 1]?.parent === row.id) next = list[index + 1];
        }
        break;
      case 'ArrowLeft':
        if (row && !props.terms.length && expanded(row) && props.index.children.get(row.id)?.length) fold(row);
        else if (row?.parent) next = props.index.byData.get(row.parent);
        break;
      case 'Enter': if (row) props.select(row); break;
      case 'F12': if (row) props.locate(row); break;
      default: return;
    }
    if (next) { props.select(next); virtual.reveal(rows().indexOf(next)); }
    event.preventDefault();
  }
  createEffect(on([() => state.ui.tab, () => state.ui.search], virtual.reset));
  createEffect(on(() => props.reveal, id => {
    if (id) virtual.reveal(rows().findIndex(row => row.id === id));
  }));
  const width = () => bound(state.ui.dataWidth, 26, 74);
  const range = { minimum: 26, maximum: 74 };
  return <section class="form-pane form-pane--data" hidden={props.hidden} aria-label={state.strings.data}>
    <header class="form-pane-heading"><h2>{state.strings.data}</h2></header>
    <InspectorTabs tabs={definitionSections} active={state.ui.tab} change={name => c.ui('tab', name)}
      strings={state.strings} label={state.strings.data}/>
    <div ref={element => { grid = element; virtual.mount(element); }} class="form-table-scroll form-data-grid"
      role="treegrid" aria-label={state.strings[state.ui.tab]} aria-colcount="2" aria-rowcount={rows().length + 1} tabIndex="0"
      aria-activedescendant={virtual.visible().some(isSelected) ? `form-data-${props.activeData.id}` : undefined}
      onScroll={virtual.scroll} onKeyDown={keyboard}>
      <table class="form-definitions" role="presentation">
        <colgroup><col style={{ width: `${width()}%` }}/><col/></colgroup>
        <thead role="rowgroup"><tr role="row"><th role="columnheader">{state.strings.name}
          <Splitter vertical class="form-splitter form-splitter--vertical form-data-splitter" range={range} label={state.strings.resizeDataColumns} value={width}
            factor={() => 100 / grid.clientWidth} change={value => c.ui('dataWidth', bound(value, range.minimum, range.maximum))}/>
        </th><th role="columnheader">{state.ui.tab === 'commands' ? state.strings.action : state.strings.type}</th></tr></thead>
        <tbody role="rowgroup">
          <Show when={virtual.start() > 0}><tr aria-hidden="true" class="form-data-spacer" style={{ height: `${virtual.start() * dataHeight}px` }}><td colspan="2"/></tr></Show>
          <For each={virtual.visible()}>{(row, index) => <Show when={!row.heading} fallback={
            <tr class="form-data-heading" role="row"><td colspan="2" role="gridcell">{state.strings[row.heading]}</td></tr>
          }>
            <tr classList={{ 'form-data-row': true, selected: isSelected(row), related: linked(row) }} id={`form-data-${row.id}`}
              role="row" aria-level={row.depth + 1} aria-selected={isSelected(row)} aria-rowindex={virtual.start() + index() + 2}
              aria-expanded={props.index.children.get(row.id)?.length ? expanded(row) : undefined}
              data-form-data-path={row.path} title={row.path}
              onClick={() => { props.select(row); virtual.focus(); }} onDblClick={() => props.locate(row)}>
              <td role="gridcell"><div class="form-data-name" style={{ '--form-depth': row.depth }}>
                <Show when={props.index.children.get(row.id)?.length} fallback={<span class="form-tree-expander" aria-hidden="true"/>}>
                  <button type="button" tabIndex="-1" class="form-tree-expander" aria-label={expanded(row) ? state.strings.collapse : state.strings.expand}
                    disabled={!!props.terms.length} onClick={event => { event.stopPropagation(); fold(row); virtual.focus(); }}>
                    <InspectorIcon name={expanded(row) ? 'down' : 'right'}/>
                  </button>
                </Show>
                <InspectorIcon name={dataGlyph(row, props.index)}/>
                <span class="form-truncate">{row.label}</span>
                <Show when={linked(row)}><span class="form-row-link" title={state.strings.related}><InspectorIcon name="link"/></span></Show>
              </div></td>
              <td role="gridcell"><DataTypeLabel type={row.type} action={row.action} pluralRules={props.pluralRules} strings={state.strings}/></td>
            </tr>
          </Show>}</For>
          <Show when={rows().length > virtual.start() + virtual.visible().length}>
            <tr aria-hidden="true" class="form-data-spacer" style={{ height: `${(rows().length - virtual.start() - virtual.visible().length) * dataHeight}px` }}><td colspan="2"/></tr>
          </Show>
        </tbody>
      </table>
      <Show when={!rows().length}><div class="form-list-empty">{props.terms.length ? state.strings.noMatches : state.strings.noData}</div></Show>
    </div>
  </section>;
}
