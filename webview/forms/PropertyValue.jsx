import { For, Show, Switch, Match, createSignal, createMemo } from 'solid-js';
import { booleanValue, translated, summary, localizedEntries } from '../../resources/properties/model.mjs';
import { localizedProperty, text } from './model.mjs';

/** Keep records, repeats and annotations inspectable; the backend owns their captions and scalar types. */
export function PropertyValue(props) {
  const [expanded, setExpanded] = createSignal(false);
  const language = () => props.state.locale.startsWith('ru') ? 'ru-RU' : 'en-US';
  const value = () => props.field.value;
  const boolean = () => booleanValue(value());
  const localizations = createMemo(() => localizedEntries(value()));
  const localizedSummary = () => text({ kind: 'literal', items: localizations() }, props.state.locale)
    .replace(/\s+/gu, ' ').slice(0, 140);
  const fields = () => value().kind === 'record' ? value().fields : [];
  return <div class="form-property-value">
    <Switch>
      <Match when={boolean() !== undefined}><input type="checkbox" disabled checked={boolean()} aria-label={translated(props.field, language(), props.field.key.name)} title={value().text}/></Match>
      <Match when={localizations() !== undefined && localizations().length < 2}><span>{localizations()[0]?.content ?? ''}</span></Match>
      <Match when={localizations()?.length > 1}>
        <details class="form-property-record form-property-localized" onToggle={event => setExpanded(event.currentTarget.open)}><summary>{localizedSummary() || props.state.strings.details}</summary>
          <Show when={expanded()}><dl><For each={localizations()}>{item => <div><dt>{item.language}</dt><dd>{item.content}</dd></div>}</For></dl></Show>
        </details>
      </Match>
      <Match when={value().kind === 'record' && fields().length}>
        <details class="form-property-record" onToggle={event => setExpanded(event.currentTarget.open)}><summary>{summary(props.field, language()) || props.state.strings.details}</summary>
          <Show when={expanded()}><dl><For each={fields()}>{child => <div>
            <dt title={`{${child.key.namespace ?? ''}}${child.key.name}`}>{translated(child, language(), child.key.name)}</dt>
            <dd><PropertyValue field={child} state={props.state}/></dd>
          </div>}</For></dl></Show>
        </details>
      </Match>
      <Match when={true}><span>{localizedProperty(value(), props.state.locale)}</span></Match>
    </Switch>
    <Show when={props.field.qualifiers?.length}><dl class="form-property-qualifiers"><For each={props.field.qualifiers}>{qualifier => <div>
      <dt title={`{${qualifier.key.namespace ?? ''}}${qualifier.key.name}`}>{translated(qualifier, language(), qualifier.key.name)}</dt><dd>{qualifier.value}</dd>
    </div>}</For></dl></Show>
  </div>;
}
