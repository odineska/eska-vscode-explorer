import { createContext, useContext, createSignal, createMemo, createEffect, onMount, onCleanup, untrack } from 'solid-js';
import { number } from './model.mjs';
import { stretches, formAllocation, atPreferredAxis, linuxContainerHeightUnit } from './layout-model.mjs';
import { minimumFormLayout } from './minimum-layout.js';
import { inputTitleLayout } from './input-title-layout.js';
import { checkboxLayout } from './checkbox-layout.js';
import { dateBlockLayout } from './date-block-layout.js';
import { alignUnitedRows } from './united-layout.js';
import { alignUnitedColumns } from './united-columns.js';
import { alignThroughLabels, layoutThroughCaptions } from './through-align.js';
import { alignNumericLabelRows } from './numeric-label-layout.js';
import { alignInlineFieldRows } from './inline-field-layout.js';
import { borderBoxSize, boundingScale, boxInsets, pixels } from './layout-box.mjs';
import { measureRootCommands } from './root-command-layout.mjs';
import { measureTableCommands } from './table-command-layout.mjs';
import { layoutTableWidths } from './table-width-layout.js';
import { boundedGroupRows } from './authored-group-rows.js';
import { createColumnDividers } from './column-divider-layout.js';
import { commandBarLayout } from './command-bar-layout.js';
import { layoutGroupSpacing } from './group-spacing-layout.js';
import { measureDecorations } from './decoration-layout.js';
import { sameDecorationLines } from './decoration-metrics.mjs';

export const FormLayoutContext = createContext();
export const useFormLayout = () => useContext(FormLayoutContext);

function naturalFormSize(root, rows, widths) {
  const footprints = new Map(rows.map(items => {
    const children = [...items.children].filter(child => child.classList.contains('taxi-element'));
    const gap = pixels(getComputedStyle(items).getPropertyValue('--taxi-horizontal-gap'));
    let spacing = gap * Math.max(0, children.length - 1), content = 0;
    for (const child of children) {
      const css = getComputedStyle(child);
      spacing += pixels(css.marginLeft) + pixels(css.marginRight);
      content += widths.get(child.dataset.element) ?? 0;
    }
    return [items.dataset.layoutOwner, { width: content + spacing, spacing }];
  }));
  return { frame: borderBoxSize(root), widths, rows: footprints };
}

