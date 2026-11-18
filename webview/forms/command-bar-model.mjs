import { scalar } from './model.mjs';
import { availableTableSearchCommand, commandSourceTable, tableSearch, tableSearchReference } from './table-model.mjs';

function siblingBars(root, node) {
  if (root.children.includes(node)) {
    const grouping = scalar(root, 'Group', root.presentation.grouping);
    return ['Horizontal', 'AlwaysHorizontal', 'HorizontalIfPossible'].includes(grouping)
      ? root.children.filter(child => child.kind === 'CommandBar') : [];
  }
  for (const child of root.children) {
    if (!child.children.length) continue;
    const siblings = siblingBars(child, node);
    if (siblings.length) return siblings;
  }
  return [];
}

function commandsAtLocation(children, location) {
  return children.flatMap(child => {
    if (!child.presentation.displayed) return [];
    if (child.kind === 'ButtonGroup') return commandsAtLocation(child.children, location);
    return scalar(child, 'LocationInCommandBar', 'Auto') === location
      ? [scalar(child, 'CommandName')] : [];
  });
}

/** Use the same projected commands for rendering and for the bar's layout footprint. */
export function commandBarContent(root, node) {
  const source = commandSourceTable(root, node), search = !!tableSearch(source);
  const formSource = scalar(node, 'CommandSource') === 'Form';
  const trailing = [], additional = [];
  let hasOverflow = !!source || formSource, tableCommands = !!source, advancedSearch = false;
  const right = scalar(node, 'HorizontalLocation') === 'Right';
  const hasOwnMenuCopies = commandsAtLocation(node.children, 'InCommandBarAndInAdditionalSubmenu').some(Boolean);
  const siblings = (right || hasOwnMenuCopies) && node.kind === 'CommandBar' && !source && !formSource
    ? siblingBars(root, node).filter(bar => bar !== node && bar.presentation.displayed) : [];
  // A right-hand overflow bar can contain the menu counterpart of a sibling's inline command.
  const elsewhere = new Set(right ? siblings.flatMap(bar =>
    commandsAtLocation(bar.children, 'InCommandBarAndInAdditionalSubmenu')).filter(Boolean) : []);
  const sharedMenu = new Set(right ? [] : siblings.filter(bar => scalar(bar, 'HorizontalLocation') === 'Right')
    .flatMap(bar => [
      ...commandsAtLocation(bar.children, 'InAdditionalSubmenu'),
      ...commandsAtLocation(bar.children, 'Auto'),
    ]).filter(Boolean));
  function project(children, nested = false) {
    const projected = [];
    for (const child of children) {
      if (!child.presentation.displayed) continue;
      const command = scalar(child, 'CommandName'), reference = tableSearchReference(command);
      if (!availableTableSearchCommand(root, reference)) continue;
      tableCommands ||= !!reference;
      const customize = command === 'Form.StandardCommand.CustomizeForm';
      const location = scalar(child, 'LocationInCommandBar', 'Auto');
      const usesSearch = search && reference?.table === source?.name;
      if (usesSearch && location === 'Auto') continue;
      if (location === 'InAdditionalSubmenu' || location === 'Auto' && (customize || elsewhere.has(command))) {
        additional.push(child); hasOverflow = true; continue;
      }
      if (usesSearch && reference.action === 'Find') advancedSearch = true;
      if (child.kind === 'ButtonGroup') {
        const contents = project(child.children, true);
        if (contents.length) {
          const unchanged = contents.length === child.children.length
            && contents.every((item, index) => item === child.children[index]);
          projected.push(unchanged ? child : { ...child, children: contents });
        }
      } else {
        (customize && !nested ? trailing : projected).push(child);
      }
      if (location === 'InCommandBarAndInAdditionalSubmenu' && !sharedMenu.has(command)) additional.push(child);
    }
    return projected;
  }
  const inline = project(node.children);
  const more = hasOverflow ? additional : [];
  const spaceBeforeMore = !!source || formSource || more.length > 0;
  return { source, formSource, inline, trailing, more, tableCommands, advancedSearch, spaceBeforeMore,
    visible: spaceBeforeMore || !!(inline.length || trailing.length) };
}
