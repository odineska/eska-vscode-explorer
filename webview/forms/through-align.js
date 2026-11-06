import { scalar } from './model.mjs';
import { horizontalGrouping, ordinaryGroup } from './layout-model.mjs';

const leftLabelRow = '.taxi-field-row[data-title-location=Left]:has(> .taxi-field-label)';

function sharesLabels(node) {
  if (!ordinaryGroup(node)) return false;
  const mode = scalar(node, 'ThroughAlign', 'Auto');
  return mode === 'Use' || mode === 'Auto' && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'));
}

function labelScope(node) {
  return node.presentation.grouping === 'Vertical' && (['Form', 'Page'].includes(node.kind) || ordinaryGroup(node));
}

/** Share the leading title track across ordinary vertical groups without changing their owners. */
export function alignThroughLabels(model, { targets: { containers }, alignment, scale }) {
  const scopes = [];
  function visit(node, parentScope) {
    const items = containers.get(node.key);
    const horizontal = ordinaryGroup(node) && horizontalGrouping(node);
    const scope = items && (horizontal ? parentScope : labelScope(node) ? parentScope ?? [] : undefined);
    const leading = horizontal ? items?.firstElementChild : undefined;
    if (scope) {
      const row = horizontal ? leading?.querySelector(`:scope > ${leftLabelRow}`)
        : items.querySelector(`:scope > .taxi-element--field > ${leftLabelRow}`);
      if (row) scope.push({ container: items, track: horizontal ? row : items, horizontal });
    }
    // A horizontal group continues the parent's column through its leading branch.
    // Other branches can still align within their own vertical scopes.
    for (const child of node.children) {
      const shared = scope && sharesLabels(child) && (!horizontal || child.key === leading?.dataset.element);
      visit(child, shared ? scope : undefined);
    }
    // A vertical stack made of horizontal rows shares its columns in alignUnitedColumns.
    if (!parentScope && scope?.length > 1 && scope.some(entry => !entry.horizontal)) scopes.push(scope);
  }
  visit(model);

  const tracks = scopes.map(scope => scope.map(({ container, track, horizontal }) => {
    const css = getComputedStyle(track);
    const width = parseFloat(css.gridTemplateColumns);
    const left = track.getBoundingClientRect().left / scale + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
    return { container, horizontal, left, end: left + width };
  })).filter(scope => scope.every(track => Number.isFinite(track.end)));
  for (const scope of tracks) {
    const end = Math.max(...scope.map(track => track.end));
    for (const {container, horizontal, left} of scope) {
      alignment.mark(container, 'data-through-labels', horizontal ? 'leading' : 'all');
      alignment.style(container, '--taxi-through-label-width', `${end - left}px`);
    }
  }
}
