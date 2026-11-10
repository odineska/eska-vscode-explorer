import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { PropertyPalette } from './PropertyPalette.jsx';
import { PropertyValue } from './PropertyValue.jsx';
import { DataTypeLabel } from './InspectorLists.jsx';
import { InspectorIcon, InspectorIconButton, dataGlyph, nodeGlyph } from './InspectorIcon.jsx';
import { FORM_NS, key } from './model.mjs';
import { inspectorType, inspectorTypeDetails, technicalType } from './inspector-type.mjs';

const attributes = new Set(['Type', 'DataPath', 'Columns', 'MainAttribute', 'UseAlways', 'CommandName', 'Action', 'ParameterType']);
const behavior = new Set(['Enabled', 'Visible', 'ReadOnly', 'EditMode', 'ChoiceMode', 'AutoFill', 'Use', 'AllowInCustomizableForm']);
const main = new Set(['Name', 'Title', 'Description', 'ToolTip', 'Picture']);

function category(field) {
  const { namespace, name } = field.key;
  if (namespace !== FORM_NS) return 'propertyAdditional';
  if (attributes.has(name)) return 'propertyData';
  if (behavior.has(name)) return 'propertyBehavior';
  if (main.has(name)) return 'propertyMain';
  if (name === 'Events') return 'events';
  if (/^(?:AutoMax|MinWidth|MaxWidth|Width|MinHeight|MaxHeight|Height|Horizontal|Vertical|Group|United|ThroughAlign|TitleLocation)/u.test(name)) return 'propertyLayout';
  return 'propertyAdditional';
}

function DeclaredProperties(props) {
  const groups = createMemo(() => {
    const result = new Map();
    for (const field of props.fields) {
      const group = category(field);
      if (!result.has(group)) result.set(group, []);
      result.get(group).push(field);
    }
    return result;
  });
  const state = props.state;
  const source = field => {
    if (!props.locate || state.phase !== 'ready') return;
    const occurrence = props.fields.slice(0, props.fields.indexOf(field))
      .filter(item => item.key.name === field.key.name && item.key.namespace === field.key.namespace).length;
    props.locate({ kind: 'property', property: field.key, occurrence });
  };
  return <For each={['propertyMain', 'propertyLayout', 'propertyBehavior', 'propertyData', 'events', 'propertyAdditional']}>{group =>
    <Show when={groups().get(group)?.length}>
      <tr class="form-declared-category"><th colspan="2">{state.strings[group]}</th></tr>
      <For each={groups().get(group)}>{field => <tr tabIndex={props.locate ? 0 : undefined}
        data-property-name={field.key.name} data-property-namespace={field.key.namespace ?? ''} data-palette-source="declared"
        title={`{${field.key.namespace ?? ''}}${field.key.name} · ${state.strings.paletteForm}`}
        onDblClick={event => { if (!event.target.closest('summary,button,input')) source(field); }}
        onKeyDown={event => {
          if (event.target === event.currentTarget && props.locate && ['F12', 'Enter'].includes(event.key)) { event.preventDefault(); source(field); }
        }}>
        <th>{field.caption?.[state.locale.startsWith('ru') ? 'ru-RU' : 'en-US'] ?? field.key.name}</th>
        <td><PropertyValue field={field} state={state}/></td>
      </tr>}</For>
    </Show>
  }</For>;
}

