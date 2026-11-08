import { scalar } from './model.mjs';
import { availableTableSearchCommand, commandSourceTable, tableSearch, tableSearchReference } from './table-model.mjs';

/** Use the same projected commands for rendering and for the bar's layout footprint. */
export function commandBarContent(root, node) {
  const source = commandSourceTable(root, node), search = !!tableSearch(source);
  const inline = [], trailing = [], additional = [];
  let hasOverflow = !!source, tableCommands = !!source, advancedSearch = false;
  for (const child of node.children) {
    if (!child.presentation.displayed) continue;
    const command = scalar(child, 'CommandName'), reference = tableSearchReference(command);
    if (!availableTableSearchCommand(root, reference)) continue;
    tableCommands ||= !!reference;
    const customize = command === 'Form.StandardCommand.CustomizeForm';
    const location = scalar(child, 'LocationInCommandBar', 'Auto');
    const usesSearch = search && reference?.table === source?.name;
    if (usesSearch && location === 'Auto') continue;
    if (location === 'InAdditionalSubmenu' || customize && location === 'Auto') {
      additional.push(child); hasOverflow = true; continue;
    }
    if (usesSearch && reference.action === 'Find') advancedSearch = true;
    (customize ? trailing : inline).push(child);
    if (location === 'InCommandBarAndInAdditionalSubmenu') additional.push(child);
  }
  const more = hasOverflow ? additional : [];
  const spaceBeforeMore = !!source || more.length > 0;
  return { source, inline, trailing, more, tableCommands, advancedSearch, spaceBeforeMore,
    visible: spaceBeforeMore || !!(inline.length || trailing.length) };
}
