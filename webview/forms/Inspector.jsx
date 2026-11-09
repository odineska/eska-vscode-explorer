import { batch, createMemo, createSignal, on, Show } from 'solid-js';
import { DataPane, InspectorTabs, StructurePane } from './InspectorLists.jsx';
import { PropertyInspector } from './PropertyInspector.jsx';
import { InspectorIcon, InspectorIconButton } from './InspectorIcon.jsx';
import { attributeFor, commandFor, indexInspector, inspectorTerms } from './inspector-model.mjs';
import { Splitter } from './Splitter.jsx';

const compactTabs = ['elements', 'data'];

export function Inspector(props) {
  const c = props.controller, state = c.state;
  // The host revision covers both the form and the metadata read while composing it.
  const index = createMemo(on([() => state.revision, () => state.model, () => state.locale],
    () => indexInspector(state.model, state.locale, state.strings)));
  const terms = createMemo(() => inspectorTerms(state.ui.search, state.locale));
  const selected = createMemo(() => index().nodes.get(state.selected) ?? index().nodes.values().next().value);
  const activeData = createMemo(() => index().byData.get(state.ui.inspectedData));
  const relatedData = createMemo(() => activeData() ? undefined
    : attributeFor(index(), selected()?.binding) ?? commandFor(index(), selected()?.command));
  const pluralRules = createMemo(() => new Intl.PluralRules(state.locale));
  const compact = () => props.layout.mode === 'compact' || props.layout.mode === 'compactStacked';
  const [dataReveal, setDataReveal] = createSignal('', { equals: false });
  const [treeReveal, setTreeReveal] = createSignal('', { equals: false });
  let search;
  const selectData = row => c.ui('inspectedData', row.id);

  function reveal(row, lookup, foldName, select) {
    batch(() => {
      const folds = { ...state.ui[foldName] };
      for (let parent = lookup.get(row.parent); parent; parent = lookup.get(parent.parent)) {
        delete folds[parent.key ?? parent.id];
      }
      c.ui(foldName, folds);
      if (!terms().every(term => row.search.includes(term))) c.ui('search', '');
      select();
    });
  }
  function showData(row) {
    reveal(row, index().byData, 'dataFolded', () => {
      c.ui('tab', row.section);
      c.ui('compactPane', 'data');
      setDataReveal(row.id);
    });
  }
  function showElement(row) {
    reveal(row, index().nodes, 'folded', () => {
      c.ui('treeTab', 'elements');
      c.ui('compactPane', 'elements');
      c.select(row.node);
      setTreeReveal(row.key);
    });
  }
  function dataTarget(row) {
    if (row.definition) return { kind: 'definition', section: row.section, name: row.definition.name };
    if (row.origin) return { kind: 'dataPath', path: row.path.split('.') };
    const use = index().usages.get(row.path)?.find(item => item.node.presentation.binding);
    if (use) return { kind: 'binding', identity: use.node.identity };
  }
  function locateData(row) {
    const target = dataTarget(row);
    if (target && state.phase === 'ready') c.post({ type: 'locate', target, revision: state.revision, formSessionId: state.formSessionId });
  }
  const clearSearch = () => { c.ui('search', ''); search.focus(); };
  const resize = (key, minimum, maximum, value) => c.ui(key, Math.max(minimum, Math.min(maximum, value)));
  return <div class="form-inspectors" data-inspector-layout={props.layout.mode}
    style={{ height: `${props.layout.height}px`, 'grid-template-columns': props.layout.tracks }}>
    <div class="form-inspector-header">
      <div class="form-inspector-search"><InspectorIcon name="search"/>
        <input ref={search} type="search" aria-label={state.strings.inspectorSearch} placeholder={state.strings.inspectorSearch}
          value={state.ui.search} maxLength="512" onInput={event => c.ui('search', event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Escape' && state.ui.search) { event.stopPropagation(); clearSearch(); } }}/>
        <Show when={state.ui.search}><InspectorIconButton icon="clear" label={state.strings.clearSearch} onClick={clearSearch}/></Show>
      </div>
      <Show when={compact()}><InspectorTabs tabs={compactTabs} active={state.ui.compactPane} change={value => c.ui('compactPane', value)}
        strings={state.strings} label={state.strings.inspectorViews}/></Show>
    </div>
    <StructurePane controller={c} index={index()} terms={terms()} activeData={activeData()}
      reveal={treeReveal()} selectData={selectData} hidden={compact() && state.ui.compactPane !== 'elements'}/>
    <Show when={props.layout.mode === 'columns'}>
      <Splitter vertical class="form-splitter form-splitter--vertical form-inspector-sash--structure"
        label={state.strings.resizeStructure} range={{ minimum: props.layout.leftMinimum, maximum: props.layout.leftMaximum }}
        value={() => props.layout.left} factor={() => 100 / props.layout.width}
        change={value => resize('left', props.layout.leftMinimum, props.layout.leftMaximum, value)}/>
    </Show>
    <DataPane controller={c} index={index()} terms={terms()} activeData={activeData()} relatedData={relatedData()}
      reveal={dataReveal()} select={selectData} locate={locateData} pluralRules={pluralRules()} hidden={compact() && state.ui.compactPane !== 'data'}/>
    <Show when={props.layout.mode === 'columns' || props.layout.mode === 'compact'}>
      <Splitter vertical class="form-splitter form-splitter--vertical form-inspector-sash--properties"
        label={state.strings.resizeProperties} range={{ minimum: props.layout.rightMinimum, maximum: props.layout.rightMaximum }}
        value={() => props.layout.right} factor={() => 100 / props.layout.width}
        change={value => resize(compact() ? 'compactRight' : 'right', props.layout.rightMinimum, props.layout.rightMaximum, value)}/>
    </Show>
    <PropertyInspector controller={c} index={index()} selected={selected()} activeData={activeData()} relatedData={relatedData()}
      showData={showData} showElement={showElement} showOnForm={c.showOnForm} pluralRules={pluralRules()} locateData={locateData} canLocateData={dataTarget} copy={c.copyType}/>
    <span class="form-visually-hidden" role="status">{state.copiedType ? state.strings.typeCopied : ''}</span>
  </div>;
}
