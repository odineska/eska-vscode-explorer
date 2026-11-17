import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { previewWindowFocus } from '../webview/forms/window-focus.mjs';

function fixture() {
  const events = new Map(), messages = [];
  let focused = false, focusRequests = 0;
  const create = runInNewContext('(' + previewWindowFocus.toString() + ')', {
    window: { focus: () => focusRequests++, addEventListener: (type, listener) => events.set(type, listener), removeEventListener: type => events.delete(type) },
    document: { hasFocus: () => focused, visibilityState: 'visible' },
  });
  return { messages, events, focusRequests: () => focusRequests, dispose: create(value => messages.push(structuredClone(value))),
    focus(value) { focused = value; events.get('focus')?.(); },
    request(token) { events.get('message')?.({ data: { type: 'focusPreviewWindow', token } }); } };
}

test('window request waits for actual DOM focus and acknowledges exactly once', () => {
  const f = fixture(); f.request('first'); f.request('first'); assert.deepEqual(f.messages, []); assert.equal(f.focusRequests(), 1, 'one focus request, never a retry loop');
  f.focus(true); f.focus(true);
  assert.deepEqual(f.messages, [{ type: 'previewWindowFocused', token: 'first' }]);
  f.dispose(); assert.equal(f.events.size, 0);
});

test('already focused documents answer immediately and superseded requests do not replay', () => {
  const f = fixture(); f.request('old'); f.request('latest'); f.focus(true); f.request('next');
  assert.deepEqual(f.messages.map(value => value.token), ['latest', 'next']); f.dispose();
});

test('invalid requests and disposed documents never claim window focus', () => {
  const f = fixture(); f.focus(true);
  for (const token of [null, 4, '', 'x'.repeat(81)]) f.request(token);
  f.dispose(); f.request('closed'); f.focus(true); assert.deepEqual(f.messages, []);
});


test('acknowledged request cannot reclaim focus when the developer later switches away', () => {
  const f = fixture(); f.request('same'); f.focus(true);
  assert.equal(f.focusRequests(), 1);
  f.focus(false); f.request('same');
  assert.equal(f.focusRequests(), 1, 'a duplicate after blur never focuses again');
  assert.equal(f.messages.length, 1);
  f.request('new'); assert.equal(f.focusRequests(), 2, 'a separate explicit action has a new nonce'); f.dispose();
});
