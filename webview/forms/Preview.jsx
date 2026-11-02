import { For, Show, Switch, Match, createMemo } from 'solid-js';
import { caption, scalar, flag, number, font, color, fieldStyle, fieldValue, text, automaticCommands } from './model.mjs';
import { Table } from './Table.jsx';
import { SpecialField } from './SpecialField.jsx';

export function Icon(props) {
  return <svg class="taxi-icon" viewBox="0 0 16 16" aria-hidden="true"><Switch fallback={<><rect x="2" y="2" width="12" height="12" rx="1" fill="#fff" stroke="#999"/><path d="M4 5h8M4 8h8M4 11h5" stroke="#658996"/></>}>
    <Match when={/Add|Create|Plus/.test(props.name)}><circle cx="8" cy="8" r="6" fill="#82ad59" stroke="#587f31"/><path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2"/></Match>
    <Match when={/Delete|Remove/.test(props.name)}><path d="M4 4l8 8M12 4l-8 8" stroke="#c64b34" stroke-width="2"/></Match>
    <Match when={/Write|Save/.test(props.name)}><path d="M2 2h11l1 1v11H2z" fill="#67a4bf" stroke="#567d90"/><path d="M4 2h6v4H4zM4 9h8v5H4z" fill="#fff" stroke="#83979f"/></Match>
    <Match when={/Refresh/.test(props.name)}><path d="M13 7a5 5 0 1 0-1 5" fill="none" stroke="#618741" stroke-width="2"/><path d="M9 6h5V2" fill="none" stroke="#618741" stroke-width="2"/></Match>
    <Match when={/MoveUp/.test(props.name)}><path d="M8 2L3 7h3v6h4V7h3z" fill="#3ea4d1" stroke="#257dab" stroke-width=".7"/></Match>
    <Match when={/MoveDown/.test(props.name)}><path d="M6 3v6H3l5 5 5-5h-3V3z" fill="#3ea4d1" stroke="#257dab" stroke-width=".7"/></Match>
    <Match when={/Up|Back/.test(props.name)}><path d="M12 3L4 8l8 5z" fill="#729ab0"/></Match>
    <Match when={/Down|Forward/.test(props.name)}><path d="M4 3l8 5-8 5z" fill="#729ab0"/></Match>
    <Match when={/Copy/.test(props.name)}><rect x="2" y="2" width="9" height="10" fill="#fff" stroke="#829fb0"/><rect x="5" y="5" width="9" height="10" fill="#fff" stroke="#829fb0"/></Match>
    <Match when={/Help/.test(props.name)}><text x="8" y="13" text-anchor="middle" font-size="15" fill="#424242">?</text></Match>
  </Switch></svg>;
}
function Picture(props) {
  const picture = () => props.node.presentation.picture;
  const image = () => props.controller.state.model.assets.find(asset => asset.id === picture()?.source)?.picture;
  return <Switch><Match when={picture()?.kind === 'standard'}><Icon name={picture().name}/></Match>
    <Match when={picture()?.kind === 'common' && image()}><img class="taxi-picture-resource" src={`data:${image().mimeType};base64,${image().data}`} alt="" draggable="false"/></Match>
  </Switch>;
}
export function CommandButton(props) {
  const label = () => props.label ?? caption(props.node, props.controller.state);
  const link = () => props.node && scalar(props.node, 'Type') === 'Hyperlink';
  const representation = () => props.iconOnly ? 'Picture' : props.node ? scalar(props.node, 'Representation', 'Auto') : 'Auto';
  const picture = () => props.picture ?? props.node?.presentation.picture;
  return <button type="button" classList={{ 'taxi-button': true, 'taxi-button--default': props.primary || props.node && flag(props.node, 'DefaultButton', false),
    'taxi-button--icon-only': props.iconOnly, 'taxi-button--dropdown': props.dropdown, 'taxi-button--help': props.help, 'taxi-button--link': link(), 'taxi-button--bar': props.bar, 'taxi-button--picture': representation() === 'Picture' }}
    style={props.node ? { ...font(props.node.presentation.font, props.controller.state.os), color: color(props.node.presentation.foreground), 'background-color': color(props.node.presentation.background), width: number(props.node, 'Width') > 0 ? `${number(props.node, 'Width') * 8 + 4}px` : undefined } : {}}
    title={label()} aria-label={label()} aria-disabled={props.node && !flag(props.node, 'Enabled')} onClick={event => { event.stopPropagation(); if (props.node) props.controller.select(props.node); }}>
    <Show when={picture() && representation() !== 'Text'}><Show when={props.node && !props.picture} fallback={<Icon name={props.picture}/>}><Picture node={props.node} controller={props.controller}/></Show></Show><Show when={representation() !== 'Picture'}>{label()}</Show>
    <Show when={props.dropdown}><span class="taxi-down">▾</span></Show>
  </button>;
}
function hasRootCommands(node) {
  return (node.presentation.autoCommandItems?.length ?? node.presentation.autoCommands.length) > 0
    || node.auxiliary.some(node => node.kind === 'AutoCommandBar' && node.children.some(child => child.presentation.displayed));
}
function RootCommands(props) {
  const state = props.controller.state, node = () => props.node;
  const bar = () => node().auxiliary.find(node => node.kind === 'AutoCommandBar');
  const commands = () => automaticCommands(node());
  return <Show when={scalar(node(), 'CommandBarLocation') !== 'None' && hasRootCommands(node())}>
    <div class="taxi-root-commands"><For each={commands()}>{item => <CommandButton controller={props.controller} label={text(item.caption,state.locale,state.strings)} primary={item.primary}/>}</For>
      <For each={bar()?.children.filter(node => node.presentation.displayed) ?? []}>{node => <Element node={node} controller={props.controller}/>}</For>
      <div class="taxi-command-spacer"/><CommandButton controller={props.controller} label={state.strings.more} dropdown/><CommandButton controller={props.controller} label="?" help/>
    </div>
  </Show>;
}
export function Preview(props) {
  const state = props.controller.state, root = () => state.model.root;
  const width = () => number(root(), 'Width');
  return <div class="preview-scroll" aria-label={state.strings.preview}>
    <div class="taxi-preview" data-os={state.os} data-profile="taxi-8.3.27" style={{ zoom: state.ui.zoom / 100 }}>
      <div class="taxi-form-frame" classList={{ 'taxi-selected': state.selected === root().key }} style={{ ...font(root().presentation.font, state.os), width: width() > 0 ? `${width() * 10.5}px` : 'max-content', 'min-width': '28px' }}
        onClick={() => props.controller.select(root())}>
        <div class="taxi-form-title">{caption(root(), state)}</div>
        <div class="taxi-form-content" classList={{ "taxi-form-content--commands": scalar(root(), "CommandBarLocation") !== "None" && hasRootCommands(root()) }} style={{ 'background-color': color(root().presentation.background), color: color(root().presentation.foreground) }}>
          <RootCommands node={root()} controller={props.controller}/><Items node={root()} controller={props.controller}/>
        </div>
      </div>
    </div>
  </div>;
}
export function Items(props) {
  const horizontal = () => ['Horizontal', 'HorizontalIfPossible'].includes(props.node.presentation.grouping);
  return <div classList={{ 'taxi-items': true, 'taxi-items--horizontal': horizontal(), 'taxi-items--vertical': !horizontal(), 'taxi-items--wrap': props.node.presentation.grouping === 'HorizontalIfPossible' }}>
    <For each={props.node.children}>{node => <Element node={node} controller={props.controller}/>}</For>
  </div>;
}
function Pages(props) {
  const node = () => props.node, state = props.controller.state;
  const pages = () => node().children.filter(node => node.presentation.displayed);
  const selected = () => state.ui.pages[node().key] ?? pages()[0]?.key;
  const page = createMemo(() => pages().find(page => page.key === selected()) ?? pages()[0]);
  return <div class="taxi-pages" data-representation={scalar(node(), 'PagesRepresentation', 'TabsOnTop')}>
    <Show when={scalar(node(), 'PagesRepresentation') !== 'None'}><div class="taxi-tabs" role="tablist"><For each={pages()}>{page => <button type="button" role="tab" aria-selected={page.key === selected()} classList={{ active: page.key === selected() }} onClick={event => { event.stopPropagation(); props.controller.ui('pages', { ...state.ui.pages, [node().key]: page.key }); props.controller.select(page); }}>{caption(page, state)}</button>}</For></div></Show>
    <Show when={page()}>{value => <div role="tabpanel" class="taxi-page"><Items node={value()} controller={props.controller}/></div>}</Show>
  </div>;
}
function Group(props) {
  const node = () => props.node, state = props.controller.state;
  const collapsed = () => state.ui.collapsed[node().key] ?? (scalar(node(), 'Behavior') === 'Collapsible' && flag(node(), 'Collapsed', false));
  const title = () => flag(node(), 'ShowTitle', node().kind !== 'Page' && scalar(node(), 'Representation') !== 'None');
  return <Switch>
    <Match when={node().kind === 'Pages'}><Pages {...props}/></Match>
    <Match when={['CommandBar', 'ButtonGroup', 'Popup'].includes(node().kind)}><div class="taxi-command-bar"><For each={node().children}>{child => <Element node={child} controller={props.controller} bar/>}</For><Show when={node().kind === 'Popup'}><span>▾</span></Show></div></Match>
    <Match when={true}><div class="taxi-group" classList={{ 'taxi-group--border': scalar(node(), 'Representation') === 'WeakSeparation' || scalar(node(), 'Representation') === 'StrongSeparation' }}>
      <Show when={title()}><div class="taxi-group-title" style={{ ...font(node().presentation.titleFont, state.os), color: color(node().presentation.titleColor) }}>
        <Show when={scalar(node(), 'Behavior') === 'Collapsible'}><button type="button" aria-expanded={!collapsed()} onClick={event => { event.stopPropagation(); props.controller.ui('collapsed', { ...state.ui.collapsed, [node().key]: !collapsed() }); }}>{collapsed() ? '▸' : '▾'}</button></Show>{caption(node(), state)}
      </div></Show><Show when={!collapsed()}><Items {...props}/></Show>
    </div></Match>
  </Switch>;
}
function Input(props) {
  const node = () => props.node, state = props.controller.state;
  const kind = () => node().presentation.valueType.kind;
  const multiline = () => flag(node(), 'MultiLine', false);
  return <div class="taxi-input" classList={{ 'taxi-input--incomplete': node().presentation.markIncomplete === true }} style={{ ...fieldStyle(node()), height: multiline() ? `${Math.max(2, number(node(), 'Height', 3)) * 20}px` : undefined,
    color: color(node().presentation.foreground), 'background-color': color(node().presentation.background), 'border-color': color(node().presentation.border) }}>
    <Switch><Match when={multiline()}><textarea readOnly value={fieldValue(node())} aria-label={caption(node(), state)} tabIndex="-1"/></Match>
      <Match when={true}><input readOnly value={fieldValue(node())} aria-label={caption(node(), state)} tabIndex="-1" style={{ 'text-align': scalar(node(), 'HorizontalAlign', kind() === 'number' ? 'Right' : 'Left').toLowerCase() }}/></Match></Switch>
    <Show when={flag(node(), 'ChoiceButton', kind() === 'reference' || kind() === 'date' || kind() === 'composite')}><span class="taxi-input-button">{kind() === 'date' ? <Icon name="Calendar"/> : '▾'}</span></Show>
    <Show when={flag(node(), 'OpenButton', kind() === 'reference')}><span class="taxi-input-button"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4h5v6H1V4zm3-3h6v6H5z" fill="none" stroke="#777"/></svg></span></Show>
    <Show when={flag(node(), 'ClearButton', false)}><span class="taxi-input-button">×</span></Show>
    <Show when={flag(node(), 'SpinButton', false)}><span class="taxi-input-button taxi-spin">▴<br/>▾</span></Show>
  </div>;
}
function Field(props) {
  const node = () => props.node, state = props.controller.state;
  const titleLocation = () => node().presentation.titleLocation;
  const title = () => caption(node(), state);
  const control = () => <Switch fallback={<SpecialField node={node()} controller={props.controller}/>}>
    <Match when={node().kind === 'InputField'}><Input {...props}/></Match>
    <Match when={node().kind === 'CheckBoxField'}><span role="checkbox" aria-checked="false" class="taxi-checkbox"/></Match>
    <Match when={node().kind === 'RadioButtonField'}><span class="taxi-radios" style={{ 'flex-direction': scalar(node(), 'Orientation', 'Horizontal') === 'Vertical' ? 'column' : 'row' }}><For each={node().presentation.choices.length ? node().presentation.choices : [1, 2, 3].map(value => ({ kind: 'name', text: state.strings.sampleValue.replace('{0}', value) }))}>{(choice, index) => <span><i classList={{ 'taxi-radio': true, checked: index() === 0 }}/>{text(choice, state.locale, state.strings)}</span>}</For></span></Match>
    <Match when={node().kind === 'LabelField'}><span class="taxi-label-field" style={fieldStyle(node())}>{fieldValue(node())}</span></Match>
    <Match when={node().kind === 'ProgressBarField'}><span class="taxi-progress" style={fieldStyle(node())}><i/></span></Match>
    <Match when={node().kind === 'TrackBarField'}><span class="taxi-track" style={fieldStyle(node())}><i/><b/></span></Match>
    <Match when={node().kind === 'PictureField'}><span class="taxi-picture-field" style={{ width: `${number(node(), 'Width') > 0 ? number(node(), 'Width') * 8 : 122}px`, height: `${number(node(), 'Height') > 0 ? number(node(), 'Height') * 20 : 120}px` }}><Picture node={node()} controller={props.controller}/></span></Match>
    <Match when={node().kind === 'PeriodField'}><span class="taxi-period"><Input {...props}/><span>—</span><Input {...props}/></span></Match>
  </Switch>;
  return <div class="taxi-field-row" data-title-location={titleLocation()} classList={{ 'taxi-field-row--check': node().kind === 'CheckBoxField' && titleLocation() === 'Right', 'taxi-field-row--large': !['InputField', 'CheckBoxField', 'RadioButtonField', 'LabelField', 'ProgressBarField', 'TrackBarField', 'PeriodField'].includes(node().kind) }}>
    <Show when={titleLocation() !== 'None'}><label class="taxi-field-label" style={{ ...font(node().presentation.titleFont, state.os), color: color(node().presentation.titleColor) }}>{title()}{title() && !(node().kind === 'CheckBoxField' && titleLocation() === 'Right') ? ':' : ''}</label></Show>
    <div class="taxi-field-control">{control()}</div>
  </div>;
}
export function Element(props) {
  const node = () => props.node, state = props.controller.state;
  const group = () => ['UsualGroup', 'Page', 'Pages', 'ColumnGroup', 'CommandBar', 'ButtonGroup', 'Popup'].includes(node().kind);
  return <Show when={node().presentation.displayed}><div data-element={node().key} data-kind={node().kind} classList={{ 'taxi-element': true, 'taxi-element--field': node().kind?.endsWith('Field'), 'taxi-selected': state.selected === node().key, 'taxi-disabled': !flag(node(), 'Enabled'), 'taxi-element--stretch': flag(node(), 'HorizontalStretch', false) }}
    style={{ ...font(node().presentation.font, state.os), color: color(node().presentation.foreground) }}
    onClick={event => { event.stopPropagation(); props.controller.select(node()); }} onDblClick={event => { event.stopPropagation(); props.controller.post({ type: 'locate', target: { kind: 'element', identity: node().identity } }); }}>
    <Switch fallback={<div class="taxi-unsupported">{state.strings.unsupported}: {node().xmlName.name}</div>}>
      <Match when={group()}><Group {...props}/></Match>
      <Match when={node().kind === 'Table'}><Table node={node()} controller={props.controller}/></Match>
      <Match when={node().kind === 'Button'}><CommandButton {...props}/></Match>
      <Match when={node().kind === 'LabelDecoration'}><span classList={{ 'taxi-label': true, 'taxi-hyperlink': flag(node(), 'Hyperlink', false) }} style={{ ...font(node().presentation.font, state.os), color: color(node().presentation.foreground), 'white-space': flag(node(), 'Wrap', true) ? 'normal' : 'nowrap' }}>{caption(node(), state)}</span></Match>
      <Match when={node().kind === 'PictureDecoration'}><span class="taxi-picture-decoration"><Picture node={node()} controller={props.controller}/></span></Match>
      <Match when={node().kind?.endsWith('Field')}><Field {...props}/></Match>
      <Match when={node().kind?.endsWith('Addition')}><span class="taxi-addition"><Show when={node().kind !== 'ViewStatusAddition'}><input readOnly placeholder={state.strings.search} tabIndex="-1"/></Show></span></Match>
    </Switch>
  </div></Show>;
}
