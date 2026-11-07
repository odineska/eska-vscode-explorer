import { For, Show, Switch, Match, createMemo, createSignal, createEffect, on, onMount, onCleanup } from 'solid-js';
import { caption, property, scalar, flag, number, font, color, fieldStyle, fieldValue, inputHeight, inputControlHeight, inputRowHeight, inputRows, inputChoiceButton, nativeReferenceInput, fontPixels, fontLineHeight, numericLabelMetrics, buttonMetrics, buttonBackground, text, automaticCommands } from './model.mjs';
import { Table, TableCommandActions, TableToolbarSearch } from './Table.jsx';
import { SpecialField } from './SpecialField.jsx';
import { createNativeButtonWidth } from './text-metrics.js';
import { primaryForeground } from './primary-foreground.mjs';
import { NativeCaption } from './NativeCaption.jsx';
import { NativeButtonArrow } from './NativeButtonArrow.jsx';
import { NativeLabel } from './NativeLabel.jsx';
import { RadioChoices } from './RadioChoices.jsx';
import { CheckBoxControl } from './CheckBoxControl.jsx';
import { controlCaptionWidth, designCaptionWidth, fieldCaptionProfile, linuxControlFont } from './font-metrics.mjs';
import { inputCaptionInset } from './field-caption-layout.js';
import { tabMetrics } from './tab-metrics.mjs';
import { NativeInputCalculator } from './NativeInputCalculator.jsx';
import { NativeInputCalendar } from './NativeInputCalendar.jsx';
import { NativeInputBorder } from './NativeInputBorder.jsx';
import { NativeTabBorder } from './NativeTabBorder.jsx';
import { NativeButtonBorder } from './NativeButtonBorder.jsx';
import { createNativeGroupBackdrop } from './native-group-background.js';
import { standardPicture } from './standard-pictures.mjs';
import { FormLayoutContext, createFormLayout, useFormLayout } from './responsive-layout.js';
import { displayedInPreview, stretchWeight, controlBounds, groupPreferredSize, horizontalGrouping, automaticHorizontalSpacing, horizontalInputMaximum, pictureFieldStyle, groupCanShrink, ordinaryGroup, hasAuthoredGroupHeight } from './layout-model.mjs';
import { availableTableSearchCommand, commandSourceTable, tableAdditionsProjection, tableSearch, tableSearchReference } from './table-model.mjs';
import { NativeStandardPicture, TemplatePicture } from './NativeStandardPicture.jsx';
import { menuCaption, menuChildren, menuEnabled, menuItems, menuNode, menuPicture, menuSeparator, menuShortcut, rootCommandPlacement, startsRootCommandSection, tableCommandRows } from './command-menu-model.mjs';
import { positionCommandMenu } from './command-menu-position.js';
import { rgb } from './native-control-paint.js';

