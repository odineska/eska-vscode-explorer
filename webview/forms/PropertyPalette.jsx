import { For, Show, Switch, Match } from 'solid-js';
import { PropertyValue } from './PropertyValue.jsx';

function caption(value, state) {
  return value?.[state.locale.startsWith('ru') ? 'ru-RU' : 'en-US'];
}

function Row(props) {
  const row = () => props.row;
  const value = () => row().value;
  const state = props.state;
  const field = () => ['declared', 'declaredEvent'].includes(value().kind) ? props.node.properties[value().propertyIndex] : undefined;
  const eventText = () => value().kind === 'declaredEvent' ? field()?.value.fields?.[value().entryIndex]?.value.text : undefined;
  const handler = () => props.handlers.get(row().id);
  const xmlKey = () => field()?.key ?? (value().kind === 'qualifier' ? value().key : undefined);
  const label = () => caption(row().caption ?? field()?.caption, state) ?? xmlKey()?.name ?? row().id;
  const declaredSource = () => value().sourceKind === 'extension' ? state.strings.paletteExtension : state.strings.paletteForm;
  const source = () => {
    switch (value().kind) {
      case 'declared':
      case 'declaredEvent': return declaredSource();
      case 'qualifier': return `${state.strings.paletteQualifier} · ${declaredSource()}`;
      case 'absent': return state.strings.paletteDefault;
      default: return state.strings.paletteIntrinsic;
    }
  };
  const hint = () => {
    const key = xmlKey();
    const origin = key ? `{${key.namespace ?? ''}}${key.name} — ${source()}` : source();
    return row().available === false ? `${origin} · ${state.strings.paletteUnavailable}` : origin;
  };
  const target = () => {
    if (state.phase !== 'ready') return;
    if (field()) return { kind: 'property', property: field().key, occurrence: value().occurrence };
    if (value().kind === 'qualifier') return { kind: 'attribute', attribute: value().key };
  };
  const locate = () => { const selection = target(); if (selection) props.locate(selection); };
  return <tr classList={{ 'form-event': value().kind === 'declaredEvent' }} data-palette-id={row().id} data-palette-source={value().sourceKind ?? value().kind}
    data-property-name={value().kind === 'declaredEvent' ? 'Event' : xmlKey()?.name} data-property-namespace={xmlKey() ? xmlKey().namespace ?? '' : undefined}
    tabindex={target() ? '0' : undefined}
    data-palette-available={row().available === false ? 'false' : undefined}
    title={hint()}
    onDblClick={event => { if (!event.target.closest('summary,button,input')) locate(); }}
    onKeyDown={event => { if (target() && event.target === event.currentTarget && ['F12', 'Enter'].includes(event.key)) { event.preventDefault(); locate(); } }}>
    <th>{label()}</th><td classList={{ 'form-property-default': value().kind === 'absent' }}>
      <Switch>
        <Match when={handler()}><button class="form-handler" type="button" title={state.strings.handler} onClick={() => props.openHandler(handler().index)}>{handler().handler.name}</button></Match>
        <Match when={eventText() !== undefined}>{eventText()}</Match>
        <Match when={field()}><PropertyValue field={field()} state={state} scalarCaption={caption(value().caption, state)}/></Match>
        <Match when={value().kind === 'absent' && value().default.kind === 'boolean'}>
          <input type="checkbox" disabled checked={value().default.value} aria-label={label()}/>
        </Match>
        <Match when={value().kind === 'absent'}>{caption(value().caption, state) ?? value().default.value}</Match>
        <Match when={value().kind === 'qualifier'}><span title={value().text}>{caption(value().caption, state) ?? value().text}</span></Match>
        <Match when={true}>{caption(value().caption, state) ?? value().value ?? state.strings.form}</Match>
      </Switch>
    </td>
  </tr>;
}

export function PropertyPalette(props) {
  const rows = category => props.palette.rows.filter(row => row.category === category);
  const render = row => <Row row={row} node={props.node} state={props.state} locate={props.locate}
    handlers={props.handlers} openHandler={props.openHandler}/>;
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
