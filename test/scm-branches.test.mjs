import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
function load(ui = {}) {
  const url = new URL('../out/scm-branches.js', import.meta.url), require = createRequire(url), module = { exports: {} };
  const event = () => ({ dispose() {} });
  ui.createQuickPick = () => {
    let accept, hide;
    const picker = { value: ui.query ?? '', activeItems: [], items: [], onDidHide: fn => { hide = fn; return event(); }, onDidAccept: fn => { accept = fn; return event(); }, onDidChangeValue: event,
      show() { Promise.resolve(ui.showQuickPick(picker.items)).then(item => { if (item) { picker.activeItems = [item]; accept(); } else hide(); }); }, dispose() {} };
    return picker;
  };
  ui.createInputBox = () => {
    let accept, hide, change, button;
    const input = {
      value: '',
      onDidHide: fn => { hide = fn; return event(); },
      onDidAccept: fn => { accept = fn; return event(); },
      onDidChangeValue: fn => { change = fn; return event(); },
      onDidTriggerButton: fn => { button = fn; return event(); },
      show() {
        Promise.resolve(ui.showInputBox({ ...input,
          validateInput: value => { change(value); return input.validationMessage; },
          regenerate: () => { button(); return input.value; },
        })).then(value => { if (value === undefined) hide(); else { input.value = value; accept(); } });
      },
      dispose() {},
    };
    return input;
  };
  const vscode = { ThemeIcon: class {}, QuickPickItemKind: { Separator: -1 }, InputBoxValidationSeverity: { Info: 1, Error: 3 }, workspace: { getConfiguration: () => ({ get: (key, fallback) => ui.config?.[key] ?? fallback }) }, window: ui };
  runInNewContext('(function(require,module,exports){' + readFileSync(url, 'utf8') + '\n})')(name => name === 'vscode' ? vscode : require(name), module, module.exports);
  return module.exports;
}
const refs = [{ name: 'main', kind: 'local' }, { name: 'origin/topic', kind: 'remote' }, { name: 'v1', kind: 'tag' }];
test('create from picks the base before asking for a name and honors git branch settings', async () => {
  const events = [];
  const { pickBranchAction } = load({ config: { branchPrefix: 'feat/', branchWhitespaceChar: '_', branchValidationRegex: '^feat/' },
    showQuickPick: async items => { events.push('pick'); return events.length === 1 ? items.find(item => item.action === 'from') : items.find(item => item.ref?.kind === 'tag'); },
    showInputBox: async options => { events.push('input'); assert.equal(options.value, 'feat/'); assert.equal(options.validateInput('main'), 'exists'); assert.equal(options.validateInput('other'), 'regex'); assert.equal(options.validateInput('feat/name with space').message, 'sanitized'); return 'feat/name with space'; } });
  const action = await pickBranchAction(refs, {}, key => key, () => true);
  assert.deepEqual(JSON.parse(JSON.stringify(action)), { target: { name: 'v1', kind: 'tag' }, branch: 'feat/name_with_space' });
  assert.deepEqual(events, ['pick', 'pick', 'input']);
});
test('cancel at base or name performs no mutation and checkoutType filters refs', async () => {
  let calls = 0;
  const { pickBranchAction } = load({ config: { checkoutType: ['tags'] }, showQuickPick: async items => {
    calls++; if (calls > 1) return undefined;
    assert.equal(items.filter(item => item.ref).length, 1); assert.equal(items.find(item => item.ref).ref.kind, 'tag'); return items.find(item => item.action === 'from');
  }, showInputBox: async () => { throw Error('must not prompt'); } });
  assert.equal(await pickBranchAction(refs, {}, key => key, () => true), undefined);
});
test('typed query creates directly after selecting the source and cancellation of name returns nothing', async () => {
  let picks = 0;
  const { pickBranchAction } = load({ query: 'new topic', showQuickPick: async items => ++picks === 1 ? items.find(item => item.action === 'from') : items.find(item => item.ref?.kind === 'remote'), showInputBox: async () => { throw Error('typed name should be reused'); } });
  const result = await pickBranchAction(refs, {}, key => key, () => true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { target: { name: 'origin/topic', kind: 'remote' }, branch: 'new-topic' });
  const cancelled = load({ showQuickPick: async items => items.find(item => item.action === 'create'), showInputBox: async () => undefined });
  assert.equal(await cancelled.pickBranchAction(refs, {}, key => key, () => true), undefined);
});
test('random names use the configured dictionaries and prefix and can be regenerated', async () => {
  const { pickBranchAction } = load({ config: { branchPrefix: 'feature/', 'branchRandomName.enable': true, 'branchRandomName.dictionary': ['numbers'], branchWhitespaceChar: '_' }, showQuickPick: async items => items.find(item => item.action === 'create'), showInputBox: async options => {
    assert.match(options.value, /^feature\/\d{3}$/); assert.equal(options.buttons[0].tooltip, 'regenerate'); assert.match(options.regenerate(), /^feature\/\d{3}$/); return options.value;
  } });
  assert.match((await pickBranchAction(refs, {}, key => key, () => true)).branch, /^feature\/\d{3}$/);
});