function TypeDetails(props) {
  const strings = () => props.state.strings;
  const technical = createMemo(() => technicalType(props.field, props.valueType));
  const [open, setOpen] = createSignal(false);
  const members = () => inspectorTypeDetails(props.field, props.valueType, props.state.locale, strings());
  return <Show when={technical()}><details class="form-type-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{strings().fullType}</summary>
    <Show when={open()}>
      <ul class="form-type-members" aria-label={strings().fullType}>
        <For each={members()}>{member => <li class="form-type-member">
          <div class="form-type-member-title">
            <InspectorIcon name="data"/>
            <div class="form-truncate" title={[member.category, member.label].filter(Boolean).join('.')}>
              <Show when={member.category}><small>{member.category}.</small></Show><strong>{member.label}</strong>
            </div>
          </div>
          <Show when={member.facts.length}><dl class="form-type-facts">
            <For each={member.facts}>{fact => <div><dt>{fact.label}</dt><dd>{fact.value}</dd></div>}</For>
          </dl></Show>
        </li>}</For>
      </ul>
      <div class="form-type-source">
        <details><summary>{strings().technicalType}</summary><pre tabIndex="0">{technical()}</pre></details>
        <InspectorIconButton icon="copy" label={strings().copyType} onClick={() => props.copy(technical())}/>
      </div>
    </Show>
  </details></Show>;
}

