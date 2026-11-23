import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acknowledgeDraft, acknowledgeInput, reconcilePendingCommits, selectRow, groupCount, rowWindow, positionRange, positionSelected, togglePosition } from '../webview/scm/model.mjs';

test('SCM selection supports ranges and toggle without losing its anchor', () => {
  const visible = ['first', 'middle', 'last', 'elsewhere'];
  const start = selectRow([], undefined, 'last', visible);
  const range = selectRow(start.keys, start.anchor, 'first', visible, { range: true });
  assert.deepEqual(range, { keys: ['first', 'middle', 'last'], anchor: 'last' });
  assert.deepEqual(selectRow(range.keys, range.anchor, 'elsewhere', visible, { range: true, toggle: true }), {
    keys: visible, anchor: 'last'
  });
  const removed = selectRow(range.keys, range.anchor, 'middle', visible, { toggle: true });
  assert.deepEqual(removed, { keys: ['first', 'last'], anchor: 'middle' });
  assert.deepEqual(selectRow([], 'collapsed', 'first', visible, { range: true }), {
    keys: ['first'], anchor: 'first'
  });
});

test('SCM draft keeps unacknowledged edits and accepts host updates after acknowledgement', () => {
  const local = { repositoryToken: 'old', value: 'new text', editId: 4 };
  const stale = { repositoryToken: 'old', message: 'previous text', acknowledgedEditId: 3 };
  assert.equal(acknowledgeDraft(local, stale), local);
  assert.deepEqual(acknowledgeDraft(undefined, stale), { repositoryToken: 'old', value: 'previous text', editId: 3 });
  assert.deepEqual(acknowledgeDraft(local, { repositoryToken: 'old', message: '', acknowledgedEditId: 4 }), { repositoryToken: 'old', value: '', editId: 4 });
});

test('SCM waits for acknowledgement of the active commit even if the message was already acknowledged', () => {
  const pending = new Map([['repo', { repositoryToken: 'old', commitId: 2 }]]);
  const stale = { key: 'repo', repositoryToken: 'old', acknowledgedCommitId: 1, acknowledgedEditId: 8 };
  assert.deepEqual(reconcilePendingCommits(pending, [stale]), pending);
  assert.deepEqual(reconcilePendingCommits(pending, [{ ...stale, acknowledgedCommitId: 2 }]), new Map());
  assert.deepEqual(reconcilePendingCommits(pending, []), new Map());
});

test('SCM discards draft and pending commit from a repository instance that closed', () => {
  const draft = { repositoryToken: 'old', value: 'pending draft', editId: 9 };
  const pending = new Map([['repo', { repositoryToken: 'old', commitId: 3 }]]);
  const reopened = { key: 'repo', repositoryToken: 'new', message: '', acknowledgedEditId: 0, acknowledgedCommitId: 0 };
  assert.deepEqual(acknowledgeDraft(draft, reopened), { repositoryToken: 'new', value: '', editId: 0 });
  assert.deepEqual(reconcilePendingCommits(pending, [reopened]), new Map());
});

test('SCM input updates preserve the current draft on echoes, stale edits and reopened repositories', () => {
  const draft = { repositoryToken: 'repo', value: 'current message', editId: 8 };
  const input = { repositoryToken: 'repo', message: 'current message', acknowledgedEditId: 8 };
  assert.equal(acknowledgeInput(draft, input), draft);
  assert.equal(acknowledgeInput(draft, { ...input, message: 'previous message', acknowledgedEditId: 7 }), draft);
  assert.equal(acknowledgeInput(draft, { ...input, repositoryToken: 'closed repo', acknowledgedEditId: 50 }), draft);
  assert.equal(acknowledgeInput(undefined, input), undefined);
  assert.deepEqual(acknowledgeInput(draft, { ...input, message: 'message from Git' }), { ...draft, value: 'message from Git' });
});

test('SCM viewport bounds DOM work for the full 113026-row inventory', () => {
  const count = 113026;
  assert.equal(groupCount({ count }), count);
  for (const top of [0, 22, 500000, count * 22 - 600]) {
    const window = rowWindow(count, top, 600);
    assert.ok(window.start >= 0 && window.end <= count);
    assert.ok(window.end - window.start <= 45);
  }
  assert.deepEqual(rowWindow(count, count * 22 - 22, 600), { start: count - 9, end: count });
});

test('SCM ranges span unloaded groups without allocating row keys', () => {
  const groups = [{ key: 'a', count: 113026 }, { key: 'b', count: 3 }, { key: 'c', count: 10 }];
  const ranges = positionRange(groups, { group: 'c', index: 5 }, { group: 'a', index: 1 });
  assert.deepEqual(ranges, [{ group: 'a', start: 1, end: 113025 }, { group: 'b', start: 0, end: 2 }, { group: 'c', start: 0, end: 5 }]);
  assert.equal(positionSelected(ranges, { group: 'a', index: 90000 }), true);
  const removed = togglePosition(ranges, { group: 'a', index: 90000 });
  assert.equal(positionSelected(removed, { group: 'a', index: 90000 }), false);
  assert.equal(positionSelected(removed, { group: 'a', index: 90001 }), true);
  assert.equal(positionSelected(togglePosition(removed, { group: 'a', index: 90000 }), { group: 'a', index: 90000 }), true);
});
