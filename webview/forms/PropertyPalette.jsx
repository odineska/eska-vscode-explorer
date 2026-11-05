import { For, Show, Switch, Match } from 'solid-js';
import { PropertyValue } from './PropertyValue.jsx';

function caption(value, state) {
  return value?.[state.locale.startsWith('ru') ? 'ru-RU' : 'en-US'];
}

function Row(props) {
  const row = () => props.row;
  const value = () => row().value;
  const state = props.state;
  const field = () => value().kind === 'declared' ? props.node.properties[value().propertyIndex] : undefined;
  const xmlKey = () => field()?.key ?? (value().kind === 'qualifier' ? value().key : undefined);
  const label = () => caption(row().caption ?? field()?.caption, state) ?? xmlKey()?.name ?? row().id;
  const declaredSource = () => value().sourceKind === 'extension' ? state.strings.paletteExtension : state.strings.paletteForm;
  const source = () => {
    switch (value().kind) {
      case 'declared': return declaredSource();
      case 'qualifier': return `${state.strings.paletteQualifier} · ${declaredSource()}`;
      case 'absent': return state.strings.paletteDefault;
      default: return state.strings.paletteIntrinsic;
    }
  };
  const target = () => {
    if (state.phase !== 'ready') return;
    if (field()) return { kind: 'property', property: field().key, occurrence: value().occurrence };
    if (value().kind === 'qualifier') return { kind: 'attribute', attribute: value().key };
  };
  const locate = () => { const selection = target(); if (selection) props.locate(selection); };
  return <tr data-palette-id={row().id} data-palette-source={value().sourceKind ?? value().kind}
    data-property-name={xmlKey()?.name} data-property-namespace={xmlKey() ? xmlKey().namespace ?? '' : undefined}
    tabindex={target() ? '0' : undefined}
    title={xmlKey() ? `{${xmlKey().namespace ?? ''}}${xmlKey().name} — ${source()}` : source()}
    onDblClick={event => { if (!event.target.closest('summary,button,input')) locate(); }}
    onKeyDown={event => { if (target() && event.target === event.currentTarget && ['F12', 'Enter'].includes(event.key)) { event.preventDefault(); locate(); } }}>
    <th>{label()}</th><td classList={{ 'form-property-default': value().kind === 'absent' }}>
      <Switch>
        <Match when={field()}><PropertyValue field={field()} state={state}/></Match>
        <Match when={value().kind === 'absent' && value().default.kind === 'boolean'}>
          <input type="checkbox" disabled checked={value().default.value} aria-label={label()}/>
        </Match>
        <Match when={value().kind === 'absent'}>{caption(value().caption, state) ?? value().default.value}</Match>
        <Match when={value().kind === 'qualifier'}>{value().text}</Match>
        <Match when={true}>{caption(value().caption, state) ?? value().value ?? state.strings.form}</Match>
      </Switch>
    </td>
  </tr>;
}

export function PropertyPalette(props) {
  const rows = category => props.palette.rows.filter(row => row.category === category);
  const render = row => <Row row={row} node={props.node} state={props.state} locate={props.locate}/>;
  return <>
    <For each={props.palette.categories}>{category => <>
      <tr class="form-property-category"><th colspan="2">{caption(category.caption, props.state)}</th></tr>
      <For each={rows(category.id)}>{render}</For>
    </>}</For>
    <Show when={rows(null).length}>
      <tr class="form-property-category"><th colspan="2">{props.state.strings.paletteXml}</th></tr>
      <For each={rows(null)}>{render}</For>
    </Show>
  </>;
}
