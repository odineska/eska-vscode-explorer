import { automaticCommands, caption, flag, orderedCommands, property, scalar, text } from './model.mjs';

const formCommand = 'Form.StandardCommand.';
const standardItem = name => ({ key: formCommand + name, caption: { kind: 'standard', key: 'command.' + name } });
const customize = standardItem('CustomizeForm');
const help = standardItem('Help');
const defaultAdditional = new Set(['Reread', 'Copy', 'SetDeletionMark', 'Delete', 'UndoPosting', 'ShowInList', 'ChangeHistory', 'CustomizeForm']);
const standardPictures = new Map(Object.entries({
  WriteAndClose: 'PostAndClose', PostAndClose: 'PostAndClose', Write: 'Write',
  Reread: 'Refresh', Copy: 'CloneObject', SetDeletionMark: 'MarkObjectForDeletion',
  Delete: 'DeleteListItemDirectly', Post: 'Post', UndoPosting: 'UndoPosting',
  ShowInList: 'ShowInList', ChangeHistory: 'ChangeHistory', CustomizeForm: 'CustomizeForm', Help: 'Help',
}));
export const menuSeparator = Symbol('menu separator');

export function menuNode(item) {
  return item.presentation ? item : undefined;
}

function standardAction(item) {
  const key = item.presentation ? scalar(item, 'CommandName') : item.key;
  return key.split('.StandardCommand.')[1];
}

export function menuCaption(item, state, rootMenu) {
  if (item.presentation) return item.caption && !property(item, 'Title')
    ? text(item.caption, state.locale, state.strings) : caption(item, state);
  if (rootMenu && item.key === formCommand + 'SetDeletionMark') return state.strings['command.ToggleDeletionMark'];
  return text(item.caption, state.locale, state.strings);
}

export function menuPicture(item, rootMenu) {
  const picture = item.presentation?.picture ?? item.picture;
  if (picture || !rootMenu) return picture;
  const name = standardPictures.get(standardAction(item));
  return name ? { kind: 'standard', name } : undefined;
}

export function menuShortcut(item) {
  if (item.shortcut) return item.shortcut;
  const action = standardAction(item);
  return action === 'Write' ? 'Ctrl+S' : action === 'Help' ? 'F1' : undefined;
}

export function menuItems(items) {
  const flat = items.flatMap(item => {
    if (item.kind === 'ButtonGroup') return menuItems(item.children.filter(child => child.presentation.displayed));
    return [item];
  });
  return flat.flatMap((item, index) => item.beginGroup && index ? [menuSeparator, item] : [item]);
}

export function menuChildren(item, state) {
  return item.presentation && item.kind === 'Popup'
    ? menuItems(item.children.filter(child => child.presentation.displayed))
    : menuItems(orderedCommands(item.items ?? [], state));
}

export function menuEnabled(item) {
  return item.enabled !== false && (!item.presentation || flag(item, 'Enabled'));
}

function sectionItems(sections) {
  return sections.filter(group => group.length).flatMap((group, index) => index ? [menuSeparator, ...group] : group);
}

export function tableCommandRows(table, authored, fallback = [], sections = table.presentation.tableCommandMenu) {
  const declared = menuItems(authored).filter(item => item !== menuSeparator);
  const prefix = `Form.Item.${table.name}.StandardCommand.`;
  const generated = new Map(declared.map(item => {
    const reference = scalar(item, 'CommandName');
    return [reference.startsWith(prefix) ? 'Table.StandardCommand.' + reference.slice(prefix.length) : reference, item];
  }));
  const used = new Set();
  const groups = (sections ?? [fallback]).map(group => group.flatMap(item => {
    const override = generated.get(item.key);
    if (!override) return [item];
    used.add(override.key);
    return location(override) === 'InCommandBar' ? [] : [{ ...item, ...override }];
  }));
  const extra = declared.filter(item => !used.has(item.key) && location(item) !== 'InCommandBar');
  if (groups.length) groups.at(-1).push(...extra);
  else groups.push(extra);
  return sectionItems(groups);
}

export function rootCommandBar(node) {
  return node.auxiliary.find(item => item.kind === 'AutoCommandBar');
}

function location(item) {
  return scalar(item, 'LocationInCommandBar', 'Auto');
}

function additionalOnly(item) {
  const where = location(item);
  return where === 'InAdditionalSubmenu' || where === 'Auto' && defaultAdditional.has(standardAction(item));
}

function declaredCommands(items, output) {
  for (const item of items) {
    const command = scalar(item, 'CommandName');
    if (command) output.add(command);
    declaredCommands(item.children, output);
  }
  return output;
}

export function rootCommandPlacement(node, state) {
  const bar = rootCommandBar(node);
  const position = scalar(node, 'CommandBarLocation', 'Auto');
  const authoredAlignment = scalar(bar, 'HorizontalAlign');
  const alignment = ['Center', 'Right'].includes(authoredAlignment) ? authoredAlignment : 'Left';
  const declared = bar?.children ?? [];
  const authoredCommands = declaredCommands(declared, new Set());
  const automatic = automaticCommands(node, state).filter(item => !authoredCommands.has(item.key));
  const authored = declared.filter(item => item.presentation.displayed && (item.kind !== 'Button' || scalar(item, 'CommandName')));
  const autofill = flag(bar, 'Autofill');
  const objectSections = node.presentation.objectCommandMenu ?? [];
  const standard = new Set(objectSections.flat().map(item => item.key));
  const helpAvailable = state?.model?.formHelpAvailable;
  const authoredHelp = item => scalar(item, 'CommandName') === help.key;
  const missingHelpPage = item => helpAvailable === false && authoredHelp(item) && location(item) === 'Auto';
  const additional = item => additionalOnly(item) || missingHelpPage(item);
  const helpNode = helpAvailable === undefined ? undefined : authored.find(item => authoredHelp(item) && !additional(item));
  const inline = [...automatic, ...authored.filter(item => item !== helpNode && !additional(item))];
  const automaticTail = autofill && !!(bar || automatic.length);
  const more = automaticTail || authored.some(item =>
    additional(item) || location(item) === 'InCommandBarAndInAdditionalSubmenu');
  const rows = () => {
    const sections = objectSections.map(group => group.filter(item => !authoredCommands.has(item.key)));
    const extra = automatic.filter(item => !standard.has(item.key));
    extra.push(...menuItems(authored.filter(item =>
      additional(item) || location(item) === 'InCommandBarAndInAdditionalSubmenu' || autofill && location(item) === 'Auto')));
    if (autofill) {
      if (!authoredCommands.has(customize.key)) extra.push(customize);
      if (!authoredCommands.has(help.key)) extra.push(help);
    }
    const last = sections.at(-1);
    if (last) last.push(...extra);
    else sections.push(extra);
    return sectionItems(sections);
  };
  const showHelp = !!helpNode || automaticTail && helpAvailable !== false && !authoredCommands.has(help.key);
  return { inline, more, help: showHelp, helpNode, position, alignment, rows };
}

export function startsRootCommandSection(previous, item) {
  return item?.key === formCommand + 'Post' && previous?.key === formCommand + 'Write'
    || previous?.key === formCommand + 'Post';
}
