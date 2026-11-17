import { elementTarget, textProperty } from './editor-model.mjs';
import { previewClientRect } from './preview-coordinates.mjs';

const elementMime = 'application/x-eska-form-element';
const attributeMime = 'application/x-eska-form-attribute';
const treeTarget = '[data-form-tree-node]';
const previewTarget = '[data-element], [data-form-drop-root]';

const groupEdge = extent => Math.min(10, extent / 4);

function edgeSpeed(point, first, last) {
  const band = Math.min(40, (last - first) / 3);
  if (point < first || point >= last || band <= 0) return 0;
  return 16 * (Math.max(0, 1 - (last - point) / band) - Math.max(0, 1 - (point - first) / band));
}

function scrollBounds(viewport) {
  const rect = previewClientRect(viewport);
  const scale = Number(viewport.closest('.taxi-preview')?.style.zoom) || 1;
  const left = rect.left + viewport.clientLeft * scale, top = rect.top + viewport.clientTop * scale;
  return { left, top, right: left + viewport.clientWidth * scale, bottom: top + viewport.clientHeight * scale, scale };
}

function canScroll(speed, offset, range) {
  return speed > 0 && offset < range || speed < 0 && offset > 0;
}

function scrollStep(viewport, body, point) {
  const { clientX: x, clientY: y } = point;
  const { left, top, right, bottom } = scrollBounds(viewport);
  if (x < left || x >= right || y < top || y >= bottom) return {};
  const across = edgeSpeed(x, left, right), down = edgeSpeed(y, top, bottom);
  const step = {
    x: canScroll(across, viewport.scrollLeft, viewport.scrollWidth - viewport.clientWidth) ? across : 0,
    y: canScroll(down, viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight) ? down : 0,
  };
  // On Linux a long form scrolls its own body within the outer viewport.
  if (!step.y && body?.isConnected) {
    const inner = scrollBounds(body);
    if (x >= inner.left && x < inner.right) {
      const speed = edgeSpeed(y, Math.max(top, inner.top), Math.min(bottom, inner.bottom)) || down;
      if (canScroll(speed, body.scrollTop, body.scrollHeight - body.clientHeight)) step.bodyY = speed / inner.scale;
    }
  }
  return step;
}

function hitInPreview(viewport, point) {
  const hit = viewport.ownerDocument.elementFromPoint(point.clientX, point.clientY);
  return viewport.contains(hit) ? hit : undefined;
}

function dragHit(event) {
  const viewport = event.isTrusted && event.target.closest?.('.preview-scroll');
  return viewport ? hitInPreview(viewport, event) : event.target;
}

function siblingRow(rows, row) {
  const parent = rows.get(row.parent);
  return parent?.node.children.some(child => child.key === row.key) ? parent : undefined;
}

function destination(rows, root, row, position, except) {
  const parent = position === 'inside' ? row : siblingRow(rows, row);
  const owner = elementTarget(parent?.node, root);
  if (!owner) return;
  const children = parent.node.children;
  const index = children.findIndex(child => child.key === row.key);
  const before = position === 'before' ? row.node :
    position === 'after' ? children.slice(index + 1).find(child => child.key !== except) : undefined;
  const anchor = before ? elementTarget(before, root) : null;
  if (before && anchor?.kind !== 'element') return;
  return { owner, parent, before: anchor?.id ?? null };
}

/** Compute placement using the backend's parent catalogue and real, unfiltered siblings. */
export function formMovePlacement(rows, root, catalogue, source, target, position) {
  if (!source || !target || source === target || !siblingRow(rows, source)) return;
  const place = destination(rows, root, target, position, source.key);
  if (!place || !catalogue[place.parent.node.kind]?.includes(source.node.kind)) return;
  for (let ancestor = place.parent; ancestor; ancestor = rows.get(ancestor.parent)) {
    if (ancestor.key === source.key) return;
  }
  const moved = elementTarget(source.node, root);
  if (moved?.kind !== 'element') return;
  return { target: moved, parent: place.owner, before: place.before };
}

export function formAddPlacement(rows, root, catalogue, row) {
  const inside = !!catalogue?.[row.node.kind]?.length;
  const place = destination(rows, root, row, inside ? 'inside' : 'after');
  if (!place || !catalogue?.[place.parent.node.kind]?.length) return;
  return { inside, parent: place.owner, before: place.before, fixed: true };
}

