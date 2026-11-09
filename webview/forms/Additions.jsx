import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { color, flag, font, property, scalar, viewStatusAddition } from './model.mjs';
import { designCaptionWidth } from './font-metrics.mjs';
import { CommandButton } from './Preview.jsx';
import { TableSearch } from './TableSearch.jsx';
import { ViewStatusChip } from './ViewStatusChip.jsx';

export function SearchControl(props) {
  return <CommandButton node={props.node} controller={props.controller} label={props.controller.state.strings.search}
    picture="StdPicture.SearchControl" iconOnly dropdown nativeDropdown standaloneSearch={props.standalone}/>;
}

function StatusStrip(props) {
  let strip;
  const state = props.controller.state;
  const node = () => props.node;
  const [width, setWidth] = createSignal(0);
  const labels = createMemo(() => [1, 2].map(value => {
    const label = state.strings.sampleFilter.replaceAll('{0}', value);
    const separator = label.indexOf(':');
    return { label, name: label.slice(0, separator + 1), value: label.slice(separator + 1).trimStart(),
      width: designCaptionWidth(label, node().presentation.font) };
  }));
  const alignment = () => ({ Left: 'start', Center: 'center', Right: 'end' })[scalar(node(), 'HorizontalLocation')];
  onMount(() => {
    if (!props.standalone) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(strip);
    onCleanup(() => observer.disconnect());
  });
  const chipWidth = label => {
    if (state.os !== 'linux' || label.width === undefined) return;
    const maximum = props.standalone && width() > 0 ? Math.max(28, Math.floor((width() - 20) / 2)) : Infinity;
    return Math.min(label.width + 28, maximum);
  };
  const style = () => ({
    ...font(node().presentation.font, state.os),
    color: flag(node(), 'Enabled') ? color(node().presentation.foreground) : '#aaa',
    'background-color': property(node(), 'BackColor') ? color(node().presentation.background) : undefined,
    'justify-content': alignment(),
  });
  return <div ref={strip} class="taxi-table-search-controls" classList={{ 'taxi-view-status--standalone': props.standalone }}
    data-element={node().key} data-view-status="" style={style()}
    onClick={event => { event.stopPropagation(); props.controller.select(node()); }}>
    <For each={labels()}>{label => <ViewStatusChip label={label} width={chipWidth(label)}
      preferred={label.width === undefined ? 0 : label.width + 28} font={node().presentation.font}
      foreground={!!property(node(), 'TextColor')} active={flag(node(), 'Enabled')} controller={props.controller}/>}</For>
  </div>;
}

/** The Configurator shows sample filter conditions, including on an empty PDF. */
export function ViewStatus(props) {
  return <Show when={viewStatusAddition(props.node)}>{addition => <StatusStrip node={addition()} controller={props.controller}/>}</Show>;
}

export function StandaloneAddition(props) {
  return <Switch>
    <Match when={props.node.kind === 'SearchStringAddition'}><TableSearch node={props.node} controller={props.controller} placement="standalone"/></Match>
    <Match when={props.node.kind === 'SearchControlAddition'}><SearchControl node={props.node} controller={props.controller} standalone/></Match>
    <Match when={props.node.kind === 'ViewStatusAddition'}><StatusStrip node={props.node} controller={props.controller} standalone/></Match>
  </Switch>;
}
