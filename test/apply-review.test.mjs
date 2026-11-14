import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApplyReview } from '../out/apply-review.js';

function fixture() {
  const panels = [];
  const api = { ViewColumn: { Active: 1 }, window: { createWebviewPanel(_type, title, _column, options) {
    const panel = { title, options, closed: false, messages: [],
      webview: { html: '', postMessage(value) { panel.messages.push(value); },
        onDidReceiveMessage(callback) { panel.receive = callback; return { dispose() {} }; } },
      onDidDispose(callback) { panel.close = callback; return { dispose() {} }; },
      dispose() { if (!panel.closed) { panel.closed = true; panel.close(); } },
    };
    panels.push(panel); return panel;
  } } };
  return { reviews: new ApplyReview(api), panels };
}

test('review transmits the complete list as text and accepts only an explicit acknowledgement', async () => {
  const { reviews, panels } = fixture();
  const detail = Array.from({ length: 1000 }, (_, i) => `Справочник.Товары${i}.МодульМенеджера`).join('\n') + '\n</pre><script>attack()</script>';
  const result = reviews.show('Review <xml>', detail, 'Apply', 'Cancel');
  const panel = panels[0];
  assert.ok(!panel.webview.html.includes(detail));
  assert.match(panel.webview.html, /textContent=value.detail/);
  assert.match(panel.webview.html, /overflow:auto/);
  assert.match(panel.webview.html, /minmax\(0,1fr\)/);
  panel.receive({ type: 'ready' });
  assert.equal(panel.messages[0].detail, detail);
  assert.equal(panel.messages[0].title, 'Review <xml>');
  panel.receive({ type: 'accept' });
  assert.equal(await result, true);
  assert.equal(panel.closed, true);
});

test('cancel, tab close and runtime disposal never authorize a write', async () => {
  const { reviews, panels } = fixture();
  const cancelled = reviews.show('Review', 'changes', 'Apply', 'Cancel');
  panels[0].receive({ type: 'cancel' });
  assert.equal(await cancelled, false);
  const closed = reviews.show('Review', 'changes', 'Apply', 'Cancel');
  panels[1].dispose();
  assert.equal(await closed, false);
  const first = reviews.show('First', 'changes', 'Apply', 'Cancel');
  const second = reviews.show('Second', 'changes', 'Apply', 'Cancel');
  reviews.dispose();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
});