export function Icon(props) {
  const drawing = createMemo(() => props.os === 'linux' ? standardPicture(props.name, props.variant) : undefined);
  return <Show when={drawing()} fallback={<BrowserIcon name={props.name}/>}>
    {image => <NativeStandardPicture image={image()}/>}
  </Show>;
}
function BrowserIcon(props) {
  return <svg class="taxi-icon" data-native-picture="browser" viewBox="0 0 16 16" aria-hidden="true"><Switch fallback={<><rect x="2" y="2" width="12" height="12" rx="1" fill="#fff" stroke="#999"/><path d="M4 5h8M4 8h8M4 11h5" stroke="#658996"/></>}>
    <Match when={/Add|Create|Plus/.test(props.name)}><circle cx="8" cy="8" r="6" fill="#82ad59" stroke="#587f31"/><path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2"/></Match>
    <Match when={/Delete|Remove/.test(props.name)}><path d="M4 4l8 8M12 4l-8 8" stroke="#c64b34" stroke-width="2"/></Match>
    <Match when={/Write|Save/.test(props.name)}><path d="M2 2h11l1 1v11H2z" fill="#67a4bf" stroke="#567d90"/><path d="M4 2h6v4H4zM4 9h8v5H4z" fill="#fff" stroke="#83979f"/></Match>
    <Match when={/Refresh/.test(props.name)}><path d="M13 7a5 5 0 1 0-1 5" fill="none" stroke="#618741" stroke-width="2"/><path d="M9 6h5V2" fill="none" stroke="#618741" stroke-width="2"/></Match>
    <Match when={/MoveUp/.test(props.name)}><path d="M8 2L3 7h3v6h4V7h3z" fill="#3ea4d1" stroke="#257dab" stroke-width=".7"/></Match>
    <Match when={/MoveDown/.test(props.name)}><path d="M6 3v6H3l5 5 5-5h-3V3z" fill="#3ea4d1" stroke="#257dab" stroke-width=".7"/></Match>
    <Match when={/Up|Back/.test(props.name)}><path d="M12 3L4 8l8 5z" fill="#729ab0"/></Match>
    <Match when={/Down|Forward/.test(props.name)}><path d="M4 3l8 5-8 5z" fill="#729ab0"/></Match>
    <Match when={/Copy|CloneListItem|CloneObject/.test(props.name)}><path d="M5 1h6l3 3v9H5zM11 1v3h3" fill="#fff" stroke="#829fb0"/><circle cx="4" cy="11" r="4" fill="#60ad48" stroke="#428931"/><path d="M4 8v6M1 11h6" stroke="#fff"/></Match>
    <Match when={/CancelSearch$/.test(props.name)}><circle cx="9" cy="6" r="3.4" fill="#fff" stroke="#2878aa" stroke-width="1.4"/><path d="m11.5 8.5 3 3" stroke="#2878aa" stroke-width="1.5"/><path d="m2 9 6 6m0-6-6 6" stroke="#c64b34" stroke-width="1.8"/></Match>
    <Match when={/Find|Search/.test(props.name)}><circle cx="6" cy="6" r="4" fill="none" stroke="#3287b7" stroke-width="1.5"/><path d="M9 9l4 4" stroke="#3287b7" stroke-width="2"/></Match>
    <Match when={/Calculator/.test(props.name)}><rect x="4" y="2" width="8" height="12" rx="1" fill="#fff" stroke="#777"/><path d="M5 4h6M5 7h1m1 0h1m1 0h1M5 9h1m1 0h1m1 0h1M5 11h1m1 0h1m1 0h1" stroke="#777"/></Match>
    <Match when={/Calendar/.test(props.name)}><rect x="3" y="3" width="10" height="10" rx="1" fill="#fff" stroke="#777"/><path d="M3 6h10M5 2v3m6-3v3M5 8h1m2 0h1m2 0h1M5 10h1m2 0h1m2 0h1" stroke="#777"/></Match>
    <Match when={/Information/.test(props.name)}><circle cx="8" cy="8" r="7" fill="#fff" stroke="#555"/><text x="8" y="12.5" text-anchor="middle" font-family="serif" font-size="14" font-style="italic" font-weight="700" fill="#555">i</text></Match>
    <Match when={/Help/.test(props.name)}><text x="8" y="13" text-anchor="middle" font-size="15" fill="#424242">?</text></Match>
  </Switch></svg>;
}
function CommonPicture(props) {
  const source = () => `data:${props.image.mimeType};base64,${props.image.data}`;
  const image = () => <img class="taxi-picture-resource" src={source()} alt="" draggable="false"/>;
  return <Show when={props.image.isTemplate} fallback={image()}>
    <TemplatePicture source={source()}/>
  </Show>;
}
function Picture(props) {
  const picture = () => props.picture ?? props.node?.presentation.picture;
  const image = () => props.controller.state.model.assets.find(asset => asset.id === picture()?.source)?.picture;
  return <Switch><Match when={picture()?.kind === 'standard'}><Icon name={picture().name} variant={props.pictureVariant} os={flag(props.node, 'Enabled') ? props.controller.state.os : undefined}/></Match>
    <Match when={picture()?.kind === 'common' && image()}>{asset => <CommonPicture image={asset()}/>}</Match>
  </Switch>;
}
export function CommandButton(props) {
  const formLayout = useFormLayout();
  let button;
  const [backgroundImage, setBackgroundImage] = createSignal();
  const [automaticForeground, setAutomaticForeground] = createSignal();
  const [borderPaint, setBorderPaint] = createSignal();
  const label = () => props.label ?? caption(props.node, props.controller.state);
  const link = () => props.node?.kind === 'Button' && ['Hyperlink', 'CommandBarHyperlink'].includes(scalar(props.node, 'Type'));
  const sourcePicture = () => props.node?.presentation.picture ?? props.command?.picture;
  const declaredMode = () => scalar(props.node, 'Representation', 'Auto');
  const cancelSearchPicture = () => declaredMode() === 'Picture' && !sourcePicture()
    && tableSearchReference(scalar(props.node, 'CommandName'))?.action === 'CancelSearch';
  const pictureName = () => props.picture ?? (cancelSearchPicture() ? 'StdPicture.CancelSearch' : undefined);
  const representation = () => {
    if (props.iconOnly || cancelSearchPicture()) return 'Picture';
    return props.node?.presentation.buttonRepresentation ?? props.command?.buttonRepresentation ?? declaredMode();
  };
  const iconOnly = () => representation() === 'Picture';
  const picture = () => representation() === 'Text' ? undefined : pictureName() ?? sourcePicture();
  const linkCalibrated = () => props.node.presentation.font.points === 10 && props.node.presentation.font.weight === 400
    && !picture() && !props.dropdown && !props.menu && flag(props.node, 'Enabled');
  const primary = () => (props.primary || flag(props.node, 'DefaultButton', false))
    && !(props.controller.state.os === 'linux' && property(props.node, 'BackColor'));
  const nativeIcon = createMemo(() => {
    if (!iconOnly()) return false;
    const value = picture();
    if (typeof value === 'string') return !!standardPicture(value, props.pictureVariant);
    return value?.kind === 'common' || value?.kind === 'standard' && !!standardPicture(value.name);
  });
  const plain = () => props.controller.state.os === 'linux' && !props.bar && !props.help && (!iconOnly() || nativeIcon()) && (!props.dropdown || props.nativeDropdown)
    && !link() && (!picture() || nativeIcon())
    && (primary() || flag(props.node, 'Enabled'));
  const background = () => props.controller.state.os === 'linux' && primary()
    ? props.controller.state.model.importantColor : props.node?.presentation.background;
  const foreground = () => automaticForeground() ?? color(props.node?.presentation.foreground);
  createEffect(on(() => [plain(), primary(), !!property(props.node, 'TextColor'), JSON.stringify(background()), JSON.stringify(props.node?.presentation.foreground), JSON.stringify(props.node?.presentation.font ?? props.controller.state.model.root.presentation.font)], ([enabled]) => {
    setBackgroundImage(undefined); setAutomaticForeground(undefined);
    if (!enabled) return;
    const draw = () => {
      const style = getComputedStyle(button), height = parseFloat(style.height) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
      const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.backgroundColor);
      const rgb = match?.slice(1).map(Number);
      setBackgroundImage(rgb ? buttonBackground(height, rgb) : undefined);
      if (rgb && primary() && !property(props.node, 'TextColor')) {
        const ink = primaryForeground(rgb);
        setAutomaticForeground(`rgb(${ink}, ${ink}, ${ink})`);
      }
    };
    const observer = new ResizeObserver(draw); observer.observe(button);
    draw();
    onCleanup(() => observer.disconnect());
  }));
  const metrics = () => {
    if (props.controller.state.os === 'linux' && link()) {
      if (scalar(props.node, 'Type') === 'Hyperlink') {
        const height = fontLineHeight(props.node.presentation.font);
        return { 'min-height': `${height + 2}px`, 'line-height': `${height}px` };
      }
      return { padding: '0 1px' };
    }
    if (props.controller.state.os === 'linux' && nativeIcon()) return { 'background-image': backgroundImage() };
    if (props.controller.state.os !== 'linux' || props.bar || props.help || iconOnly() || link()) return {};
    if(props.dropdown)return props.nativeDropdown?{'background-image':backgroundImage()}:{};
    const value = buttonMetrics(props.node?.presentation.font ?? props.controller.state.model.root.presentation.font);
    const pictureWithText = props.rootBar && !!picture() && !!label();
    const leftPadding = pictureWithText ? 5 : value.horizontalPadding;
    return { padding: `${value.verticalPadding}px ${value.horizontalPadding}px ${value.verticalPadding}px ${leftPadding}px`,
      'line-height': `${value.lineHeight}px`,
      'column-gap': pictureWithText ? '8px' : undefined, 'justify-content': pictureWithText ? 'flex-start' : undefined,
      'background-image': backgroundImage() };
  };
  const measuredWidth = createNativeButtonWidth(() => button, () => ({text:label(),os:props.controller.state.os,
    automatic:!props.help && !iconOnly() && number(props.node,'Width') <= 0,
    picture:JSON.stringify(picture()),primary:props.primary,dropdown:props.dropdown,link:link(),
    font:font(props.node?.presentation.font ?? props.controller.state.model.root.presentation.font, props.controller.state.os)}));
  createEffect(() => { measuredWidth(); formLayout?.invalidate(); });
  createEffect(() => {
    const report = props.onPreferredButtonWidth, value = measuredWidth();
    if (!report) return;
    report(value ? parseFloat(value) : undefined);
    onCleanup(() => report(undefined));
  });
  return <button ref={button} type="button" data-command-key={props.command?.key}
    data-table-search-control={props.node?.kind === 'SearchControlAddition' ? '' : undefined} data-button-type={props.node ? scalar(props.node, 'Type', 'UsualButton') : undefined} classList={{ 'taxi-button': true, 'taxi-button--default': primary(),
    'taxi-button--native-fill': plain(), 'taxi-button--native-border': !!borderPaint(),
    'taxi-button--icon-only': iconOnly(), 'taxi-button--dropdown': props.dropdown, 'taxi-button--help': props.help, 'taxi-button--link': link(), 'taxi-button--bar': props.bar, 'taxi-button--picture': iconOnly() }}
    style={{ ...(props.node ? font(props.node.presentation.font, props.controller.state.os) : {}), ...(link() ? {'text-decoration':['underline',props.node.presentation.font.strikeout && 'line-through'].filter(Boolean).join(' ')} : {}), color: foreground(), 'background-color': color(background()), ...metrics(), '--taxi-button-native-border':borderPaint() ? `rgb(${borderPaint().top.join(',')})` : undefined, '--taxi-button-native-bottom':borderPaint() ? `rgb(${borderPaint().bottom.join(',')})` : undefined, '--taxi-button-native-shadow':borderPaint() ? `rgb(${borderPaint().shadow.join(',')})` : undefined, width: number(props.node, 'Width') > 0 ? `${props.controller.state.os === 'linux' ? number(props.node, 'Width') * 10 : number(props.node, 'Width') * 8 + 4}px` : props.uniformButtonWidth ? `${props.uniformButtonWidth}px` : measuredWidth() }}
    title={label()} aria-label={label()} aria-haspopup={props.menu ? 'menu' : undefined} aria-expanded={props.menu ? props.expanded : undefined}
    aria-disabled={props.node && !flag(props.node, 'Enabled')} onClick={event => { event.stopPropagation(); if (props.node) props.controller.select(props.node); props.onClick?.(event); }}>
    <Show when={picture()}><Show when={!pictureName()} fallback={<Icon name={pictureName()} variant={props.pictureVariant} os={flag(props.node, 'Enabled') ? props.controller.state.os : undefined}/>}><Picture node={props.node} picture={sourcePicture()} controller={props.controller}/></Show></Show><Show when={!iconOnly()}><Show when={link() && props.controller.state.os === 'linux'} fallback={<NativeCaption trailingWidth={props.nativeDropdown?4:0} text={label()} enabled={plain()} button={() => button} runtime={props.controller.nativeText} font={props.node?.presentation.font ?? props.controller.state.model.root.presentation.font} foreground={foreground()} background={background()}/>}><NativeLabel text={label()} placement="buttonLink" target={() => button} enabled calibrated={linkCalibrated()} font={props.node.presentation.font} foreground={foreground()} runtime={props.controller.nativeText}/></Show></Show>
    <Show when={props.dropdown}><span class="taxi-down"><Show when={props.nativeDropdown} fallback="▾"><NativeButtonArrow controller={props.controller} button={()=>button} enabled={plain()} foreground={color(props.controller.state.model.root.presentation.foreground)}/></Show></span></Show>
    <NativeButtonBorder controller={props.controller} button={() => button} enabled={plain()} primary={primary()} paint={borderPaint()} setPaint={setBorderPaint}/>
  </button>;
}
function RootCommands(props) {
  const state = props.controller.state, placement = () => props.placement;
  return <div class="taxi-root-commands" data-root-command-overflow={placement().more ? '' : undefined}>
    <For each={placement().inline}>{(item, index) =>
      <div data-root-command="" data-root-command-section={startsRootCommandSection(placement().inline[index() - 1], item) ? '' : undefined}>
        <Show when={menuNode(item)} fallback={
          <Show when={item.items?.length} fallback={
            <CommandButton controller={props.controller} command={item} label={menuCaption(item, state)} primary={item.primary} rootBar/>
          }>
            <PopupMenu command={item} label={menuCaption(item, state)} controller={props.controller} nativeDropdown/>
          </Show>
        }>
          {node => <Element node={node()} controller={props.controller} rootBar/>}
        </Show>
      </div>
    }</For>
    <Show when={placement().more || placement().help}><div class="taxi-command-spacer"/></Show>
    <Show when={placement().more}>
      <div data-root-command-tail=""><PopupMenu rootMenu rows={placement().rows()} label={state.strings.more} controller={props.controller}/></div>
    </Show>
    <Show when={placement().help}>
      <div data-root-command-tail=""><CommandButton controller={props.controller} label="?" help/></div>
    </Show>
  </div>;
}
export function Preview(props) {
  const state = props.controller.state, root = () => state.model.root;
  const placement = createMemo(() => rootCommandPlacement(root(), state));
  const hasCommands = () => scalar(root(), 'CommandBarLocation') !== 'None' && (placement().inline.length || placement().more);
  let viewport, preview, frame;
  const layout = createFormLayout(props.controller, () => viewport, () => preview, () => frame);
  const frameStyle = () => ({
    ...font(root().presentation.font, state.os),
    width: `${Math.max(28, layout.allocation().width - 4)}px`,
    height: `${Math.max(0, layout.allocation().height - 4)}px`,
    '--taxi-form-initial-width': layout.initialWidth(),
    '--taxi-form-initial-height': layout.authoredHeight() ? `${layout.authoredHeight() - 4}px` : undefined,
    '--taxi-form-preferred-width': `${layout.preferred().width}px`,
    '--taxi-form-preferred-height': `${layout.preferred().height}px`,
    '--taxi-form-items-min-height': layout.tableFormScroll() ? `${layout.itemsMinimumHeight()}px` : undefined,
    'min-width': '28px',
  });
  return <FormLayoutContext.Provider value={layout}><div ref={viewport} class="preview-scroll" aria-label={state.strings.preview}>
    <div ref={preview} class="taxi-preview" data-form-layout="preferred" data-preferred-x={layout.atPreferred('x') ? 'true' : undefined} data-os={state.os} data-profile="taxi-8.3.27" style={{ zoom: state.ui.zoom / 100 }}>
      <div ref={frame} class="taxi-form-frame" classList={{ 'taxi-selected': state.selected === root().key }}
        data-authored-height={layout.authoredHeight() ? '' : undefined} data-native-form-scroll={layout.tableFormScroll() ? '' : undefined}
        style={frameStyle()}
        onClick={() => props.controller.select(root())}>
        <div class="taxi-form-shadow" aria-hidden="true"/>
        <div class="taxi-form-title" role="heading" aria-level="2" aria-label={caption(root(), state)}><NativeLabel enabled={state.os === 'linux'} placement="formTitle" text={caption(root(),state)} font={{points:8.25,weight:700}} runtime={props.controller.nativeText}/></div>
        <div class="taxi-form-content" classList={{ "taxi-form-content--commands": !!hasCommands() }} style={{ 'background-color': color(root().presentation.background), color: color(root().presentation.foreground) }}>
          <Show when={hasCommands()}><RootCommands placement={placement()} controller={props.controller}/></Show>
          <Items node={root()} controller={props.controller}/>
        </div>
      </div>
    </div>
  </div></FormLayoutContext.Provider>;
}
export function Items(props) {
  const layout = useFormLayout();
  const horizontal = () => horizontalGrouping(props.node) && !layout?.wrapped(props.node);
  const heightConstrained = () => props.heightConstrained || hasAuthoredGroupHeight(props.node, props.controller.state.os);
  const children = () => props.node.children.filter(displayedInPreview);
  const nativeGroup = () => props.controller.state.os === 'linux' && ordinaryGroup(props.node);
  const alignment = {Top:'start', Center:'center', Bottom:'end'};
  const inheritedAlignment = () => nativeGroup() ? alignment[scalar(props.node, 'VerticalAlign')] : undefined;
  const contentAlignment = createMemo(() => {
    if (!nativeGroup()) return;
    const nodes = children();
    const onlyChild = nodes.length === 1 && alignment[scalar(nodes[0], 'GroupVerticalAlign')];
    return onlyChild || inheritedAlignment()
      || (number(props.node, 'Height') > 0 ? 'var(--taxi-inherited-vertical-align, start)' : undefined);
  });
  const buttonRow = () => props.controller.state.os === 'linux' && props.node.presentation.grouping === 'Horizontal'
    && children().length > 0 && children().every(node => node.kind === 'Button');
  const uniform = () => buttonRow() && children().every(node => scalar(node, 'Type', 'UsualButton') === 'UsualButton' && number(node, 'Width') <= 0);
  const [widths, setWidths] = createSignal({});
  const preferred = (key, value) => setWidths(previous => {
    if (previous[key] === value) return previous;
    const result = {...previous};
    if (value === undefined) delete result[key]; else result[key] = value;
    return result;
  });
  const width = () => uniform() ? Math.max(0, ...children().map(node => widths()[node.key] ?? 0)) : undefined;
  const height = node => {
    if (scalar(node, 'Type', 'UsualButton') === 'Hyperlink') return fontLineHeight(node.presentation.font) + 4;
    const value = buttonMetrics(node.presentation.font);
    // Raised buttons allocate one extra bottom pixel for their shadow.
    return Math.max(26, value.lineHeight + 2 * value.verticalPadding + 2) + 3;
  };
  const maximumHeight = () => buttonRow() ? Math.max(...children().map(height)) : 0;
  const joinedTables = createMemo(() => {
    if (horizontal()) return new Set();
    const nodes = children();
    return new Set(nodes.filter((table, index) => {
      const bar = nodes[index - 1];
      return table.kind === 'Table' && table.name && bar?.kind === 'CommandBar'
        && (scalar(bar, 'CommandSource') === `Item.${table.name}`
          || bar.children.some(child => child.presentation.displayed && tableSearchReference(scalar(child, 'CommandName'))?.table === table.name));
    }).map(node => node.key));
  });
  const tracks = axis => {
    const dimension = axis === 'x' ? 'width' : 'height';
    return children().map(node => {
      const minimum = layout?.minimumFor(node)?.[dimension] ?? 0;
      if (layout?.stretch(node, axis)) return `minmax(${minimum}px, ${stretchWeight(node, axis)}fr)`;
      if (axis === 'x' && groupCanShrink(node, props.controller.state.os)) {
        const preferred = layout?.preferredWidthFor(node);
        const limit = preferred === undefined ? 'max-content' : `${Math.max(minimum, preferred)}px`;
        return `minmax(${minimum}px, ${limit})`;
      }
      return 'max-content';
    }).join(' ');
  };
  return <div data-grouping={props.node.presentation.grouping} data-layout-owner={props.node.key}
    data-content-vertical-align={contentAlignment() ? '' : undefined}
    data-auto-spacing={automaticHorizontalSpacing(props.node) ? '' : undefined} style={{ '--taxi-content-vertical-align': contentAlignment(), '--taxi-inherited-vertical-align': inheritedAlignment(), '--taxi-layout-rows': tracks('y'), '--taxi-layout-columns': horizontal() ? tracks('x') : undefined }} classList={{ 'taxi-items': true, 'taxi-items--horizontal': horizontal(), 'taxi-items--vertical': !horizontal(), 'taxi-items--wrap': props.node.presentation.grouping === 'HorizontalIfPossible', 'taxi-items--usual-buttons': uniform(), 'taxi-items--buttons': buttonRow() }}>
    <For each={props.node.children}>{node => <Element node={node} controller={props.controller} joinedTable={joinedTables().has(node.key)} heightConstrained={heightConstrained()}
      uniformButtonWidth={width()} onPreferredButtonWidth={uniform() ? value => preferred(node.key, value) : undefined}
      usualButtonOffset={buttonRow() && (maximumHeight() - height(node)) % 2 === 1 ? '.5px' : undefined}/>}</For>
  </div>;
}

