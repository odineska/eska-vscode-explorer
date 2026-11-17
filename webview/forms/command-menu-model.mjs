import { automaticCommands, caption, flag, orderedCommands, property, scalar, text } from './model.mjs';
import { isDynamicList } from './table-model.mjs';

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
const tableMenuPictures = new Map([
  ['Table.StandardCommand.Add', 'Add'],
  ['Table.StandardCommand.MoveUp', 'MoveUp'],
  ['Table.StandardCommand.MoveDown', 'MoveDown'],
]);
const ordinaryPictures = new Map([
  ...['Add', 'Copy', 'Change', 'Delete', 'EndEdit', 'CancelSearch', 'MoveUp', 'MoveDown',
    'SortListAsc', 'SortListDesc', 'OutputList'].map(name => [name, name]),
  ['Find', 'AdvancedSearch'],
]);
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

export function menuPicture(item, rootMenu, locale) {
  const picture = item.presentation?.picture ?? item.picture;
  if (picture?.variant === 'tableActionMenu' && locale?.startsWith('en')
      && ['SortListAsc', 'SortListDesc'].includes(picture.name)) {
    return { ...picture, name: picture.name + 'En' };
  }
  if (picture) return picture;
  if (!rootMenu) {
    const name = tableMenuPictures.get(item.key);
    return name ? { kind: 'standard', name, variant: 'tableActionMenu' } : undefined;
  }
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
  if (!item.presentation || item.kind !== 'Popup') return menuItems(orderedCommands(item.items ?? [], state));
  const children = item.children.filter(child => child.presentation.displayed);
  return item.ordinaryTableMenu ? sectionItems(ordinaryAuthoredGroups(children)) : menuItems(children);
}

export function menuEnabled(item) {
  return item.enabled !== false && (!item.presentation || flag(item, 'Enabled'));
}

function sectionItems(sections) {
  return sections.filter(group => group.length).flatMap((group, index) => index ? [menuSeparator, ...group] : group);
}

function ordinaryAuthoredGroups(items) {
  const groups = [];
  let group = [];
  function finishGroup() {
    if (group.length) groups.push(group);
    group = [];
  }
  for (const item of items) {
    if (!item.presentation.displayed || location(item) === 'InCommandBar') continue;
    if (item.kind === 'ButtonGroup') {
      const children = ordinaryAuthoredGroups(item.children);
      if (children.length) {
        finishGroup();
        groups.push(...children);
      }
    } else {
      group.push(item.kind === 'Popup' ? { ...item, ordinaryTableMenu: true } : item);
    }
  }
  finishGroup();
  return groups;
}

export function tableCommandRows(table, authored, fallback = [], sections = table.presentation.tableCommandMenu, { authoredOnly = false } = {}) {
  const ordinary = table.kind === 'Table' && !isDynamicList(table);
  const prefix = `Form.Item.${table.name}.StandardCommand.`;
  const commandKey = item => {
    const reference = scalar(item, 'CommandName');
    return reference.startsWith(prefix) ? 'Table.StandardCommand.' + reference.slice(prefix.length) : reference;
  };
  const generated = sections ?? [fallback];
  const declared = menuItems(authored).filter(item => item !== menuSeparator);
  const overrides = new Map(declared.map(item => [commandKey(item), item]));
  if (ordinary) {
    const project = item => {
      const picture = ordinaryPictures.get(item.picture?.name);
      return picture ? { ...item, picture: { kind: 'standard', name: picture, variant: 'tableActionMenu' } } : item;
    };
    const standards = new Map(generated.flat().map(item => [item.key, project(item)]));
    const groups = authoredOnly ? [] : generated.map(group =>
      group.filter(item => !overrides.has(item.key)).map(item => standards.get(item.key)));
    groups.push(...ordinaryAuthoredGroups(authored).map(group =>
      group.map(item => ({ ...standards.get(commandKey(item)), ...item }))));
    return sectionItems(groups);
  }
  const used = new Set();
  const groups = generated.map(group => group.flatMap(item => {
    const override = overrides.get(item.key);
    if (!override) return [item];
    used.add(override.key);
    return location(override) === 'InCommandBar' ? [] : [{ ...item, ...override }];
  }));
  const extra = item => !used.has(item.key) && location(item) !== 'InCommandBar';
  if (groups.length) {
    groups.at(-1).push(...declared.filter(extra));
  } else {
    groups.push(declared.filter(extra));
  }
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
  return { ...formCommandPlacement(node, bar, state), position, alignment };
}

export function formCommandPlacement(node, bar, state) {
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
  return { inline, more, help: showHelp, helpNode, rows };
}

export function startsRootCommandSection(previous, item) {
  return item?.key === formCommand + 'Post' && previous?.key === formCommand + 'Write'
    || previous?.key === formCommand + 'Post';
}