export function formSiblingMove(rows, root, catalogue, row, delta) {
  const parent = row && siblingRow(rows, row);
  if (!parent || !catalogue) return;
  const siblings = parent.node.children;
  const next = siblings[siblings.findIndex(child => child.key === row.key) + delta];
  if (next) return formMovePlacement(rows, root, catalogue, row, rows.get(next.key), delta < 0 ? 'before' : 'after');
}

function attributeKind(row) {
  switch (row.valueType?.kind) {
    case 'boolean': return 'CheckBoxField';
    case 'table': return 'Table';
    default: return 'InputField';
  }
}

export function formAttributeAddition(rows, root, catalogue, attribute, row, position) {
  if (!attribute || attribute.section !== 'attributes' || !row) return;
  const place = destination(rows, root, row, position);
  const kind = attributeKind(attribute);
  if (!place || !catalogue?.[place.parent.node.kind]?.includes(kind)) return;
  const base = attribute.path.replace(/[^\p{L}\p{Nd}_]+/gu, '_');
  const name = /^[\p{L}_]/u.test(base) ? base : 'Field_' + base;
  return { kind: 'addElement', parent: place.owner, before: place.before, element: {
    kind, name, properties: [textProperty('DataPath', attribute.path)], children: [], auxiliary: [],
  } };
}