export function PropertyInspector(props) {
  const c = props.controller, state = c.state;
  const node = () => props.selected?.node ?? state.model.root;
  const data = () => props.activeData;
  const related = () => props.relatedData;
  const type = createMemo(() => {
    const row = data() ?? related();
    if (row?.type) return row.type;
    if (data() || !props.selected?.binding) return undefined;
    return inspectorType(undefined, node().presentation.valueType, state.locale, state.strings);
  });
  const handlers = createMemo(() => state.handlerNavigation ? props.index.handlers.get(data()?.id ?? node().key) ?? [] : []);
  const palette = createMemo(() => !data() && state.palette?.revision === state.revision && state.palette?.formSessionId === state.formSessionId
    && key({identity: state.palette.identity}) === node().key ? state.palette : null);
  const locate = target => c.post({ type: 'locate', revision: state.revision, formSessionId: state.formSessionId,
    target: { ...target, identity: node().identity } });
  const openHandler = index => c.post({ type: 'handler', index });

  const paletteHandlers = createMemo(() => {
    const links = new Map();
    for (const row of palette()?.rows ?? []) {
      const value = row.value;
      if (value.kind !== 'declaredEvent') continue;
      const field = node().properties[value.propertyIndex];
      const name = field?.value.fields?.[value.entryIndex]?.value.text.trim();
      if (name === undefined) continue;
      const origin = field.origin;
      const link = handlers().find(({ handler }) => row.id === `platform:${handler.event}`
        && handler.name === name && handler.origin.source === origin.source
        && handler.origin.range.start === origin.range.start && handler.origin.range.end === origin.range.end);
      if (link) links.set(row.id, link);
    }
    return links;
  });
  const extraHandlers = createMemo(() => {
    const linked = new Set([...paletteHandlers().values()].map(entry => entry.index));
    return handlers().filter(entry => !linked.has(entry.index));
  });
  const [usageLimit, setUsageLimit] = createSignal(40);
  createEffect(on(() => data()?.id, () => setUsageLimit(40)));
  const usages = createMemo(() => {
    const row = data();
    if (row?.section === 'attributes') return props.index.usages.get(row.path) ?? [];
    if (row?.section === 'commands') return props.index.commandUses.get(row.name) ?? [];
    return [];
  });
  const kind = () => {
    const row = data();
    if (row) return state.strings[row.section === 'commands' ? 'commandKind' : row.section === 'parameters' ? 'parameterKind'
      : row.main ? 'primaryAttribute' : row.depth ? 'dataField' : 'attributeKind'];
    return state.strings[`elementKind.${node().kind}`] ?? node().kind ?? node().xmlName.name;
  };
  const path = () => data()?.path ?? props.selected?.path;
  const typeSource = () => data() ?? related();
  const contextFields = createMemo(() => {
    const row = data();
    return row?.definition?.properties.filter(field => field !== row.typeField) ?? [];
  });
  const canShow = () => !data() && node().presentation.displayed !== false;
  const canLocate = () => state.phase === 'ready' && (!data() || props.canLocateData(data()));

  return <section class="form-pane form-pane--properties" aria-label={state.strings.properties}>
    <header class="form-pane-heading"><h2>{state.strings.properties}</h2></header>
    <div class="form-table-scroll form-property-scroll">
      <div class="form-property-context">
        <div class="form-context-kind"><InspectorIcon name={data() ? dataGlyph(data(), props.index) : nodeGlyph(node().kind)}/>{kind()}</div>
        <h3 title={data()?.name ?? props.selected?.label}>{data()?.label ?? props.selected?.label ?? state.strings.form}</h3>
        <Show when={path()}><div class="form-context-path" title={path()}>{data()?.displayPath ?? path()}</div></Show>
        <div class="form-property-actions">
          <Show when={canShow()}><button type="button" onClick={() => props.showOnForm(node())}><InspectorIcon name="preview"/>{state.strings.showOnForm}</button></Show>
          <Show when={canLocate()}><button type="button" onClick={() => data() ? props.locateData(data()) : locate({ kind: 'element' })}><InspectorIcon name="xml"/>{state.strings.source}</button></Show>
          <Show when={!data() && !related() && node().presentation.binding}><button type="button" onClick={() => locate({ kind: 'binding' })}>{state.strings.binding}</button></Show>
        </div>
        <Show when={!data() && props.selected?.binding}><dl class="form-context-facts"><div>
          <dt>{state.strings.dataPath}</dt>
          <dd><Show when={related()} fallback={<code>{props.selected.binding}</code>}>
            <button type="button" class="form-handler" title={`${state.strings.showInData} · ${props.selected.binding}`} onClick={() => props.showData(related())}>{related().displayPath}</button>
          </Show></dd>
        </div></dl></Show>
        <Show when={!data() && props.selected?.command && related()}><button type="button" class="form-handler" onClick={() => props.showData(related())}>{related().name}</button></Show>
        <Show when={data()?.action}><dl class="form-context-facts"><div><dt>{state.strings.action}</dt><dd>{data().action}</dd></div></dl></Show>
        <Show when={type()}><dl class="form-context-facts"><div><dt>{state.strings.type}</dt><dd><DataTypeLabel type={type()} pluralRules={props.pluralRules} strings={state.strings}/></dd></div></dl>
          <TypeDetails state={state} field={typeSource()?.typeField} valueType={typeSource()?.valueType ?? (!data() ? node().presentation.valueType : undefined)} copy={props.copy}/>
        </Show>
      </div>
      <Show when={usages().length}><section class="form-usage-list" aria-label={state.strings.usages}>
        <h4>{state.strings.usages} <span>{usages().length}</span></h4>
        <For each={usages().slice(0, usageLimit())}>{row =>
          <button type="button" class="form-link" title={row.path} onClick={() => props.showElement(row)}>
            <InspectorIcon name={nodeGlyph(row.node.kind)}/><span class="form-truncate">{row.label}</span>
          </button>
        }</For>
        <Show when={usages().length > usageLimit()}>
          <button type="button" class="form-link" onClick={() => setUsageLimit(limit => limit + 40)}>{state.strings.moreUses}</button>
        </Show>
      </section></Show>
      <table class="form-properties"><tbody>
        <Show when={data()} fallback={<Show when={palette()?.rows} fallback={
          <DeclaredProperties fields={node().properties} state={state} locate={locate}/>
        }>
          <PropertyPalette palette={palette()} node={node()} state={state} locate={locate}
            handlers={paletteHandlers()} openHandler={openHandler}/>
        </Show>}>
          <DeclaredProperties fields={contextFields()} state={state}/>
        </Show>
        <Show when={extraHandlers().length}><tr class="form-declared-category"><th colspan="2">{state.strings.events}</th></tr></Show>
        <For each={extraHandlers()}>{entry =>
          <tr class="form-event"><th>{entry.handler.event}</th><td><button class="form-handler" type="button" title={state.strings.handler}
            onClick={() => openHandler(entry.index)}>{entry.handler.name}</button></td></tr>
        }</For>
      </tbody></table>
    </div>
  </section>;
}
