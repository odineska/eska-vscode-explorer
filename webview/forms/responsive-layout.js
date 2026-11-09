import { createContext, useContext, createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { number } from './model.mjs';
import { stretches, formAllocation, atPreferredAxis, linuxContainerHeightUnit } from './layout-model.mjs';
import { minimumFormLayout } from './minimum-layout.js';
import { inputTitleLayout } from './input-title-layout.js';
import { checkboxLayout } from './checkbox-layout.js';
import { alignUnitedRows } from './united-layout.js';
import { alignUnitedColumns } from './united-columns.js';
import { alignThroughLabels, layoutThroughCaptions } from './through-align.js';
import { alignNumericLabelRows } from './numeric-label-layout.js';
import { borderBoxSize, boundingScale } from './layout-box.mjs';
import { measureRootCommands } from './root-command-layout.mjs';
import { measureTableCommands } from './table-command-layout.mjs';
import { authoredGroupRows } from './authored-group-rows.js';
import { commandBarLayout } from './command-bar-layout.js';
import { layoutGroupSpacing } from './group-spacing-layout.js';
import { measureDecorations } from './decoration-layout.js';
import { sameDecorationLines } from './decoration-metrics.mjs';

export const FormLayoutContext = createContext();
export const useFormLayout = () => useContext(FormLayoutContext);

/** One local geometry owner per webview. Resize never changes the source model or the shared session. */
export function createFormLayout(controller, viewport, preview, frame) {
  const state = controller.state;
  const [preferred, setPreferred] = createSignal({ width: 0, height: 0 });
  const [geometry, setGeometry] = createSignal({
    minimum: { width: 28, height: 28 }, minima: new Map(), itemsHeight: 0, chromeHeight: 28, tableFormScroll: false,
  });
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [viewportResized, setViewportResized] = createSignal(false);
  const authoredHeight = createMemo(() => {
    const units = number(state.model.root, 'Height');
    return state.os === 'linux' && units > 0 ? 52 + linuxContainerHeightUnit * units : 0;
  });
  const preferredX = createMemo(() => atPreferredAxis(size().outerWidth, preferred().width, state.ui.zoom));
  const preferredY = createMemo(() => authoredHeight() > 0 || atPreferredAxis(size().outerHeight, preferred().height, state.ui.zoom));
  const [preferredWidths, setPreferredWidths] = createSignal(new Map());
  const [wrapped, setWrapped] = createSignal(new Set());
  const [fieldCaptions, setFieldCaptions] = createSignal(new Map());
  const [aboveTitles, setAboveTitles] = createSignal(new Set());
  const [decorations, setDecorations] = createSignal(new Map());
  let active = true, mounted = false, scheduled, needsPreferred = true, needsMinimum = true;
  let unitedRows, unitedColumns, numericRows, adaptiveTitles, checkboxes, minimumRows, minimumCaptions, allocateThroughCaptions, rootCommands, allocateGroupRows, allocateTableCommands, allocateCommandBars, decorationsLayout;
  let conditionalSpacing = new Map();
  const undoAlignment = [];
  const alignment = {
    mark(element, attribute, value = '') {
      element.setAttribute(attribute, value);
      undoAlignment.push(() => element.removeAttribute(attribute));
    },
    style(element, name, value) {
      element.style.setProperty(name, value);
      undoAlignment.push(() => element.style.removeProperty(name));
    },
  };
  const clearAlignment = () => {
    for (const undo of undoAlignment) undo();
    undoAlignment.length = 0;
  };
  const schedule = () => { if (active && mounted && scheduled === undefined) scheduled = requestAnimationFrame(measure); };
  const rect = borderBoxSize;
  function measure() {
    scheduled = undefined;
    if (!active) return;
    const surface = viewport(), content = preview(), root = frame();
    // A hidden tab has no allocation; preserve dirty measurements until it becomes visible.
    if (!surface?.isConnected || !content?.isConnected || !root?.isConnected || surface.clientWidth <= 0 || surface.clientHeight <= 0) return;
    const body = root.querySelector(':scope > .taxi-form-content');
    const scroll = [surface.scrollLeft, surface.scrollTop, body.scrollLeft, body.scrollTop];
    const refresh = needsPreferred;
    if (refresh) {
      needsPreferred = false;

      const elements = [...root.querySelectorAll('.taxi-element')];
      const elementByKey = new Map(elements.map(element => [element.dataset.element, element]));
      const containers = new Map([...root.querySelectorAll('.taxi-items[data-layout-owner]')]
        .map(items => [items.dataset.layoutOwner, items]));
      const targets = { elements: elementByKey, containers, children: node => node.children.filter(child => elementByKey.has(child.key)) };
      content.dataset.formLayout = 'preferred';
      clearAlignment();
      if (fieldCaptions().size) setFieldCaptions(new Map());
      if (aboveTitles().size) setAboveTitles(new Set());
      if (decorations().size) setDecorations(new Map());
      const scale = boundingScale(root);
      rootCommands = measureRootCommands(root.querySelector('.taxi-root-commands'), scale);
      allocateTableCommands = measureTableCommands(root, scale);
      const context = { targets, alignment, scale, os: state.os, collapsed: state.ui.collapsed };
      decorationsLayout = measureDecorations(state.model.root, context, state);
      conditionalSpacing = layoutGroupSpacing(state.model.root, context);
      unitedColumns = alignUnitedColumns(state.model.root, context);
      const throughScopes = alignThroughLabels(state.model.root, context);
      unitedColumns.alignColumns();
      unitedRows = alignUnitedRows(state.model.root, context, wrapped());
      numericRows = alignNumericLabelRows(state.model.root, context);
      minimumCaptions = new Map([...unitedRows.minimumCaptions, ...(numericRows?.minimumCaptions ?? [])]);
      allocateThroughCaptions = layoutThroughCaptions(throughScopes, context, minimumCaptions);
      adaptiveTitles = inputTitleLayout(state.model.root, context, minimumCaptions);
      checkboxes = checkboxLayout(state.model.root, context);
      minimumRows = new Map([...unitedColumns.minimumRows, ...adaptiveTitles.minimumRows, ...checkboxes.minimumRows]);
      unitedRows.capturePreferredColumns();
      allocateGroupRows = authoredGroupRows(root, scale, alignment);
      allocateCommandBars = commandBarLayout(root, context);
      const nextPreferred = rect(root);
      const rootNode = state.model.root;
      if (wrapped().has(rootNode.key) && number(rootNode, 'Width') <= 0) {
        nextPreferred.width += conditionalSpacing.get(rootNode.key) ?? 0;
      }
      setPreferred(nextPreferred);
      needsMinimum = true;
      const widths = new Map();
      for (const element of elements) {
        const value = rect(element);
        widths.set(element.dataset.element, value.width);
        element.style.setProperty('--taxi-preferred-width', `${value.width}px`);
        element.style.setProperty('--taxi-preferred-height', `${value.height}px`);
      }
      setPreferredWidths(widths);
    }
    if (needsMinimum) {
      needsMinimum = false;
      content.dataset.formLayout = 'minimum';
      const available = size().width > 0 ? size().width / (state.ui.zoom / 100) - 8 : Infinity;
      const measured = minimumFormLayout(root, boundingScale(root), {
        minimumCaptions, commandWidth: rootCommands?.minimumWidth, minimumRows,
        headingWidths: unitedColumns.headingWidths, available,
      });
      setGeometry({ ...measured, tableFormScroll: !!root.querySelector('.taxi-table-field:is([data-native-column-sizing],[data-native-dynamic-list])') });
      content.dataset.formLayout = 'allocated';
      surface.scrollLeft = scroll[0]; surface.scrollTop = scroll[1];
      body.scrollLeft = scroll[2]; body.scrollTop = scroll[3];
    }
    const style = getComputedStyle(surface);
    const next = { width: surface.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: surface.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      outerWidth: surface.offsetWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      outerHeight: surface.offsetHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
    const previous = size();
    const resized = previous.outerWidth !== next.outerWidth || previous.outerHeight !== next.outerHeight;
    const conditionalGroups = root.querySelectorAll('.taxi-items[data-grouping=HorizontalIfPossible]');
    // Recheck fit against the resized area before scrollbars from the old arrangement settle.
    const recheckGroups = resized && conditionalGroups.length > 0;
    const recheckCaptions = (refresh || resized) && (minimumCaptions.size > 0 || minimumRows.size > 0 || decorationsLayout.size > 0);
    if (recheckGroups || recheckCaptions) next.width = next.outerWidth;
    if (resized && previous.outerWidth !== undefined) setViewportResized(true);
    if (Object.keys(next).some(key => previous[key] !== next[key])) {
      if (unitedColumns.headingWidths.size && next.width !== previous.width) needsMinimum = true;
      setSize(next); schedule();
    }
    rootCommands?.allocate();
    allocateTableCommands?.();
    const captions = new Map(), previousCaptions = fieldCaptions();
    allocateThroughCaptions(captions, geometry().minima);
    unitedRows.allocateWidths(captions);
    numericRows?.allocateWidths(captions);
    checkboxes.allocate(captions);
    const { above, heightChanged } = adaptiveTitles.allocate(captions);
    unitedColumns.allocate(above);
    allocateGroupRows(geometry().minima);
    allocateCommandBars(geometry().minima);
    const nextDecorations = decorationsLayout.allocate();
    const previousDecorations = decorations();
    if (nextDecorations.size !== previousDecorations.size
        || [...nextDecorations].some(([key, value]) => !sameDecorationLines(previousDecorations.get(key), value))) {
      setDecorations(nextDecorations); needsMinimum = true; schedule();
    }
    const previousAbove = aboveTitles();
    const moved = above.size !== previousAbove.size || [...above].some(key => !previousAbove.has(key));
    if (moved) setAboveTitles(above);
    if (moved || heightChanged) { needsMinimum = true; schedule(); }
    if (captions.size !== previousCaptions.size || [...captions].some(([key, value]) => previousCaptions.get(key) !== value)) {
      setFieldCaptions(captions);
      needsMinimum = true;
      schedule();
    }
    const wrap = new Set();
    for (const items of conditionalGroups) {
      const children = [...items.children];
      const gap = parseFloat(getComputedStyle(items).getPropertyValue('--taxi-horizontal-gap'));
      const dimension = items.hasAttribute('data-native-command-row') ? '--taxi-min-width' : '--taxi-preferred-width';
      const key = items.dataset.layoutOwner;
      const required = children.reduce((sum, child) => sum + parseFloat(child.style.getPropertyValue(dimension) || '0'), 0)
        + Math.max(0, children.length - 1) * gap + (conditionalSpacing.get(key) ?? 0);
      const width = rect(items).width;
      const availableFrame = next.outerWidth / (state.ui.zoom / 100) - 8;
      // A horizontal minimum can widen the root beyond its viewport before the row is stacked.
      const available = state.os === 'linux' && items.parentElement === body
        ? width - Math.max(0, rect(root).width - availableFrame) : width;
      if (available + .5 < required) wrap.add(key);
    }
    setWrapped(previous => {
      if (previous.size === wrap.size && [...previous].every(key => wrap.has(key))) return previous;
      if ([...unitedRows.owners, ...conditionalSpacing.keys()].some(key => previous.has(key) !== wrap.has(key))) needsPreferred = true;
      needsMinimum = true; schedule(); return wrap;
    });
  }
  createEffect(() => {
    // Subscribe to geometry-bearing model values, not the transport sequence or selection.
    const visit = node => {
      JSON.stringify([node.key, node.kind, node.presentation, node.properties]);
      for (const child of [...node.children, ...node.auxiliary]) visit(child);
    };
    visit(state.model.root); JSON.stringify(state.ui.collapsed);
    state.model.scriptVariant; state.locale; state.culture; state.os;
    needsPreferred = true; schedule();
  });
  createEffect(() => { state.ui.zoom; needsMinimum = true; schedule(); });
  createEffect(() => { preferredX(); preferredY(); needsMinimum = true; schedule(); });
  onMount(() => {
    mounted = true;
    const observer = new ResizeObserver(schedule); observer.observe(viewport()); observer.observe(frame());
    document.fonts?.ready.then(() => { if (active) { needsPreferred = true; schedule(); } });
    schedule();
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => {
    active = false;
    cancelAnimationFrame(scheduled);
    clearAlignment();
  });
  return {
    atPreferred: axis => axis === 'x' ? preferredX() : preferredY(),
    allocation: () => {
      const { minimum, chromeHeight, tableFormScroll } = geometry();
      const frameMinimum = tableFormScroll ? { width: minimum.width, height: chromeHeight } : minimum;
      const allocated = formAllocation(size(), preferred(), frameMinimum, state.ui.zoom);
      return { width: allocated.width, height: authoredHeight() || allocated.height };
    },
    authoredHeight, tableFormScroll: () => geometry().tableFormScroll,
    itemsMinimumHeight: () => geometry().itemsHeight,
    viewportResized,
    invalidate: () => { needsPreferred = true; schedule(); },
    preferred, minimumFor: node => geometry().minima.get(node.key),
    preferredWidthFor: node => preferredWidths().get(node.key),
    stretch: (node, axis) => stretches(node, axis, state.ui.collapsed, state.model.root),
    wrapped: node => wrapped().has(node.key),
    captionFor: node => fieldCaptions().get(node.key),
    titleAbove: node => aboveTitles().has(node.key),
    decorationFor: node => decorations().get(node.key),
    initialWidth: () => number(state.model.root, 'Width') > 0 ? `${number(state.model.root, 'Width') * (state.os === 'linux' ? 10 : 10.5) + (state.os === 'linux' ? 30 : 0)}px` : 'max-content',
  };
}
