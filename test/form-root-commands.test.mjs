import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_NS } from '../webview/forms/model.mjs';
import { menuChildren, menuSeparator, rootCommandPlacement, startsRootCommandSection } from '../webview/forms/command-menu-model.mjs';
import { fitCommandPrefix } from '../webview/forms/root-command-layout.mjs';

const property = (name, text) => ({ key: { namespace: FORM_NS, name }, value: { kind: 'text', text } });
const standard = name => ({ key: `Form.StandardCommand.${name}` });
const keys = items => items.map(item => item === menuSeparator ? item : item.key);

function button(key, command, location) {
  return {
    key, kind: 'Button', children: [], presentation: { displayed: true },
    properties: [property('CommandName', command), ...(location ? [property('LocationInCommandBar', location)] : [])],
  };
}

function form({ inline = [], sections = [], authored = [], autofill = true } = {}) {
  return {
    auxiliary: [{ kind: 'AutoCommandBar', properties: [property('Autofill', String(autofill))], children: authored }],
    presentation: { autoCommandItems: inline, objectCommandMenu: sections },
  };
}

test('the main bar separates the fitted prefix from the full additional menu', () => {
  const [postAndClose, write, post, reread, copy, undo, show] =
    ['PostAndClose', 'Write', 'Post', 'Reread', 'Copy', 'UndoPosting', 'ShowInList'].map(standard);
  const print = { key: 'Print', items: [{ key: 'Invoice' }] };
  const direct = button('direct', reread.key, 'InCommandBar');
  const additional = button('additional', copy.key, 'InAdditionalSubmenu');
  const both = button('both', 'Form.Command.Toggle', 'InCommandBarAndInAdditionalSubmenu');
  const placement = rootCommandPlacement(form({
    inline: [postAndClose, write, post, print], sections: [[postAndClose, write, reread, copy], [post, undo], [show]],
    authored: [direct, additional, both],
  }));
  assert.deepEqual(keys(placement.inline), keys([postAndClose, write, post, print, direct, both]));
  assert.deepEqual(keys(placement.rows()), keys([
    postAndClose, write, menuSeparator, post, undo, menuSeparator, show, print, additional, both,
    standard('CustomizeForm'), standard('Help'),
  ]));
  assert.deepEqual(menuChildren(print), print.items);
  assert.equal(startsRootCommandSection(write, post), true);
  assert.equal(startsRootCommandSection(post, print), true);
  assert.equal(startsRootCommandSection(write, print), false);
});

test('manual placement can expose More without adding automatic commands or Help', () => {
  const direct = button('direct', standard('Reread').key, 'InCommandBar');
  const additional = button('additional', standard('Delete').key);
  const placement = rootCommandPlacement(form({ authored: [direct, additional], autofill: false }));
  assert.deepEqual(placement.inline, [direct]);
  assert.deepEqual(placement.rows(), [additional]);
  assert.equal(placement.more, true);
  assert.equal(placement.help, false);
  assert.deepEqual(rootCommandPlacement(form()).rows().map(item => item.key),
    [standard('CustomizeForm').key, standard('Help').key]);
});

test('command bar widths reserve More and Help without squeezing a command or skipping ahead', () => {
  const widths = [158, 84, 96, 128, 70, 91, 109, 30];
  for (const [width, visible] of [[192, 0], [302, 1], [412, 2], [532, 3], [652, 4], [882, 6], [972, 8]]) {
    assert.equal(fitCommandPrefix(widths, width - 33, 99, 9), visible, `form width ${width}`);
  }
});
