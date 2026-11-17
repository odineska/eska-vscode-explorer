import { batch, createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { DataPane, StructurePane } from './InspectorLists.jsx';
import { PropertyInspector } from './PropertyInspector.jsx';
import { attributeFor, commandFor } from './inspector-model.mjs';
import { dataTarget as editDataTarget, elementTarget } from './editor-model.mjs';
import { Splitter } from './Splitter.jsx';

const terms = [];

export function Inspector(props) {
  const c = props.controller, state = c.state;
  const index = () => props.index;
  const selected = createMemo(() => index().nodes.get(state.selected) ?? index().nodes.values().next().value);
  const activeData = createMemo(() => index().byData.get(state.ui.inspectedData));
  const relatedData = createMemo(() => activeData() ? undefined
    : attributeFor(index(), selected()?.binding) ?? commandFor(index(), selected()?.command));
  const selectedElement = () => elementTarget(selected()?.node, state.model.root);
  const selectedDefinition = () => editDataTarget(activeData());
  const editSelection = () => activeData() ? selectedDefinition() : selectedElement();
  const pluralRules = createMemo(() => new Intl.PluralRules(state.locale));
  const detached = () => props.layout.mode === 'detached';
  const [dataReveal, setDataReveal] = createSignal('', { equals: false });
  const [treeReveal, setTreeReveal] = createSignal('', { equals: false });
  createEffect(on(c.dataReveal, setDataReveal));
  const selectData = row => c.ui('inspectedData', row.id);

  const revealedData = createMemo(() => {
    const row = relatedData() ?? activeData();
    const open = new Set();
    if (row?.id === dataReveal()) {
      const rows = index().byData;
      for (let parent = rows.get(row.parent); parent; parent = rows.get(parent.parent)) open.add(parent.id);
    }
    return open;
  });
  function showData(row) {
    batch(() => {
      c.ui('tab', row.section);
      setDataReveal(row.id);
    });
  }
  function showElement(row) {
    batch(() => {
      const folds = { ...state.ui.folded }, nodes = index().nodes;
      for (let parent = nodes.get(row.parent); parent; parent = nodes.get(parent.parent)) delete folds[parent.key];
      c.ui('folded', folds);
      c.ui('treeTab', 'elements');
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
  const resize = (key, minimum, maximum, value) => c.ui(key, Math.max(minimum, Math.min(maximum, value)));
  return <div class="form-inspectors" data-inspector-layout={props.layout.mode}
    style={{ 'grid-template-columns': props.layout.tracks, '--form-attached-height': state.ui.upper + 'px',
      '--form-detached-height': state.ui.detachedUpper + 'px' }}>
    <StructurePane controller={c} index={index()} terms={terms} activeData={activeData()}
      reveal={treeReveal()} selectData={selectData}/>
    <Splitter vertical class="form-splitter form-splitter--vertical form-inspector-sash--structure"
      label={state.strings.resizeStructure} range={{ minimum: props.layout.leftMinimum, maximum: props.layout.leftMaximum }}
      value={() => props.layout.left} factor={() => 100 / props.layout.width}
      change={value => resize(detached() ? 'detachedLeft' : 'left', props.layout.leftMinimum, props.layout.leftMaximum, value)}/>
    <DataPane controller={c} index={index()} terms={terms} activeData={activeData()} relatedData={relatedData()}
      reveal={dataReveal()} editTarget={selectedDefinition()} revealed={revealedData()} clearReveal={() => setDataReveal('')} select={selectData} locate={locateData} pluralRules={pluralRules()}/>
    <Show when={!detached()} fallback={
      <Splitter class="form-splitter form-inspector-sash--detached" label={state.strings.resizeInspector}
        range={{ minimum: props.layout.minimumHeight, maximum: props.layout.maximumTreeHeight }}
        value={() => props.layout.treeHeight} change={value => resize('detachedUpper', props.layout.minimumHeight, props.layout.maximumTreeHeight, value)}/>
    }>
      <Splitter vertical class="form-splitter form-splitter--vertical form-inspector-sash--properties"
        label={state.strings.resizeProperties} range={{ minimum: props.layout.rightMinimum, maximum: props.layout.rightMaximum }}
        value={() => props.layout.right} factor={() => 100 / props.layout.width}
        change={value => resize('right', props.layout.rightMinimum, props.layout.rightMaximum, value)}/>
    </Show>
    <PropertyInspector controller={c} index={index()} selected={selected()} activeData={activeData()} relatedData={relatedData()}
      editTarget={editSelection()} detached={detached()} showData={showData} showElement={showElement} showOnForm={c.showOnForm} pluralRules={pluralRules()} locateData={locateData} canLocateData={dataTarget} copy={c.copyType}/>
    <span class="form-visually-hidden" role="status">{state.copiedType ? state.strings.typeCopied : ''}</span>
  </div>;
}
