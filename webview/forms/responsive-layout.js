import { createContext, useContext, createSignal, createMemo, createEffect, onMount, onCleanup, batch } from 'solid-js';
import { number } from './model.mjs';
import { stretches, formAllocation, atPreferredAxis } from './layout-model.mjs';
import { minimumFormLayout } from './minimum-layout.js';
import { alignUnitedRows } from './united-layout.js';
import { alignUnitedColumns } from './united-columns.js';
import { alignThroughLabels } from './through-align.js';
import { borderBoxSize, boundingScale } from './layout-box.mjs';

export const FormLayoutContext = createContext();
export const useFormLayout = () => useContext(FormLayoutContext);

/** One local geometry owner per webview. Resize never changes the source model or the shared session. */
export function createFormLayout(controller, viewport, preview, frame) {
  const state = controller.state;
  const [preferred, setPreferred] = createSignal({ width: 0, height: 0 });
  const [minimum, setMinimum] = createSignal({ width: 28, height: 28 });
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const authoredHeight = createMemo(() => {
    const units = number(state.model.root, 'Height');
    // Linux Designer adds 16 pixels per authored unit to the form's 52-pixel base.
    return state.os === 'linux' && units > 0 ? 52 + 16 * units : 0;
  });
  const preferredX = createMemo(() => atPreferredAxis(size().outerWidth, preferred().width, state.ui.zoom));
  const preferredY = createMemo(() => authoredHeight() > 0 || atPreferredAxis(size().outerHeight, preferred().height, state.ui.zoom));
  const [minima, setMinima] = createSignal(new Map());
  const [wrapped, setWrapped] = createSignal(new Set());
  let active = true, mounted = false, scheduled, needsPreferred = true, needsMinimum = true;
  let unitedRows, clearThroughLabels, clearUnitedColumns;
  const schedule = () => { if (active && mounted && scheduled === undefined) scheduled = requestAnimationFrame(measure); };
  const rect = borderBoxSize;
  function measure() {
    scheduled = undefined;
    if (!active) return;
    const surface = viewport(), content = preview(), root = frame();
    // A hidden tab has no allocation; preserve dirty measurements until it becomes visible.
    if (!surface?.isConnected || !content?.isConnected || !root?.isConnected || surface.clientWidth <= 0 || surface.clientHeight <= 0) return;
    const scroll = [surface.scrollLeft, surface.scrollTop];
    if (needsPreferred) {
      needsPreferred = false;

      const elements = [...root.querySelectorAll('.taxi-element')];
      const elementByKey = new Map(elements.map(element => [element.dataset.element, element]));
      const containers = new Map([...root.querySelectorAll('.taxi-items[data-layout-owner]')]
        .map(items => [items.dataset.layoutOwner, items]));
      content.dataset.formLayout = 'preferred';
      unitedRows?.clear();
      clearThroughLabels?.();
      clearUnitedColumns?.();
      const scale = boundingScale(root);
      clearThroughLabels = alignThroughLabels(state.model.root, containers, scale);
      unitedRows = alignUnitedRows(state.model.root, elementByKey, containers, wrapped(), state.ui.collapsed);
      clearUnitedColumns = alignUnitedColumns(state.model.root, elementByKey, containers, state.os, state.ui.collapsed, scale);
      const nextPreferred = rect(root);
      setPreferred(nextPreferred);
      needsMinimum = true;
      for (const element of elements) {
        const value = rect(element);
        element.style.setProperty('--taxi-preferred-width', `${value.width}px`);
        element.style.setProperty('--taxi-preferred-height', `${value.height}px`);
      }
    }
    if (needsMinimum) {
      needsMinimum = false;
      content.dataset.formLayout = 'minimum';
      const measured = minimumFormLayout(root, boundingScale(root));
      batch(() => { setMinimum(measured.minimum); setMinima(measured.minima); });
      content.dataset.formLayout = 'allocated';
      surface.scrollLeft = scroll[0]; surface.scrollTop = scroll[1];
    }
    const style = getComputedStyle(surface);
    const next = { width: surface.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: surface.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      outerWidth: surface.offsetWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      outerHeight: surface.offsetHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
    if (Object.keys(next).some(key => size()[key] !== next[key])) { setSize(next); schedule(); }
    const wrap = new Set();
    for (const items of root.querySelectorAll('.taxi-items[data-grouping=HorizontalIfPossible]')) {
      const children = [...items.children];
      const gap = parseFloat(getComputedStyle(items).getPropertyValue('--taxi-horizontal-gap'));
      const required = children.reduce((sum, child) => sum + parseFloat(child.style.getPropertyValue('--taxi-preferred-width') || '0'), 0)
        + Math.max(0, children.length - 1) * gap;
      if (rect(items).width + .5 < required) wrap.add(items.dataset.layoutOwner);
    }
    setWrapped(previous => {
      if (previous.size === wrap.size && [...previous].every(key => wrap.has(key))) return previous;
      if (unitedRows && [...unitedRows.owners].some(key => previous.has(key) !== wrap.has(key))) needsPreferred = true;
      needsMinimum = true; schedule(); return wrap;
    });
  }
  createEffect(() => {
    // Subscribe to geometry-bearing model values, not the transport sequence or selection.
    const visit = node => {
      JSON.stringify([node.key, node.kind, node.presentation, node.properties]);
      for (const child of [...node.children, ...node.auxiliary]) visit(child);
    };
    visit(state.model.root); JSON.stringify(state.ui.collapsed); state.locale; state.os;
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
    unitedRows?.clear();
    clearThroughLabels?.();
    clearUnitedColumns?.();
  });
  return {
    atPreferred: axis => axis === 'x' ? preferredX() : preferredY(),
    allocation: () => {
      const allocated = formAllocation(size(), preferred(), minimum(), state.ui.zoom);
      return { width: allocated.width, height: authoredHeight() || allocated.height };
    },
    authoredHeight,
    invalidate: () => { needsPreferred = true; schedule(); },
    preferred, minimumFor: node => minima().get(node.key),
    stretch: (node, axis) => stretches(node, axis, state.ui.collapsed),
    wrapped: node => wrapped().has(node.key),
    initialWidth: () => number(state.model.root, 'Width') > 0 ? `${number(state.model.root, 'Width') * 10.5}px` : 'max-content',
  };
}
