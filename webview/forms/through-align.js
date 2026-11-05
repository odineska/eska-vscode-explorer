import { scalar } from './model.mjs';

function verticalGroup(node) {
  return node.kind === 'UsualGroup' && node.presentation.grouping === 'Vertical'
    && ['Auto', 'Usual'].includes(scalar(node, 'Behavior', 'Auto'));
}

function sharesLabels(node) {
  if (!verticalGroup(node)) return false;
  const mode = scalar(node, 'ThroughAlign', 'Auto');
  return mode === 'Use' || mode === 'Auto' && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'));
}

function labelScope(node) {
  return node.presentation.grouping === 'Vertical' && (['Form', 'Page'].includes(node.kind) || verticalGroup(node));
}

/** Share the leading title track across ordinary vertical groups without changing their owners. */
export function alignThroughLabels(model, containers, scale) {
  const scopes = [];
  function visit(node, parentScope) {
    const items = containers.get(node.key);
    const scope = items && labelScope(node) ? parentScope ?? [] : undefined;
    if (scope && items.querySelector(':scope > .taxi-element--field > [data-title-location=Left] > .taxi-field-label')) {
      scope.push(items);
    }
    // A group's setting controls whether it shares with its parent. Its children can still share locally.
    for (const child of node.children) visit(child, scope && sharesLabels(child) ? scope : undefined);
    if (!parentScope && scope?.length > 1) scopes.push(scope);
  }
  visit(model);

  const tracks = scopes.map(scope => scope.map(container => {
    const css = getComputedStyle(container);
    const width = parseFloat(css.gridTemplateColumns);
    const left = container.getBoundingClientRect().left / scale + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
    return { container, left, end: left + width };
  })).filter(scope => scope.every(track => Number.isFinite(track.end)));
  for (const scope of tracks) {
    const end = Math.max(...scope.map(track => track.end));
    for (const {container, left} of scope) {
      container.setAttribute('data-through-labels', '');
      container.style.setProperty('--taxi-through-label-width', `${end - left}px`);
    }
  }
  return () => {
    for (const {container} of tracks.flat()) {
      container.removeAttribute('data-through-labels');
      container.style.removeProperty('--taxi-through-label-width');
    }
  };
}
