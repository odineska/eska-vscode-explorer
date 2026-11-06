import { For, Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { scalar, flag, caption, font, color, text, fontLineHeight } from './model.mjs';
import { createTableLayout } from './table-layout.js';
import { tableAdditionsProjection, tableFooterFont, tableTracks } from './table-model.mjs';
import { CommandButton, Element } from './Preview.jsx';
import { ViewStatus } from './Additions.jsx';
import { NativeLabel } from './NativeLabel.jsx';
import { TableSearch } from './TableSearch.jsx';
import { NativeTableMovement } from './NativeTableMovement.jsx';
import { tableScrollbarGrays, tablePaginationGlyphs } from './table-scrollbar.mjs';

function bandTextStyle(value, foreground, background, alignment, os) {
  return { ...font(value, os), color: color(foreground), 'background-color': color(background),
    'line-height': `${Math.max(18, fontLineHeight(value))}px`, 'text-align': alignment };
}

function TableCaption(props) {
  const value = () => props.node.presentation;
  return <NativeLabel text={props.text} font={value().titleFont} foreground={value().titleColor} placement="tableHeader"
    enabled={props.controller.state.os === 'linux'} calibrated={['Auto', 'Top'].includes(scalar(props.node, 'HeaderVerticalAlign', 'Top'))}
    segments={props.segments} interactive={props.interactive} runtime={props.controller.nativeText}>{props.children}</NativeLabel>;
}

function FooterCell(props) {
  const state = props.controller.state;
  const node = () => props.column.node;
  const appearance = () => node().presentation.tableColumnAppearance;
  const face = () => tableFooterFont(props.table, node());
  const foreground = () => appearance()?.footerForeground ?? props.table.presentation.foreground;
  const label = () => props.column.fields.map(item => text(item.presentation.footerText, state.locale, state.strings)).join(', ');
  return <div role="cell" onClick={event => { event.stopPropagation(); props.controller.select(node()); }}
    style={bandTextStyle(face(), foreground(), appearance()?.footerBackground, scalar(node(), 'FooterHorizontalAlign', 'Left').toLowerCase(), state.os)}>
    <NativeLabel text={label()} font={face()} foreground={foreground()} placement="tableFooter"
      enabled={state.os === 'linux'} calibrated={props.column.fields.length === 1} runtime={props.controller.nativeText}/>
  </div>;
}

function Header(props) {
  const state = props.controller.state, model = () => props.model, node = () => model().node;
  const select = (event, item = node()) => { event.stopPropagation(); props.controller.select(item); };
  const cell = (item, extra = {}) => ({ ...bandTextStyle(item.presentation.titleFont, item.presentation.titleColor,
    item.presentation.tableColumnAppearance?.headerBackground, scalar(item, 'HeaderHorizontalAlign', 'Left').toLowerCase(), state.os), ...extra });
  const title = item => flag(item, 'ShowInHeader') ? caption(item, state) : '';
  return <Switch>
    <Match when={model().mode === 'field'}><div role="columnheader" data-column={node().key} classList={{ 'taxi-table-header-cell': true, selected: state.selected === node().key }} style={cell(node(), { height: `${props.height}px` })} onClick={select}><TableCaption node={node()} controller={props.controller} text={title(node())}/></div></Match>
    <Match when={model().mode === 'horizontal'}><div class="taxi-table-header-horizontal" style={{ 'grid-column': `span ${model().columns.length}`, height: `${props.height}px`, 'grid-template-rows': model().show ? `${model().captionHeight}px minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
      <Show when={model().show}><div role="columnheader" data-column={node().key} class="taxi-table-header-cell taxi-table-header-title" style={cell(node())} onClick={select}><TableCaption node={node()} controller={props.controller} text={caption(node(),state)}/></div></Show>
      <div class="taxi-table-header-children"><For each={model().children}>{child => <Header model={child} controller={props.controller} height={props.height - model().captionHeight}/>}</For></div>
    </div></Match>
    <Match when={model().mode === 'vertical' || model().mode === 'inCell'}><div class="taxi-table-header-vertical" style={{ height: `${props.height}px` }}>
      <Show when={model().show}><div role="columnheader" data-column={node().key} class="taxi-table-header-cell" style={cell(node(), { height: `${model().captionHeight}px` })} onClick={select}><TableCaption node={node()} controller={props.controller} text={caption(node(),state)}/></div></Show>
      <Show when={model().mode === 'vertical'} fallback={<div role="columnheader" class="taxi-table-header-cell" style={cell(node(), { flex: 1 })}><TableCaption node={node()} controller={props.controller} text={model().columns[0].fields.map(title).join(', ')} segments={model().columns[0].fields.flatMap((item,index)=>index?[', ',title(item)]:[title(item)])} interactive><For each={model().columns[0].fields}>{(item, index) => <><Show when={index() > 0}>, </Show><span data-column={item.key} onClick={event => select(event, item)}>{title(item)}</span></>}</For></TableCaption></div>}>
        <For each={model().children}>{(child, index) => <Header model={child} controller={props.controller} height={child.height + (index() === model().children.length - 1 ? props.height - model().height : 0)}/>}</For>
      </Show>
    </div></Match>
  </Switch>;
}

export function TableCommandActions(props) {
  let movementGroup;
  const state = props.controller.state;
  const isMovement = item => /\.(MoveUp|MoveDown)$/.test(item.key);
  const movement = createMemo(() => props.commands.filter(isMovement));
  const label = item => text(item.caption, state.locale, state.strings);
  return <>
    <For each={props.commands.filter(item => !isMovement(item))}>{item => {
      const copy = item.key.endsWith('.Copy');
      return <CommandButton controller={props.controller} label={label(item)}
        iconOnly={copy} picture={copy ? 'StdPicture.CloneListItem' : undefined}/>;
    }}</For>
    <Show when={movement().length}>
      <span ref={movementGroup} class="taxi-table-move">
        <For each={movement()}>{item => <CommandButton controller={props.controller} label={label(item)}
          picture={`StdPicture.${item.key.split('.').at(-1)}`} pictureVariant="tableCommand" iconOnly/>}</For>
        <NativeTableMovement element={() => movementGroup} commands={movement()} controller={props.controller}/>
      </span>
    </Show>
  </>;
}

/** Put the search controls in the order of the native toolbar. */
export function TableToolbarSearch(props) {
  const state = props.controller.state;
  const searchControl = () => <CommandButton node={props.control} controller={props.controller}
    label={state.strings.search} picture="StdPicture.SearchControl" iconOnly dropdown nativeDropdown/>;
  return <>
    <Show when={props.control && !props.search}>{searchControl()}</Show>
    <Show when={props.spacer}><span class="taxi-command-spacer"
      classList={{ 'taxi-command-spacer--wide': !!props.control && !props.search }}/></Show>
    <Show when={props.search}>{search => <TableSearch node={search()} controller={props.controller}/>}</Show>
    <Show when={props.control && props.search}>{searchControl()}</Show>
  </>;
}

/** Empty design-time collections do not fabricate runtime rows or values. */
export function Table(props) {
  const state = props.controller.state, node = () => props.node;
  const additions = createMemo(() => tableAdditionsProjection(state.model.root, node()));
  const layout = createTableLayout(node, state, additions);
  let content;
  const [columnSpace, setColumnSpace] = createSignal(0);
  createEffect(() => {
    if (!layout().nativeColumns) return;
    const observer = new ResizeObserver(([entry]) => setColumnSpace(Math.round(entry.contentRect.width)));
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });
  const tracks = createMemo(() => tableTracks(layout(), columnSpace()));
  const lookup = () => layout().commands.some(item => /\.(Find|CancelSearch)$/.test(item.key));
  return <div class="taxi-table-field" data-native-column-sizing={layout().nativeColumns ? '' : undefined} data-search-location={scalar(node(), 'SearchStringLocation') || undefined} style={{ 'min-width': 'var(--taxi-table-preferred-width)', '--taxi-table-preferred-width': `${layout().preferredWidth}px`, '--taxi-table-control-min-width': `${layout().controlMinWidth}px`, '--taxi-table-content-min-width': `${layout().contentMinWidth}px`, '--taxi-table-min-height': `${Math.min(layout().height, layout().header + (layout().footer ? layout().footer + 1 : 0) + 25)}px` }}>
    <Show when={layout().toolbar}><div class="taxi-table-command-bar" data-autofill={layout().more ? "" : undefined} data-table-lookup={lookup() ? '' : undefined}>
      <TableCommandActions commands={layout().commands} controller={props.controller}/>
      <For each={layout().bar?.children ?? []}>{item => <Element node={item} controller={props.controller}/>}</For>
      <TableToolbarSearch search={layout().search} control={layout().searchControl} controller={props.controller} spacer/>
      <Show when={layout().more}><CommandButton controller={props.controller} label={state.strings.more} dropdown nativeDropdown/></Show>
    </div></Show>
    <Show when={layout().topSearch}>{search => <TableSearch node={search()} controller={props.controller} top/>}</Show>
    <ViewStatus node={node()} controller={props.controller}/>
    <div role="table" aria-label={caption(node(), state)} class="taxi-table-scroll" style={{ height: `${layout().height}px`, 'border-color': color(node().presentation.border), 'background-color': color(node().presentation.background) }}>
      <div ref={content} class="taxi-table-content" style={{ ...font(node().presentation.font, state.os), color: color(node().presentation.foreground) }}>
        <Show when={layout().header}><div class="taxi-table-head" role="rowgroup" style={{ height: `${layout().header}px`, 'grid-template-columns': tracks() }}><For each={layout().children}>{child => <Header model={child} controller={props.controller} height={layout().header}/>}</For></div></Show>
        <div class="taxi-table-empty" role="rowgroup"><Show when={node().presentation.markIncomplete}><i class="taxi-table-incomplete"/></Show></div>
        <Show when={layout().footer}><div class="taxi-table-footer" role="row" style={{ height: `${layout().footer}px`, 'grid-template-columns': tracks() }}><For each={layout().columns}>{column => <FooterCell column={column} table={node()} controller={props.controller}/>}</For></div></Show>
      </div>
      <Show when={!layout().dynamic}><div class="taxi-table-scrollbar" aria-hidden="true"><For each={[0,1]}>{()=><span><Show when={state.os==='linux'}><svg width="6" height="4" viewBox="0 0 6 4" shape-rendering="crispEdges"><For each={tableScrollbarGrays}>{(value,index)=><rect x={index()%6} y={Math.floor(index()/6)} width="1" height="1" fill={`rgb(${value},${value},${value})`}/>}</For></svg></Show></span>}</For></div></Show>
    </div>
    <Show when={layout().dynamic}><div class="taxi-table-pagination" aria-hidden="true"><For each={['M2 9L6 5l4 4zM2 3h8', 'M2 8l4-4 4 4z', 'M2 4l4 4 4-4z', 'M2 3l4 4 4-4zM2 9h8']}>{(path,index) => <span><Show when={state.os==='linux'} fallback={<svg viewBox="0 0 12 12"><path d={path}/></svg>}><svg width="9" height={tablePaginationGlyphs[index()].height} viewBox={`0 0 9 ${tablePaginationGlyphs[index()].height}`} shape-rendering="crispEdges"><For each={tablePaginationGlyphs[index()].grays}>{(gray,pixel)=><rect x={pixel()%9} y={Math.floor(pixel()/9)} width="1" height="1" fill={`rgb(${gray},${gray},${gray})`}/>}</For></svg></Show></span>}</For></div></Show>
  </div>;
}
