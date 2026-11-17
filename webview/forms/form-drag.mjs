import { elementTarget, textProperty } from './editor-model.mjs';
import { previewClientRect } from './preview-coordinates.mjs';

const elementMime = 'application/x-eska-form-element';
const attributeMime = 'application/x-eska-form-attribute';

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
  let dragged, marker;
  const rows = () => index().nodes;
  const targetElement = event => {
    const target = event.target.closest?.('[data-form-tree-node], [data-element], [data-form-drop-root]');
    const wrapper = target?.closest('.taxi-element[data-element]');
    return wrapper && wrapper.dataset.element === target.dataset.element ? wrapper : target;
  };
  const key = element => element.dataset.formTreeNode ?? element.dataset.element ?? element.dataset.formDropRoot;
  const addAt = (attribute, row, position) => formAttributeAddition(rows(), state.model.root, state.formLayout, attribute, row, position);
  function clearMarker() {
    marker?.removeAttribute('data-form-drop');
    marker = undefined;
  }
  function clear() {
    dragged = undefined;
    clearMarker();
  }
  function movable(key) {
    if (!controller.writable() || !state.formLayout || controller.edit() || controller.replaying()) return false;
    const row = rows().get(key);
    return !!row && !!siblingRow(rows(), row) && elementTarget(row.node, state.model?.root)?.kind === 'element';
  }
  function start(event) {
    clear();
    if (!event.dataTransfer || !controller.writable()) return;
    const attribute = event.target.closest?.('[data-form-attribute]');
    const element = targetElement(event);
    if (attribute?.draggable) dragged = { key: attribute.dataset.formAttribute, type: attributeMime };
    else if (element?.draggable && movable(key(element))) dragged = { key: key(element), type: elementMime };
    if (!dragged) return;
    dragged.revision = state.revision;
    dragged.session = state.formSessionId;
    event.dataTransfer.effectAllowed = dragged.type === elementMime ? 'move' : 'copy';
    event.dataTransfer.setData(dragged.type, dragged.key);
  }
  function placement(event) {
    const element = targetElement(event);
    if (!element || !dragged || dragged.revision !== state.revision || dragged.session !== state.formSessionId
      || !controller.writable() || !event.dataTransfer?.types.includes(dragged.type)) return;
    const attribute = dragged.type === attributeMime ? index().byData.get(dragged.key) : undefined;
    if (dragged.type === attributeMime ? !attribute || !element.dataset.formTreeNode : !movable(dragged.key)) return;
    const source = !attribute && rows().get(dragged.key);
    const row = rows().get(key(element));
    if (!row) return;
    const horizontal = element.parentElement?.classList.contains('taxi-items--horizontal');
    const rect = previewClientRect(element);
    const extent = horizontal ? rect.width : rect.height;
    if (extent <= 0) return;
    const offset = (horizontal ? event.clientX - rect.left : event.clientY - rect.top) / extent;
    const adjacent = offset < .5 ? 'before' : 'after';
    const tryPosition = position => {
      const move = source && formMovePlacement(rows(), state.model.root, state.formLayout, source, row, position);
      const operation = move ? { kind: 'moveElement', ...move } : attribute && addAt(attribute, row, position);
      return operation && { element, operation, position, horizontal };
    };
    if (row.node.kind === 'Form') return tryPosition('inside');
    return offset >= .25 && offset <= .75 ? tryPosition('inside') ?? tryPosition(adjacent) : tryPosition(adjacent);
  }
  function over(event) {
    if (!dragged) return;
    const target = placement(event);
    if (!target) { clearMarker(); return; }
    event.preventDefault();
    event.dataTransfer.dropEffect = target.operation.kind === 'moveElement' ? 'move' : 'copy';
    if (marker !== target.element) {
      clearMarker();
      marker = target.element;
    }
    const position = target.horizontal && target.position !== 'inside' ? target.position + '-x' : target.position;
    if (marker.dataset.formDrop !== position) marker.dataset.formDrop = position;
  }
  function leave(event) {
    if (marker?.contains(event.target) && !marker.contains(event.relatedTarget)) clearMarker();
  }
  function drop(event) {
    const target = placement(event);
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
