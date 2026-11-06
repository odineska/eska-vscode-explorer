import { automaticCommands, caption, flag, scalar, text } from './model.mjs';

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
  if (item.presentation) return caption(item, state);
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
  const action = standardAction(item);
  return action === 'Write' ? 'Ctrl+S' : action === 'Help' ? 'F1' : undefined;
}

export function menuItems(items) {
  return items.flatMap(item => {
    if (item.kind === 'ButtonGroup') return menuItems(item.children.filter(child => child.presentation.displayed));
    return [item];
  });
}

export function menuChildren(item) {
  return item.presentation
    ? item.kind === 'Popup' ? menuItems(item.children.filter(child => child.presentation.displayed)) : []
    : item.items ?? [];
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
  const declared = bar?.children ?? [];
  const authoredCommands = declaredCommands(declared, new Set());
  const automatic = automaticCommands(node, state).filter(item => !authoredCommands.has(item.key));
  const authored = declared.filter(item => item.presentation.displayed && (item.kind !== 'Button' || scalar(item, 'CommandName')));
  const autofill = flag(bar, 'Autofill');
  const objectSections = node.presentation.objectCommandMenu ?? [];
  const standard = new Set(objectSections.flat().map(item => item.key));
  const inline = [...automatic, ...authored.filter(item => !additionalOnly(item))];
  const automaticTail = autofill && !!(bar || automatic.length);
  const more = automaticTail || authored.some(item =>
    additionalOnly(item) || location(item) === 'InCommandBarAndInAdditionalSubmenu');
  const rows = () => {
    const sections = objectSections.map(group => group.filter(item => !authoredCommands.has(item.key)));
    const extra = automatic.filter(item => !standard.has(item.key));
    extra.push(...menuItems(authored.filter(item =>
      additionalOnly(item) || location(item) === 'InCommandBarAndInAdditionalSubmenu' || autofill && location(item) === 'Auto')));
    if (autofill) {
      if (!authoredCommands.has(customize.key)) extra.push(customize);
      if (!authoredCommands.has(help.key)) extra.push(help);
    }
    const last = sections.at(-1);
    if (last) last.push(...extra);
    else sections.push(extra);
    return sections.filter(group => group.length).flatMap((group, index) => index ? [menuSeparator, ...group] : group);
  };
  return { inline, more, help: automaticTail && !authoredCommands.has(help.key), rows };
}

export function startsRootCommandSection(previous, item) {
  return item?.key === formCommand + 'Post' && previous?.key === formCommand + 'Write'
    || previous?.key === formCommand + 'Post';
}
