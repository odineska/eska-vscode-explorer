import { property, scalar } from './model.mjs';

function verticalGroup(node) {
  return node.kind === 'UsualGroup' && node.presentation.grouping === 'Vertical'
    && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'));
}

function sharesLabels(node) {
  return verticalGroup(node) && ['Auto', 'Use'].includes(scalar(node, 'ThroughAlign', 'Auto'))
    && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto')) && !property(node, 'BackColor');
}

/** Share the leading title track across ordinary vertical groups without changing their owners. */
export function alignThroughLabels(model, containers) {
  const scopes = [];
  function visit(node, parentScope) {
    const items = containers.get(node.key);
    const scope = items && verticalGroup(node) ? parentScope ?? [] : undefined;
    if (scope && items.querySelector(':scope > .taxi-element--field > [data-title-location=Left] > .taxi-field-label')) {
      scope.push(items);
    }
    // A group's setting controls whether it shares with its parent. Its children can still share locally.
    for (const child of node.children) visit(child, scope && sharesLabels(child) ? scope : undefined);
    if (!parentScope && scope?.length > 1) scopes.push(scope);
  }
  visit(model);

  const tracks = scopes.map(items => ({
    items,
    width: Math.max(...items.map(container => parseFloat(getComputedStyle(container).gridTemplateColumns))),
  })).filter(track => Number.isFinite(track.width));
  for (const {items, width} of tracks) {
    for (const container of items) {
      container.setAttribute('data-through-labels', '');
      container.style.setProperty('--taxi-through-label-width', `${width}px`);
    }
  }
  return () => {
    for (const {items} of tracks) {
      for (const container of items) {
        container.removeAttribute('data-through-labels');
        container.style.removeProperty('--taxi-through-label-width');
      }
    }
  };
}