/** One local geometry owner per webview. Resize never changes the source model or the shared session. */
export function createFormLayout(controller, viewport, preview, frame, commandPosition) {
  const state = controller.state;
  const [preferred, setPreferred] = createSignal({ width: 0, height: 0 });
  const [geometry, setGeometry] = createSignal({
    minimum: { width: 28, height: 28 }, minima: new Map(), itemsHeight: 0, chromeHeight: 28,
  });
  const nativeFormScroll = () => state.os === 'linux';
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [viewportResized, setViewportResized] = createSignal(false);
  const [measuringReference, setMeasuringReference] = createSignal(false);
  const authoredWidth = createMemo(() => {
    const units = number(state.model.root, 'Width');
    if (units <= 0) return 0;
    return state.os === 'linux' ? units * 10 + 30 : units * 10.5;
  });
  const authoredHeight = createMemo(() => {
    const units = number(state.model.root, 'Height');
    if (state.os !== 'linux' || units <= 0) return 0;
    const position = commandPosition();
    const frameInsets = position && position !== 'Bottom' ? 43 : 52;
    return frameInsets + linuxContainerHeightUnit * units;
  });
  const preferredX = createMemo(() => measuringReference() || atPreferredAxis(size().outerWidth, preferred().width, state.ui.zoom));
  const preferredY = createMemo(() => measuringReference() || authoredHeight() > 0 || atPreferredAxis(size().outerHeight, preferred().height, state.ui.zoom));
  const [preferredWidths, setPreferredWidths] = createSignal(new Map());
  const [wrapped, setWrapped] = createSignal(new Set());
  const [fieldCaptions, setFieldCaptions] = createSignal(new Map());
  const [aboveTitles, setAboveTitles] = createSignal(new Set());
  const [decorations, setDecorations] = createSignal(new Map());
  let active = true, mounted = false, scheduled, needsPreferred = true, needsMinimum = true;
  let unitedRows, unitedColumns, numericRows, adaptiveTitles, checkboxes, dateBlocks, minimumRows, minimumCaptions, throughCaptions, rootCommands, allocateGroupRows, allocateTableCommands, allocateCommandBars, decorationsLayout;
  let allocateInlineRows, natural, referenceFrame, needsNatural = true, referencePending = true;
  let headingTitles = [];
  const headingHeights = new Map();
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
  const schedule = () => {
    if (active && mounted && scheduled === undefined && !untrack(measuringReference)) scheduled = requestAnimationFrame(measure);
  };
  const columnDividers = createColumnDividers(schedule);
  const rect = borderBoxSize;
  function measure() {
    scheduled = undefined;
    if (!active) return;
    const surface = viewport(), content = preview(), root = frame();
    // A hidden tab has no allocation; preserve dirty measurements until it becomes visible.
    if (!surface?.isConnected || !content?.isConnected || !root?.isConnected || surface.clientWidth <= 0 || surface.clientHeight <= 0) return;
    const body = root.querySelector(':scope > .taxi-form-content');
    const bodyScroll = body.querySelector(':scope > .taxi-form-scrollport');
    const scroll = [surface.scrollLeft, surface.scrollTop, bodyScroll.scrollLeft, bodyScroll.scrollTop];
    const target = { surface, content, root, body, bodyScroll };
    measureLayout(target, scroll);
    // A form that already exceeds the screen uses viewport allocation and body scrolling.
    const fitsScreen = natural.frame.height * state.ui.zoom / 100 <= window.screen.availHeight;
    if (referencePending && nativeFormScroll() && authoredWidth() && !authoredHeight() && fitsScreen) {
      referencePending = false;
      measureReference(target);
      measureLayout(target, scroll);
    }
  }
  function measureReference(target) {
    // Resolve wrapping at the form's own width, then restore the live viewport before painting.
    const liveWrap = wrapped();
    setMeasuringReference(true);
    try {
      if (liveWrap.size) setWrapped(new Set());
      needsPreferred = true;
      for (let pass = 0; pass < 6 && (needsPreferred || needsMinimum); pass++) measureLayout(target);
      if (!needsPreferred && !needsMinimum) {
        referenceFrame = rect(target.root);
      }
    } finally {
      setMeasuringReference(false);
      setWrapped(liveWrap);
      needsPreferred = needsMinimum = true;
    }
  }
  function measureLayout({ surface, content, root, body, bodyScroll }, scroll) {
    const reference = measuringReference();
    const refresh = needsPreferred;
    if (refresh) {
      needsPreferred = false;

      const elements = [...root.querySelectorAll('.taxi-element')];
      const elementByKey = new Map(elements.map(element => [element.dataset.element, element]));
      const containers = new Map([...root.querySelectorAll('.taxi-items[data-layout-owner]')]
        .map(items => [items.dataset.layoutOwner, items]));
      const targets = { elements: elementByKey, containers, children: node => node.children.filter(child => elementByKey.has(child.key)) };
      content.dataset.formLayout = 'preferred';
      headingTitles = [...root.querySelectorAll('.taxi-group-title[data-native-heading-minimum]')];
      headingHeights.clear();
      clearAlignment();
      if (fieldCaptions().size) setFieldCaptions(new Map());
      if (aboveTitles().size) setAboveTitles(new Set());
      if (decorations().size) setDecorations(new Map());
      const scale = boundingScale(root);
      const model = state.model.root, context = { targets, alignment, scale, os: state.os, collapsed: state.ui.collapsed };
      const commands = body.querySelector(':scope > .taxi-root-commands');
      const bottomCommands = body.dataset.rootCommandPosition === 'Bottom' ? commands : null;
      const rows = [...containers.values()].filter(items => items.dataset.grouping === 'HorizontalIfPossible');
      const activeWrap = wrapped();
      function prepare(wrap) {
        rootCommands = measureRootCommands(commands, scale);
        decorationsLayout = measureDecorations(model, context, state);
        layoutGroupSpacing(model, context, bottomCommands);
        if (root.querySelector('.taxi-table-field')) {
          const width = authoredWidth() ? authoredWidth() - boxInsets(getComputedStyle(body)).width : undefined;
          layoutTableWidths(model, context, width);
        }
        allocateTableCommands = measureTableCommands(root, scale);
        unitedColumns = alignUnitedColumns(model, context);
        const throughScopes = alignThroughLabels(model, context);
        unitedColumns.alignColumns(throughScopes);
        unitedRows = alignUnitedRows(model, context, wrap);
        allocateInlineRows = alignInlineFieldRows(model, context);
        numericRows = alignNumericLabelRows(model, context);
        dateBlocks = dateBlockLayout(model, context);
        minimumCaptions = new Map([...unitedRows.minimumCaptions, ...(numericRows?.minimumCaptions ?? []), ...dateBlocks.minimumCaptions]);
        // Rows that can move titles above their inputs own their resize allocation.
        adaptiveTitles = inputTitleLayout(model, context, minimumCaptions);
        throughCaptions = layoutThroughCaptions(throughScopes, context, minimumCaptions, adaptiveTitles.captionFields);
        checkboxes = checkboxLayout(model, context);
        unitedColumns.captureThroughPreferred(throughCaptions.stackLimits, dateBlocks.titleFloors);
        minimumRows = new Map([...unitedColumns.minimumRows, ...adaptiveTitles.minimumRows, ...checkboxes.minimumRows, ...dateBlocks.minimumRows]);
        unitedRows.capturePreferredColumns(dateBlocks.titleFloors, unitedColumns.fixedThroughWidths);
        allocateGroupRows = boundedGroupRows(root, scale, alignment);
        allocateCommandBars = commandBarLayout(root, context);
      }
      const stacked = rows.filter(items => activeWrap.has(items.dataset.layoutOwner));
      if (needsNatural && stacked.length) {
        // Measure the native horizontal footprint, including spacing inside painted descendants.
        for (const items of stacked) items.classList.replace('taxi-items--vertical', 'taxi-items--horizontal');
        try {
          prepare(new Set());
          natural = naturalFormSize(root, rows, new Map(elements.map(element => [element.dataset.element, rect(element).width])));
        } finally {
          clearAlignment();
          for (const items of stacked) items.classList.replace('taxi-items--horizontal', 'taxi-items--vertical');
        }
        needsNatural = false;
      }
      prepare(activeWrap);
      const measured = elements.map(element => [element, rect(element)]);
      const widths = new Map(measured.map(([element, size]) => [element.dataset.element, size.width]));
      if (needsNatural) {
        natural = naturalFormSize(root, rows, widths);
        needsNatural = false;
      }
      // Conditional rows can form an intrinsic line wider than the whole screen.
      // Keep that footprint for reflow, and report the size of the stacked form.
      const oversized = state.os === 'linux' && natural.frame.width > window.screen.availWidth && activeWrap.size > 0;
      if (!reference) setPreferred(referenceFrame ?? (oversized ? rect(root) : natural.frame));
      needsMinimum = true;
      for (const [element, size] of measured) {
        element.style.setProperty('--taxi-preferred-width', `${size.width}px`);
        element.style.setProperty('--taxi-preferred-height', `${size.height}px`);
      }
      setPreferredWidths(widths);
    }
    if (needsMinimum) {
      needsMinimum = false;
      content.dataset.formLayout = 'minimum';
      const available = reference ? authoredWidth() + 4
        : size().width > 0 ? size().width / (state.ui.zoom / 100) - 8 : Infinity;
      const measured = minimumFormLayout(root, boundingScale(root), {
        minimumCaptions, minimumInputs: throughCaptions.minimumInputs,
        commandWidth: rootCommands?.minimumWidth, minimumRows, widthFloors: unitedColumns.widthFloors,
        fixedThroughWidths: unitedColumns.fixedThroughWidths, headingHeights, available, conditionalWidth: state.os === 'linux',
      });
      setGeometry(measured);
      content.dataset.formLayout = 'allocated';
      if (scroll) {
        surface.scrollLeft = scroll[0]; surface.scrollTop = scroll[1];
        bodyScroll.scrollLeft = scroll[2]; bodyScroll.scrollTop = scroll[3];
      }
    }
    const conditionalGroups = root.querySelectorAll('.taxi-items[data-grouping=HorizontalIfPossible]');
    if (!reference) {
      const style = getComputedStyle(surface);
      const next = { width: surface.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: surface.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        outerWidth: surface.offsetWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        outerHeight: surface.offsetHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
      const previous = size();
      const resized = previous.outerWidth !== next.outerWidth || previous.outerHeight !== next.outerHeight;
      // Recheck fit against the resized area before scrollbars from the old arrangement settle.
      const recheckGroups = resized && conditionalGroups.length > 0;
      const recheckCaptions = (refresh || resized) && (minimumCaptions.size > 0 || minimumRows.size > 0 || decorationsLayout.size > 0 || headingTitles.length > 0);
      if (recheckGroups || recheckCaptions) next.width = next.outerWidth;
      if (resized && previous.outerWidth !== undefined) setViewportResized(true);
      if (Object.keys(next).some(key => previous[key] !== next[key])) {
        if (headingTitles.length && next.width !== previous.width) needsMinimum = true;
        setSize(next); schedule();
      }
    }
    rootCommands?.allocate();
    allocateTableCommands?.();
    const captions = new Map(), previousCaptions = fieldCaptions();
    const alignedAbove = new Set();
    throughCaptions.allocate(captions, geometry().minima, alignedAbove);
    const packedDates = unitedRows.allocateWidths(captions, geometry().minima);
    if (!reference) {
      columnDividers.allocate(unitedRows.columnPairs, geometry().minima, root);
      for (const [key, plan] of packedDates) {
        const divider = columnDividers.get(plan.owner);
        if (!divider?.tracks) continue;
        const manual = plan.manual?.(divider.value);
        if (manual) packedDates.set(key, manual);
        else packedDates.delete(key);
      }
    }
    numericRows?.allocateWidths(captions);
    allocateInlineRows(captions, alignedAbove);
    checkboxes.allocate(captions);
    const { above, heightChanged } = adaptiveTitles.allocate(captions);
    for (const key of alignedAbove) above.add(key);
    dateBlocks.allocate(captions, above, unitedRows.columnFraction, packedDates, unitedColumns.fixedThroughWidths);
    const leadingEdges = unitedColumns.allocate(above, captions, packedDates);
    throughCaptions.allocateStacks(captions, geometry().minima, leadingEdges);
    allocateGroupRows(geometry().minima);
    allocateCommandBars(geometry().minima);
    for (const title of headingTitles) {
      const bounds = rect(title);
      if (bounds.height <= 0) continue;
      // The native full width may be smaller than Chromium's glyph advances.
      const wrap = bounds.width + .5 < Number(title.dataset.nativeTextWidth);
      const changed = wrap !== title.hasAttribute('data-native-heading-wrapped');
      if (changed) title.toggleAttribute('data-native-heading-wrapped', wrap);
      const height = changed ? rect(title).height : bounds.height;
      if (height === headingHeights.get(title)) continue;
      headingHeights.set(title, height);
      needsMinimum = true;
      schedule();
    }
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
    const wrap = measureWrapping(root, conditionalGroups);
    setWrapped(previous => {
      if (previous.size === wrap.size && [...previous].every(key => wrap.has(key))) return previous;
      needsPreferred = true;
      needsMinimum = true; schedule(); return wrap;
    });
  }
  function measureWrapping(root, conditionalGroups) {
    const wrap = new Set();
    if (!conditionalGroups.length) return wrap;
    const widths = preferredWidths(), changed = [];
    // Test the allocation of unfolded widths before giving the occupied space back to stacked groups.
    if (wrapped().size) {
      for (const element of root.querySelectorAll('.taxi-element')) {
        const key = element.dataset.element, width = natural.widths.get(key);
        if (width !== undefined && width !== widths.get(key)) {
          changed.push(element);
          element.style.setProperty('--taxi-preferred-width', `${width}px`);
        }
      }
      if (changed.length) setPreferredWidths(natural.widths);
    }
    try {
      for (const items of conditionalGroups) {
        const key = items.dataset.layoutOwner, footprint = natural.rows.get(key);
        if (!footprint) continue;
        const required = items.hasAttribute('data-native-command-row')
          ? [...items.children].reduce((width, child) => width + pixels(child.style.getPropertyValue('--taxi-min-width')), footprint.spacing)
          : footprint.width;
        const reserve = throughCaptions.pageWidthReserves.get(key)?.() ?? 0;
        const available = rect(items).width - boxInsets(getComputedStyle(items)).width - reserve;
        if (available + .5 < required) wrap.add(key);
      }
    } finally {
      for (const element of changed) {
        element.style.setProperty('--taxi-preferred-width', `${widths.get(element.dataset.element)}px`);
      }
      if (changed.length) setPreferredWidths(widths);
    }
    return wrap;
  }
  function invalidatePreferred() {
    needsPreferred = needsNatural = referencePending = true;
    referenceFrame = undefined;
    schedule();
  }
  createEffect(() => {
    // Subscribe to geometry-bearing model values, not the transport sequence or selection.
    const visit = node => {
      JSON.stringify([node.key, node.kind, node.presentation, node.properties]);
      for (const child of [...node.children, ...node.auxiliary]) visit(child);
    };
    visit(state.model.root); JSON.stringify(state.ui.collapsed);
    state.model.scriptVariant; state.locale; state.culture; state.os;
    invalidatePreferred();
  });
  createEffect(() => { state.ui.zoom; needsMinimum = true; schedule(); });
  createEffect(() => { preferredX(); preferredY(); needsMinimum = true; schedule(); });
  onMount(() => {
    mounted = true;
    const observer = new ResizeObserver(schedule); observer.observe(viewport()); observer.observe(frame());
    document.fonts?.ready.then(() => { if (active) invalidatePreferred(); });
    schedule();
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => {
    active = false;
    cancelAnimationFrame(scheduled);
    clearAlignment();
  });
  const allocation = () => {
    const { minimum, chromeHeight } = geometry();
    if (measuringReference()) return { width: Math.max(authoredWidth() + 4, minimum.width), height: 0 };
    const viewport = size(), zoom = state.ui.zoom;
    // Keep the natural height of a form that only needs to scroll horizontally.
    const fitsHeight = minimum.height <= viewport.outerHeight * 100 / zoom - 8 + .5;
    const frameMinimum = nativeFormScroll() && !fitsHeight ? { width: minimum.width, height: chromeHeight } : minimum;
    const allocated = formAllocation(viewport, preferred(), frameMinimum, zoom);
    return { width: allocated.width, height: authoredHeight() || allocated.height };
  };
  return {
    atPreferred: axis => axis === 'x' ? preferredX() : preferredY(),
    allocation,
    columnDivider: columnDividers.get, moveColumnDivider: columnDividers.move,
    authoredHeight, nativeFormScroll, measuringReference,
    // A painted border outside the logical rows must not create a scrollbar.
    bodyOverflows: () => nativeFormScroll() && !measuringReference() && geometry().minimum.height > allocation().height + .5,
    itemsMinimumHeight: () => geometry().itemsHeight,
    viewportResized: () => !measuringReference() && viewportResized(),
    invalidate: invalidatePreferred,
    preferred, minimumFor: node => geometry().minima.get(node.key),
    preferredWidthFor: node => preferredWidths().get(node.key),
    stretch: (node, axis) => stretches(node, axis, state.ui.collapsed, state.model.root),
    wrapped: node => wrapped().has(node.key),
    captionFor: node => fieldCaptions().get(node.key),
    titleAbove: node => aboveTitles().has(node.key),
    decorationFor: node => decorations().get(node.key),
    initialWidth: () => authoredWidth() ? `${authoredWidth()}px` : 'max-content',
  };
}