export function createFormDrag(controller, index) {
  const { state } = controller;
  let dragged, marker, scroll, frame;
  const rows = () => index().nodes;
  const targetElement = hit => {
    const target = hit?.closest?.(`${treeTarget}, ${previewTarget}`);
    const wrapper = target?.closest('.taxi-element[data-element]');
    return wrapper && wrapper.dataset.element === target.dataset.element ? wrapper : target;
  };
  const key = element => element.dataset.formTreeNode ?? element.dataset.element ?? element.dataset.formDropRoot;
  const addAt = (attribute, row, position) => formAttributeAddition(rows(), state.model.root, state.formLayout, attribute, row, position);
  function clearMarker() {
    marker?.removeAttribute('data-form-drop');
    marker = undefined;
  }
  function stopScroll() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = scroll = undefined;
  }
  function clear() {
    dragged = undefined;
    stopScroll();
    clearMarker();
  }
  function movable(key) {
    if (!controller.writable() || !state.formLayout || controller.edit() || controller.replaying()) return false;
    const row = rows().get(key);
    return !!row && !!siblingRow(rows(), row) && elementTarget(row.node, state.model?.root)?.kind === 'element';
  }
  function start(event) {
    clear();
    if (!event.dataTransfer || !controller.writable() || controller.edit()) return;
    const attribute = event.target.closest?.('[data-form-attribute]');
    const element = targetElement(event.target);
    if (attribute?.draggable) dragged = { key: attribute.dataset.formAttribute, type: attributeMime };
    else if (element?.draggable && movable(key(element))) dragged = { key: key(element), type: elementMime };
    if (!dragged) return;
    dragged.revision = state.revision;
    dragged.session = state.formSessionId;
    event.dataTransfer.effectAllowed = dragged.type === elementMime ? 'move' : 'copy';
    event.dataTransfer.setData(dragged.type, dragged.key);
  }
  function currentDrag() {
    return dragged && dragged.revision === state.revision && dragged.session === state.formSessionId
      && controller.writable() && !controller.edit()
      && (dragged.type === elementMime ? movable(dragged.key) : !!index().byData.get(dragged.key));
  }
  function placement(hit, point) {
    const element = targetElement(hit);
    if (!element) return;
    const attribute = dragged.type === attributeMime ? index().byData.get(dragged.key) : undefined;
    if (attribute && !element.dataset.formTreeNode) return;
    const source = !attribute && rows().get(dragged.key);
    function geometry(target) {
      const horizontal = target.parentElement?.classList.contains('taxi-items--horizontal');
      const rect = previewClientRect(target);
      const extent = horizontal ? rect.width : rect.height;
      const offset = horizontal ? point.clientX - rect.left : point.clientY - rect.top;
      return { horizontal, rect, extent, offset };
    }
    function tryPosition(target, row, position, horizontal) {
      if (!row) return;
      const move = source && formMovePlacement(rows(), state.model.root, state.formLayout, source, row, position);
      const operation = move ? { kind: 'moveElement', ...move } : attribute && addAt(attribute, row, position);
      return operation && { element: target, operation, position, horizontal };
    }
    const row = rows().get(key(element));
    if (!row) return;
    const { horizontal, extent, offset } = geometry(element);
    if (extent <= 0) return;
    if (row.node.kind === 'Form') return tryPosition(element, row, 'inside', horizontal);

    // Descendants can cover a group's outer edge. Offer only a narrow band
    // inside that edge, and use the same catalogue checks as direct targets.
    if (element.matches(previewTarget)) {
      let nearest, distance = Infinity;
      for (let parent = element.parentElement?.closest('.taxi-element[data-element]'); parent;
        parent = parent.parentElement?.closest('.taxi-element[data-element]')) {
        const { rect, extent, offset, horizontal } = geometry(parent);
        if (point.clientX < rect.left || point.clientX > rect.right || point.clientY < rect.top || point.clientY > rect.bottom) continue;
        const edge = Math.min(offset, extent - offset);
        if (edge > Math.min(6, extent / 4) || edge >= distance) continue;
        const candidate = tryPosition(parent, rows().get(key(parent)), offset < extent / 2 ? 'before' : 'after', horizontal);
        if (candidate) { nearest = candidate; distance = edge; }
      }
      if (nearest) return nearest;
    }
    const adjacent = offset < extent / 2 ? 'before' : 'after';
    const edge = element.dataset.formTreeNode ? extent / 4 : groupEdge(extent);
    if (offset >= edge && offset <= extent - edge) {
      const inside = tryPosition(element, row, 'inside', horizontal);
      if (inside) return inside;
    }
    return tryPosition(element, row, adjacent, horizontal);
  }
  function mark(target) {
    if (!target) { clearMarker(); return; }
    if (marker !== target.element) {
      clearMarker();
      marker = target.element;
    }
    const position = target.horizontal && target.position !== 'inside' ? target.position + '-x' : target.position;
    if (marker.dataset.formDrop !== position) marker.dataset.formDrop = position;
  }
  function scrollFrame() {
    frame = undefined;
    if (!currentDrag() || !scroll.viewport.isConnected) { clear(); return; }
    const { viewport, body, point } = scroll;
    const step = scrollStep(viewport, body, point);
    const { scrollLeft, scrollTop } = viewport, bodyTop = body?.scrollTop;
    if (step.x || step.y) viewport.scrollBy({ left: step.x, top: step.y, behavior: 'instant' });
    if (step.bodyY) body.scrollBy({ top: step.bodyY, behavior: 'instant' });
    if (viewport.scrollLeft === scrollLeft && viewport.scrollTop === scrollTop && body?.scrollTop === bodyTop) {
      stopScroll();
      return;
    }
    mark(placement(hitInPreview(viewport, point), point));
    frame = requestAnimationFrame(scrollFrame);
  }
  function over(event) {
    if (!currentDrag() || !event.dataTransfer?.types.includes(dragged.type)) { stopScroll(); clearMarker(); return; }
    const target = placement(dragHit(event), event);
    mark(target);
    const viewport = dragged.type === elementMime && event.target.closest?.('.preview-scroll');
    const point = { clientX: event.clientX, clientY: event.clientY };
    const body = viewport && viewport.querySelector('.taxi-form-scrollport[data-scrollable]');
    const step = viewport && scrollStep(viewport, body, point);
    if (step && (step.x || step.y || step.bodyY)) {
      scroll = { viewport, body, point };
      frame ??= requestAnimationFrame(scrollFrame);
    } else stopScroll();
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = target.operation.kind === 'moveElement' ? 'move' : 'copy';
  }
  function leave(event) {
    if (scroll?.viewport.contains(event.target) && !scroll.viewport.contains(event.relatedTarget)) {
      stopScroll();
      clearMarker();
    }
    if (marker?.contains(event.target) && !marker.contains(event.relatedTarget)) clearMarker();
  }
  function drop(event) {
    const target = currentDrag() && event.dataTransfer?.getData(dragged.type) === dragged.key
      && placement(dragHit(event), event);
    clear();
    if (!target) return;
    event.preventDefault();
    void controller.change([target.operation], undefined, target.operation.kind === 'addElement' ? 'placeAttribute' : 'change');
  }
  function addAttribute(attribute) {
    const root = rows().values().next().value;
    const row = rows().get(state.selected) ?? root;
    if (!row) return;
    const operation = addAt(attribute, row, 'inside') ?? addAt(attribute, row, 'after') ?? addAt(attribute, root, 'inside');
    if (operation) void controller.change([operation], undefined, 'placeAttribute');
  }
  return { start, over, leave, drop, clear, movable, addAttribute };
}