function Pages(props) {
  const node = () => props.node, state = props.controller.state;
  const pages = () => node().children.filter(node => node.presentation.displayed);
  const selected = () => (pages().find(page => page.key === state.ui.pages[node().key]) ?? pages()[0])?.key;
  const metrics = () => tabMetrics(pages().map(page => page.presentation.titleFont));
  const horizontal = () => !['TabsOnLeftHorizontal', 'TabsOnRightHorizontal'].includes(scalar(node(), 'PagesRepresentation'));
  return <div class="taxi-pages" data-representation={scalar(node(), 'PagesRepresentation', 'TabsOnTop')}>
    <Show when={scalar(node(), 'PagesRepresentation') !== 'None'}><div class="taxi-tabs" role="tablist" style={{height:state.os === 'linux' && horizontal() ? `${metrics().height}px` : undefined}}><For each={pages()}>{(page,index) => <PageTab page={page} previous={pages()[index()-1]} next={pages()[index()+1]} selected={selected()} pageBackground={pages().find(page=>page.key===selected())?.presentation.background} pageHasBackground={!!property(pages().find(page=>page.key===selected()),'BackColor')} pages={node()} controller={props.controller} metrics={metrics()} horizontal={horizontal()} active={page.key === selected()}/>}</For></div></Show>
    <div class="taxi-page-stack"><For each={pages()}>{page => <div role="tabpanel" id={`taxi-page-${page.key}`} aria-label={caption(page, state)} class="taxi-page" aria-hidden={page.key !== selected()} inert={page.key !== selected()}
      style={{ visibility: page.key === selected() ? undefined : 'hidden', 'background-color': property(page, 'BackColor') ? color(page.presentation.background) : undefined }}><Items node={page} controller={props.controller} heightConstrained={props.heightConstrained}/></div>}</For></div>
  </div>;
}
function PageTab(props) {
  const state = props.controller.state;
  let button;
  const [paint,setPaint]=createSignal();
  const width = createNativeButtonWidth(() => button, () => ({text:caption(props.page,state),os:state.os,automatic:true,font:font(props.page.presentation.titleFont,state.os),metrics:props.metrics}));
  const native = () => state.os === 'linux' && ['Auto', 'TabsOnTop', 'Swipe'].includes(scalar(props.pages, 'PagesRepresentation', 'Auto'));
  return <button ref={button} data-native-tab-border={paint()?'ready':undefined} type="button" role="tab" aria-label={caption(props.page,state)} aria-controls={`taxi-page-${props.page.key}`} aria-selected={props.active} classList={{active:props.active,'taxi-selected':state.selected===props.page.key}}
    style={{...font(props.page.presentation.titleFont,state.os),color:color(props.page.presentation.titleColor),width:width(),height:state.os === 'linux' ? `${props.metrics.height}px` : undefined,
      'padding-left':state.os === 'linux' && props.horizontal ? `${props.metrics.horizontalPadding}px` : undefined,'padding-right':state.os === 'linux' && props.horizontal ? `${props.metrics.horizontalPadding}px` : undefined,
      'line-height':`${fontLineHeight(props.page.presentation.titleFont)}px`,'background-color':paint()?`rgb(${paint().background.join(',')})`:undefined,'border-bottom-color':paint()&&props.active?`rgb(${paint().background.join(',')})`:undefined}} onClick={event => {
    event.stopPropagation(); props.controller.ui('pages',{...state.ui.pages,[props.pages.key]:props.page.key}); props.controller.select(props.page);
  }}><NativeLabel enabled={native()} placement="tab" calibrated={props.metrics.calibrated} text={caption(props.page,state)} font={props.page.presentation.titleFont} foreground={props.page.presentation.titleColor} runtime={props.controller.nativeText}/><NativeTabBorder node={props.page} previous={props.previous} next={props.next} selected={props.selected} pageBackground={props.pageBackground} pageHasBackground={props.pageHasBackground} active={props.active} enabled={native()} button={()=>button} controller={props.controller} paint={paint()} setPaint={setPaint}/></button>;
}
function Group(props) {
  const node = () => props.node, state = props.controller.state;
  // Configurator expands design-time content even when the runtime starts collapsed.
  const collapsed = () => state.ui.collapsed[node().key] ?? false;
  const collapsible = () => scalar(node(), 'Behavior') === 'Collapsible';
  const title = () => flag(node(), 'ShowTitle', node().kind !== 'Page');
  const painted = () => !!property(node(), 'BackColor');
  let container;
  const outside=createNativeGroupBackdrop(()=>container,()=>({enabled:state.os==='linux'&&painted(),sequence:state.sequence}));
  return <Switch>
    <Match when={node().kind === 'Pages'}><Pages {...props}/></Match>
    <Match when={node().kind === 'Popup'}><PopupMenu {...props}/></Match>
    <Match when={node().kind === 'CommandBar'}><CommandBar {...props}/></Match>
    <Match when={node().kind === 'ButtonGroup'}><div class="taxi-command-bar"><For each={node().children}>{child => <Element node={child} controller={props.controller}/>}</For></div></Match>
    <Match when={true}><div ref={container} class="taxi-group" data-native-group-background={outside()?'ready':undefined} classList={{ 'taxi-group--strong': scalar(node(), 'Representation') === 'StrongSeparation', 'taxi-group--collapsible': collapsible(), 'taxi-group--painted': painted() }}
      style={{ 'background-color': painted() ? color(node().presentation.background) : undefined, '--taxi-group-outside':outside(), '--taxi-group-title-color': color(node().presentation.titleColor) }}>
      <Show when={title()}><div class="taxi-group-title" style={{ ...font(node().presentation.titleFont, state.os), 'line-height': `${fontLineHeight(node().presentation.titleFont)}px`, color: color(node().presentation.titleColor) }}>
        <Show when={collapsible()} fallback={caption(node(), state)}><button type="button" aria-expanded={!collapsed()} onClick={event => { event.stopPropagation(); props.controller.ui('collapsed', { ...state.ui.collapsed, [node().key]: !collapsed() }); }}>{caption(node(), state)}</button></Show>
      </div></Show><Show when={!collapsed()}><Items {...props}/></Show>
    </div></Match>
  </Switch>;
}
function CommandBar(props) {
  const state = props.controller.state, node = () => props.node;
  const root = () => state.model.root;
  const source = createMemo(() => commandSourceTable(root(), node()));
  const additions = createMemo(() => {
    const projection = tableAdditionsProjection(root(), source());
    return projection?.bar.key === node().key ? projection : undefined;
  });
  const hasSearch = () => !!tableSearch(source());
  const commands = createMemo(() => {
    const inline = [], trailing = [], additional = [];
    let hasOverflow = !!source(), tableCommands = !!source(), advancedSearch = false;
    for (const child of node().children) {
      if (!child.presentation.displayed) continue;
      const command = scalar(child, 'CommandName');
      const searchReference = tableSearchReference(command);
      if (!availableTableSearchCommand(root(), searchReference)) continue;
      tableCommands ||= !!searchReference;
      const customize = command === 'Form.StandardCommand.CustomizeForm';
      const location = scalar(child, 'LocationInCommandBar', 'Auto');
      const usesSearch = hasSearch() && searchReference?.table === source()?.name;
      if (usesSearch && location === 'Auto') continue;
      if (location === 'InAdditionalSubmenu' || customize && location === 'Auto') {
        additional.push(child);
        hasOverflow = true;
        continue;
      }
      if (usesSearch && searchReference.action === 'Find') advancedSearch = true;
      (customize ? trailing : inline).push(child);
      if (location === 'InCommandBarAndInAdditionalSubmenu') additional.push(child);
    }
    return { inline, trailing, more: hasOverflow ? additional : [], tableCommands, advancedSearch };
  });
  const menu = createMemo(() => {
    const table = source();
    if (!table || !node().presentation.tableCommandMenu) return menuItems(commands().more);
    const declared = [...new Set([...commands().inline, ...commands().more, ...commands().trailing])];
    return tableCommandRows(table, declared, [], node().presentation.tableCommandMenu);
  });
  const commandLabel = child => {
    const reference = tableSearchReference(scalar(child, 'CommandName'));
    return hasSearch() && reference?.action === 'Find' && reference.table === source()?.name && !property(child, 'Title')
      ? state.strings['command.AdvancedSearch'] : undefined;
  };
  return <div class="taxi-command-bar" data-table-commands={commands().tableCommands ? '' : undefined}
    data-advanced-search={commands().advancedSearch ? '' : undefined}>
    <Show when={source()}><TableCommandActions commands={automaticCommands(node())} controller={props.controller}/></Show>
    <For each={commands().inline}>{child => <Element node={child} controller={props.controller} buttonLabel={commandLabel(child)}/>}</For>
    <TableToolbarSearch search={additions()?.search} control={additions()?.control} controller={props.controller}
      spacer={commands().tableCommands && (source() || commands().more.length)}/>
    <Show when={menu().length} fallback={<Show when={source()}><CommandButton label={state.strings.more} controller={props.controller} dropdown nativeDropdown/></Show>}>
      <PopupMenu rows={menu()} label={state.strings.more} controller={props.controller} tableBar={!!source()} tableMenu={!!node().presentation.tableCommandMenu} nativeDropdown/>
    </Show>
    <For each={commands().trailing}>{child => <Element node={child} controller={props.controller}/>}</For>
  </div>;
}
export function PopupMenu(props) {
  const [open, setOpen] = createSignal(false);
  let container, handleMenuKey;
  const trigger = () => container.querySelector(':scope > button');
  const close = () => {
    setOpen(false);
    trigger()?.focus({ preventScroll: true });
  };
  createEffect(() => {
    if (!open()) return;
    const outside = event => { if (!container.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
    if (props.tableBar) {
      const observer = new MutationObserver(() => {
        if (container.hasAttribute('data-table-command-hidden')) setOpen(false);
      });
      observer.observe(container, { attributeFilter: ['data-table-command-hidden'] });
      onCleanup(() => observer.disconnect());
    }
  });
  const children = () => props.rows ?? menuItems(props.command?.items ?? props.items ?? menuChildren(props.node));
  return <div class="taxi-popup" data-command-overflow={props.items ? '' : undefined}
    data-command-group={props.command?.key} data-root-menu={props.rootMenu ? '' : undefined}
    data-table-more={props.tableBar ? '' : undefined}
    ref={container} onKeyDown={event => {
      if (event.target !== container && event.target !== trigger()) return;
      if (open()) handleMenuKey?.(event);
      else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
    }}>
    <CommandButton node={props.node} command={props.command} label={props.label} controller={props.controller} dropdown nativeDropdown={props.nativeDropdown} menu expanded={open()}
      onClick={() => setOpen(!open())}/>
    <Show when={open()}>
      <MenuLevel rows={children()} anchor={trigger} close={close} dismiss={close} controller={props.controller}
        rootMenu={props.rootMenu} tableMenu={props.tableMenu} floating={props.tableBar} registerKeyHandler={handler => { handleMenuKey = handler; }} focusOnMount/>
    </Show>
  </div>;
}

const menuFont = { points: 10, weight: 400 };

function MenuLevel(props) {
  const [active, setActive] = createSignal(0);
  const [expanded, setExpanded] = createSignal();
  const [activeInk, setActiveInk] = createSignal();
  const floating = () => props.rootMenu || props.nested || props.floating;
  const state = props.controller.state;
  let menu;
  const rowSelector = ':scope > [role=menuitem]:not([aria-disabled=true]), :scope > .taxi-submenu > [role=menuitem]:not([aria-disabled=true])';
  const focus = index => {
    const items = [...menu.querySelectorAll(rowSelector)];
    if (!items.length) return;
    const item = items[(index + items.length) % items.length];
    setActive(Number(item.dataset.menuIndex));
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const handleKey = event => {
    if (event.key === 'Escape' || props.nested && event.key === 'ArrowLeft') {
      event.stopPropagation();
      event.preventDefault();
      props.close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.stopPropagation();
      event.preventDefault();
      setExpanded(undefined);
      const items = [...menu.querySelectorAll(rowSelector)];
      const index = items.findIndex(item => Number(item.dataset.menuIndex) === active());
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : index + (event.key === 'ArrowDown' ? 1 : -1);
      focus(next);
    }
  };
  onMount(() => {
    props.registerKeyHandler?.(handleKey);
    onCleanup(() => props.registerKeyHandler?.(undefined));
    if (floating()) positionCommandMenu(menu, props.anchor(), props.nested);
    if (props.focusOnMount) focus(0);
  });
  const activity = () => color(state.model.activityColor) || 'var(--taxi-ActivityColor)';
  const native = () => (props.rootMenu || props.tableMenu) && state.os === 'linux';
  const menuWidth = createMemo(() => {
    if (!native()) return;
    const advances = props.rows.filter(item => item !== menuSeparator)
      .map(item => controlCaptionWidth(menuCaption(item, state, true), menuFont));
    // Add the icon and shortcut gutters and the two panel borders.
    if (!advances.every(Number.isFinite)) return;
    const maximum = Math.max(0, ...advances);
    if (props.tableMenu && (!props.nested || props.rows.some(item => item !== menuSeparator && menuShortcut(item)))) {
      return `${Math.max(state.locale.startsWith('ru') ? 377 : 335, maximum + 155)}px`;
    }
    return `${105 + maximum}px`;
  });
  createEffect(() => {
    if (!props.rootMenu && !props.tableMenu) return;
    activity(); active();
    const selected = menu.querySelector('.active');
    const background = selected && rgb(getComputedStyle(selected).backgroundColor);
    const ink = background ? primaryForeground(background) : undefined;
    setActiveInk(ink === undefined ? undefined : `rgb(${ink}, ${ink}, ${ink})`);
  });
  return <div role="menu" class="taxi-menu" data-root-menu-level={props.rootMenu ? '' : undefined} data-table-menu-level={props.tableMenu ? '' : undefined}
    data-floating-menu={floating() ? '' : undefined}
    style={{ ...(native() ? linuxControlFont(menuFont) : {}), '--taxi-menu-natural-width': menuWidth() ?? 'max-content',
      '--taxi-menu-activity': props.rootMenu || props.tableMenu ? activity() : undefined, '--taxi-menu-activity-ink': activeInk() }}
    ref={menu} onClick={event => event.stopPropagation()} onKeyDown={handleKey}>
    <For each={props.rows}>{(item, index) => {
      if (item === menuSeparator) return <div class="taxi-menu-divider" role="separator"/>;
      const node = menuNode(item), children = createMemo(() => menuChildren(item, state));
      const submenu = () => children().length > 0, opened = () => expanded() === item.key;
      const picture = () => menuPicture(item, props.rootMenu);
      const enabled = () => menuEnabled(item);
      const label = () => menuCaption(item, state, props.rootMenu);
      let button;
      const enter = () => {
        setExpanded(item.key);
        queueMicrotask(() => button?.nextElementSibling?.querySelector(rowSelector)?.focus());
      };
      const row = <button ref={button} type="button" role="menuitem" tabIndex={-1}
        data-menu-index={index()} classList={{ active: active() === index() }}
        aria-label={label()}
        aria-disabled={!enabled()} aria-haspopup={submenu() ? 'menu' : undefined} aria-expanded={submenu() ? opened() : undefined}
        onFocus={() => setActive(index())}
        onMouseEnter={() => {
          if (!enabled()) return;
          setActive(index());
          setExpanded(submenu() ? item.key : undefined);
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' && submenu() && enabled()) { event.preventDefault(); event.stopPropagation(); enter(); }
        }}
        onClick={event => {
          event.stopPropagation();
          if (!enabled()) return;
          if (node) props.controller.select(node);
          if (submenu()) enter();
          else props.dismiss();
        }}>
        <Show when={picture()}><Picture node={node} picture={picture()} pictureVariant={props.tableMenu ? 'tableMenu' : undefined} controller={props.controller}/></Show>
        <Show when={native()} fallback={label()}>
          <NativeLabel enabled placement="menuItem" text={label()} font={menuFont} runtime={props.controller.nativeText}/>
        </Show>
        <Show when={(props.rootMenu || props.tableMenu) && menuShortcut(item)}>{shortcut => <span class="taxi-menu-shortcut">{shortcut()}</span>}</Show>
        <Show when={submenu()}><span class="taxi-submenu-arrow" aria-hidden="true"/></Show>
      </button>;
      return <Show when={submenu()} fallback={row}>
        <div role="none" class="taxi-submenu">{row}
          <Show when={opened()}>
            <MenuLevel rows={children()} anchor={() => button} nested rootMenu={props.rootMenu} tableMenu={props.tableMenu} controller={props.controller}
              close={() => { setExpanded(undefined); button.focus({ preventScroll: true }); }} dismiss={props.dismiss}/>
          </Show>
        </div>
      </Show>;
    }}</For>
  </div>;
}
function Input(props) {
  let valueInput, surface;
  const [paint,setPaint] = createSignal();
  const node = () => props.node, state = props.controller.state;
  const kind = () => node().presentation.valueType.kind;
  const value = createMemo(() => fieldValue(node(), state.culture, state.locale));
  const multiline = () => flag(node(), 'MultiLine', false);
  const controlHeight = () => inputControlHeight(node(), state.os);
  const verticalOffset=()=>{
    if(state.os!=='linux'||multiline())return 0;
    const offset=(inputRowHeight(node(),state.os,!!caption(node(),state))-inputHeight(node(),state.os))/2;
    return Math.round(offset)-offset;
  };
  return <div ref={surface} class="taxi-input" data-native-border={paint()?'ready':undefined} data-native-backdrop={paint()?.outside.join(',')} data-native-disabled-foreground={paint()?.foreground?.join(',')} data-native-outset={paint()?Number(paint().choice):undefined}
    classList={{ 'taxi-input--incomplete': node().presentation.markIncomplete === true, 'taxi-input--read-only': flag(node(), 'ReadOnly', false) }} style={{ ...fieldStyle(node(),state.os), '--taxi-input-outset': fieldStyle(node(),state.os)['min-width'] === 'calc(100% - 1px)' ? '1px' : '0px', top:verticalOffset()?`${verticalOffset()}px`:undefined, height: `${controlHeight()}px`,
    color: color(node().presentation.foreground), 'background-color': color(node().presentation.background), 'border-color': color(node().presentation.border), '--taxi-input-native-border':paint()?`rgb(${paint().border.join(',')})`:undefined, '--taxi-input-native-background':paint()?`rgb(${paint().background.join(',')})`:undefined, '--taxi-input-button-border':paint()?`rgb(${paint().buttonBorder.join(',')})`:undefined, '--taxi-input-disabled-foreground':paint()?.foreground?`rgb(${paint().foreground.join(',')})`:undefined }}>
    <NativeInputBorder node={node()} surface={()=>surface} controller={props.controller} paint={paint()} setPaint={setPaint}/>
    <Switch><Match when={multiline()}><textarea readOnly value={value()} aria-label={caption(node(), state)} tabIndex="-1"/></Match>
      <Match when={true}><input ref={valueInput} readOnly value={value()} aria-label={caption(node(), state)} tabIndex="-1" style={{ 'text-align': scalar(node(), 'HorizontalAlign', kind() === 'number' ? 'Right' : 'Left').toLowerCase() }}/><NativeLabel enabled={state.os === 'linux' && ['number','date'].includes(kind()) && ((flag(node(),'Enabled') && !flag(node(),'ReadOnly',false)) || !!paint())} placement="input" mask={kind()==='date'} target={()=>valueInput} text={value()} font={node().presentation.font} foreground={node().presentation.foreground} runtime={props.controller.nativeText}/></Match></Switch>
    <Show when={inputChoiceButton(node(),state.os)}><span class="taxi-input-button" classList={{'taxi-input-button--choice':true,'taxi-input-button--number':kind() === 'number'}}>{kind() === 'date' ? <Show when={state.os === 'linux'} fallback={<Icon name="Calendar"/>}><NativeInputCalendar height={controlHeight()} inactive={paint()?.inactive ?? (flag(node(),'ReadOnly',false)||!flag(node(),'Enabled'))} fallback={<Icon name="Calendar"/>}/></Show> : kind() === 'number' ? <Show when={state.os === 'linux'} fallback={<Icon name="Calculator"/>}><NativeInputCalculator height={controlHeight()} inactive={paint()?.inactive ?? (flag(node(),'ReadOnly',false)||!flag(node(),'Enabled'))}/></Show> : '▾'}</span></Show>
    <Show when={flag(node(), 'OpenButton', kind() === 'reference')}><span class="taxi-input-button"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4h5v6H1V4zm3-3h6v6H5z" fill="none" stroke="#777"/></svg></span></Show>
    <Show when={flag(node(), 'ClearButton', false)}><span class="taxi-input-button">×</span></Show>
    <Show when={flag(node(), 'SpinButton', false)}><span class="taxi-input-button taxi-spin">▴<br/>▾</span></Show>
  </div>;
}
function Field(props) {
  const node = () => props.node, state = props.controller.state;
  const title = () => caption(node(), state);
  const checkbox = () => node().kind === 'CheckBoxField';
  const layout = useFormLayout();
  const titleLocation = () => layout?.titleAbove(node()) ? 'Top' : checkbox() && !title() ? 'None' : node().presentation.titleLocation;
  const sideTitle = () => ['Left', 'Right'].includes(titleLocation());
  const label = () => title() + (title() && !(checkbox() && titleLocation() === 'Right') ? ':' : '');
  const radio = () => state.os === 'linux' && node().kind === 'RadioButtonField';
  const labelFont = () => node().presentation.titleFont;
  const allocatedCaption = () => layout?.captionFor(node());
  const inputCaption = () => node().kind === 'InputField' ? allocatedCaption() : undefined;
  const checkboxCaption = () => checkbox() ? allocatedCaption() : undefined;
  const nativeLabel = text => <NativeLabel placement="fieldTitle" text={text()} font={labelFont()} foreground={node().presentation.titleColor}
    runtime={props.controller.nativeText} enabled={state.os === 'linux' && (checkbox() || (radio() || node().kind === 'InputField'
      && sideTitle()) && flag(node(), 'Enabled'))}/>;
  const numericLabel = createMemo(() => numericLabelMetrics(node(), state.os));
  const numericWidth = createMemo(() => numericLabel() ? fieldCaptionProfile(label(), labelFont())?.preferred : undefined);
  const referenceTitleWidth = createMemo(() => titleLocation() === 'Left' && nativeReferenceInput(node(), state.os)
    ? designCaptionWidth(label(), labelFont()) : undefined);
  const labelValueStyle = () => {
    const size = numericLabel();
    return size ? {
      width: `${size.preferred}px`, height: `${size.height}px`, 'min-height': '0',
      'background-color': property(node(), 'BackColor') ? color(node().presentation.background) : undefined,
    } : fieldStyle(node());
  };
  const labelStyle = () => {
    const nativeCheck = state.os === 'linux' && checkbox();
    const width = (radio() || nativeCheck) && ['Left', 'Right'].includes(titleLocation()) ? controlCaptionWidth(label(), labelFont()) : undefined;
    const reference = referenceTitleWidth();
    const titleWidth = numericWidth() ?? (reference === undefined ? undefined : reference + inputCaptionInset);
    const wrapped = checkboxCaption() || (inputCaption() && sideTitle());
    return { ...(nativeCheck || numericLabel() ? linuxControlFont(labelFont()) : font(labelFont(), state.os)),
      width: titleWidth === undefined ? undefined : `var(--taxi-field-caption-width, ${titleWidth}px)`,
      color: nativeCheck && !flag(node(), 'Enabled') ? '#a6a6a6' : color(node().presentation.titleColor),
      'line-height': numericLabel() || wrapped ? `${fontLineHeight(labelFont())}px` : undefined,
      '--taxi-choice-title-width': width === undefined ? undefined : `${width + Number(radio())}px` };
  };
  const control = () => <Switch fallback={<SpecialField node={node()} controller={props.controller}/>}>
    <Match when={node().kind === 'InputField'}><Input {...props}/></Match>
    <Match when={checkbox()}><CheckBoxControl {...props}/></Match>
    <Match when={node().kind === 'RadioButtonField'}><RadioChoices {...props}/></Match>
    <Match when={node().kind === 'LabelField'}><span class="taxi-label-field" data-numeric-label={numericLabel() ? '' : undefined} style={labelValueStyle()}>
      {node().presentation.valueType.kind === 'number' ? '' : fieldValue(node(), state.culture, state.locale)}
    </span></Match>
    <Match when={node().kind === 'ProgressBarField'}><span class="taxi-progress" style={fieldStyle(node())}><i/></span></Match>
    <Match when={node().kind === 'TrackBarField'}><span class="taxi-track" style={fieldStyle(node())}><i/><b/></span></Match>
    <Match when={node().kind === 'PictureField'}><span class="taxi-picture-field" style={pictureFieldStyle(node(), state.os)}><Picture node={node()} controller={props.controller}/></span></Match>
  </Switch>;
  return <div class="taxi-field-row" data-title-location={titleLocation()}
    data-wrapped-input-caption={inputCaption() ? '' : undefined}
    data-wrapped-checkbox-caption={checkboxCaption() ? '' : undefined}
    data-numeric-label-title={numericLabel() ? '' : undefined}
    data-multiline={state.os === 'linux' && node().kind === 'InputField' && inputRows(node()) > 1 ? '' : undefined} style={{ 'min-height': numericLabel() ? '0' : node().kind === 'InputField' ? `${inputRowHeight(node(),state.os,!!title())}px` : undefined }} classList={{ 'taxi-field-row--check': node().kind === 'CheckBoxField' && titleLocation() === 'Right', 'taxi-field-row--large': !['InputField', 'CheckBoxField', 'RadioButtonField', 'LabelField', 'ProgressBarField', 'TrackBarField', 'PeriodField'].includes(node().kind) }}>
    <Show when={titleLocation() !== 'None'}>
      <label class="taxi-field-label" aria-label={label()} style={labelStyle()}>
        <Show when={inputCaption() || checkboxCaption()} fallback={nativeLabel(() => allocatedCaption() ?? label())}>
          {text => <For each={text().split('\n')}>{line =>
            <span class="taxi-field-caption-line">{nativeLabel(() => line)}</span>}</For>}
        </Show>
      </label>
    </Show>
    <div class="taxi-field-control">{control()}</div>
  </div>;
}
function LabelDecoration(props) {
  const node = () => props.node, state = props.controller.state;
  const value = () => caption(node(), state);
  const style = () => ({
    ...font(node().presentation.font, state.os),
    ...(state.os === 'linux' ? {
      'font-size': `${fontPixels(node().presentation.font)}px`,
      width: value() === '' ? `${Math.max(0, number(node(), 'Width')) * 10}px` : undefined,
    } : {}),
    color: color(node().presentation.foreground),
    'white-space': flag(node(), 'Wrap', true) ? 'pre-wrap' : 'pre',
  });
  return <span classList={{ 'taxi-label': true, 'taxi-hyperlink': flag(node(), 'Hyperlink', false) }} style={style()}>{value()}</span>;
}
export function Element(props) {
  const node = () => props.node, state = props.controller.state, layout = useFormLayout();
  const bounds = axis => controlBounds(node(), axis, undefined, state.os, {
    atPreferred: layout?.atPreferred(axis),
    authoredHeight: axis === 'y' && (props.heightConstrained || !!layout?.authoredHeight()),
  });
  const x = () => bounds('x'), y = () => bounds('y');
  const groupSize = () => groupPreferredSize(node(), state.os);
  const horizontalMaximum = createMemo(() => horizontalInputMaximum(node(), state.os));
  const group = () => ['UsualGroup', 'Page', 'Pages', 'ColumnGroup', 'CommandBar', 'ButtonGroup', 'Popup'].includes(node().kind);
  const layoutStyle = () => ({
    ...font(node().presentation.font, state.os),
    color: color(node().presentation.foreground), top: props.usualButtonOffset,
    '--taxi-stretch-weight': stretchWeight(node(), 'x'),
    '--taxi-group-width': `${groupSize().width || 0}px`,
    '--taxi-group-height': `${groupSize().height || 0}px`,
    '--taxi-control-min-width': x().minimum ? `${x().minimum}px` : undefined,
    '--taxi-control-max-width': x().maximum ? `${x().maximum}px` : undefined,
    '--taxi-control-min-height': y().minimum ? `${y().minimum}px` : undefined,
    '--taxi-control-max-height': y().maximum ? `${y().maximum}px` : undefined,
    '--taxi-horizontal-input-maximum': horizontalMaximum() ? `${horizontalMaximum()}px` : undefined,
  });
  return <Show when={displayedInPreview(node())}><div data-element={node().key} data-kind={node().kind} data-joined-table={props.joinedTable ? '' : undefined} data-stretch-x={layout?.stretch(node(), 'x')} data-stretch-y={layout?.stretch(node(), 'y')} data-layout-container={group()} data-authored-group-height={hasAuthoredGroupHeight(node(), state.os) ? '' : undefined} data-height-constrained={props.heightConstrained ? '' : undefined} data-group-shrink-x={groupCanShrink(node(), state.os) ? '' : undefined} data-group-vertical-align={scalar(node(), 'GroupVerticalAlign') || undefined} data-horizontal-input-limit={horizontalMaximum() ? '' : undefined} classList={{ 'taxi-element': true, 'taxi-element--field': node().kind?.endsWith('Field'), 'taxi-selected': state.selected === node().key, 'taxi-disabled': !flag(node(), 'Enabled'), 'taxi-element--stretch': flag(node(), 'HorizontalStretch', false) }}
    style={layoutStyle()}
    onClick={event => { event.stopPropagation(); props.controller.select(node()); }} onDblClick={event => { event.stopPropagation(); props.controller.post({ type: 'locate', target: { kind: 'element', identity: node().identity } }); }}>
    <Switch fallback={<div class="taxi-unsupported">{state.strings.unsupported}: {node().xmlName.name}</div>}>
      <Match when={group()}><Group {...props}/></Match>
      <Match when={node().kind === 'Table'}><Table node={node()} controller={props.controller}/></Match>
      <Match when={node().kind === 'Button'}><CommandButton {...props} label={props.buttonLabel}/></Match>
      <Match when={node().kind === 'LabelDecoration'}><LabelDecoration {...props}/></Match>
      <Match when={node().kind === 'PictureDecoration'}><span class="taxi-picture-decoration"><Picture node={node()} controller={props.controller}/></span></Match>
      <Match when={node().kind?.endsWith('Field')}><Field {...props}/></Match>
      <Match when={node().kind?.endsWith('Addition')}><span class="taxi-addition"><Show when={node().kind !== 'ViewStatusAddition'}><input readOnly placeholder={state.strings.search} tabIndex="-1"/></Show></span></Match>
    </Switch>
  </div></Show>;
}
