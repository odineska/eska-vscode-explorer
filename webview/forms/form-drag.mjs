import { elementTarget } from './editor-model.mjs';

const mime = 'application/x-eska-form-element';

function siblingRow(rows, row) {
  const parent = rows.get(row.parent);
  return parent?.node.children.some(child => child.key === row.key) ? parent : undefined;
}

/** Compute placement using the backend's parent catalogue and real, unfiltered siblings. */
export function formMovePlacement(rows, root, catalogue, source, target, position) {
  if (!source || !target || source === target || !siblingRow(rows, source)) return;
  const parent = position === 'inside' ? target : siblingRow(rows, target);
  if (!parent || !catalogue[parent.node.kind]?.includes(source.node.kind)) return;
  for (let ancestor = parent; ancestor; ancestor = rows.get(ancestor.parent)) {
    if (ancestor.key === source.key) return;
  }
  const owner = elementTarget(parent.node, root);
  const moved = elementTarget(source.node, root);
  if (!owner || moved?.kind !== 'element') return;
  const children = parent.node.children;
  const index = children.findIndex(child => child.key === target.key);
  const before = position === 'before' ? target.node :
    position === 'after' ? children.slice(index + 1).find(child => child.key !== source.key) : undefined;
  const anchor = before ? elementTarget(before, root) : null;
  if (before && anchor?.kind !== 'element') return;
  return { target: moved, parent: owner, before: anchor?.id ?? null };
}

export function createFormDrag(controller, index) {
  const { state } = controller;
  let dragged, marker;
  const rows = () => index().nodes;
  const targetElement = event => event.target.closest?.('[data-form-tree-node], [data-element], [data-form-drop-root]');
  const key = element => element.dataset.formTreeNode ?? element.dataset.element ?? element.dataset.formDropRoot;
  function clearMarker() {
    marker?.removeAttribute('data-form-drop');
    marker = undefined;
  }
  function clear() {
    dragged = undefined;
    clearMarker();
  }
  function movable(key) {
    if (!state.authoring || !state.formLayout || controller.edit()) return false;
    const row = rows().get(key);
    const root = state.model?.root;
    return !!row && !!siblingRow(rows(), row) && elementTarget(row.node, root)?.kind === 'element';
  }
  function start(event) {
    clear();
    const element = targetElement(event);
    if (!element?.draggable || !event.dataTransfer || !movable(key(element))) return;
    dragged = { key: key(element), revision: state.revision, session: state.formSessionId };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(mime, dragged.key);
  }
  function placement(event) {
    const element = targetElement(event);
    if (!element || !dragged || dragged.revision !== state.revision || dragged.session !== state.formSessionId
      || !event.dataTransfer?.types.includes(mime) || !movable(dragged.key)) return;
    const source = rows().get(dragged.key);
    const destination = rows().get(key(element));
    if (!destination) return;
    const horizontal = element.parentElement?.classList.contains('taxi-items--horizontal');
    const rect = element.getBoundingClientRect();
    const offset = horizontal ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
    const adjacent = offset < .5 ? 'before' : 'after';
    const tryPosition = position => {
      const move = formMovePlacement(rows(), state.model.root, state.formLayout, source, destination, position);
      return move && { element, move, position, horizontal, source, destination };
    };
    if (destination.node.kind === 'Form') return tryPosition('inside');
    return offset >= .25 && offset <= .75 ? tryPosition('inside') ?? tryPosition(adjacent) : tryPosition(adjacent);
  }
  function over(event) {
    if (!dragged) return;
    const target = placement(event);
    clearMarker();
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    marker = target.element;
    marker.dataset.formDrop = target.horizontal && target.position !== 'inside' ? target.position + '-x' : target.position;
  }
  function leave(event) {
    if (marker?.contains(event.target) && !marker.contains(event.relatedTarget)) clearMarker();
  }
  function drop(event) {
    const target = placement(event);
    clear();
    if (!target) return;
    event.preventDefault();
    const { move, source, destination, position } = target;
    if (position === 'inside' && state.ui.folded[destination.key]) {
      controller.ui('folded', { ...state.ui.folded, [destination.key]: false });
    }
    controller.select(source.node);
    controller.openEditor('move', move.target, undefined, { parent: move.parent, before: move.before });
  }
  return { movable, start, over, leave, drop, clear };
}
