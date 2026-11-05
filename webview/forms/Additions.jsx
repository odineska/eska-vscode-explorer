import { For, Show } from 'solid-js';
import { viewStatusAddition } from './model.mjs';

/** The Configurator shows sample filter conditions, including on an empty PDF. */
export function ViewStatus(props) {
  const state = props.controller.state, addition = () => viewStatusAddition(props.node);
  return <Show when={addition()}><div class="taxi-table-search-controls" data-element={addition().key} onClick={event => { event.stopPropagation(); props.controller.select(addition()); }}>
    <For each={[1, 2]}>{value => <span>{state.strings.sampleFilter.replaceAll('{0}', value)}<i>×</i></span>}</For>
  </div></Show>;
}
