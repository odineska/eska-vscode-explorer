/** Acknowledge host window actions only after this actual document receives focus. */
export function previewWindowFocus(post) {
  let token, lastRequested;
  const acknowledge = () => {
    if (!token || !document.hasFocus()) return;
    const current = token; token = undefined;
    post({ type: 'previewWindowFocused', token: current });
  };
  const receive = event => {
    const value = event.data;
    if (value?.type !== 'focusPreviewWindow' || typeof value.token !== 'string' || !value.token || value.token.length > 80) return;
    const first = lastRequested !== value.token;
    lastRequested = value.token; token = value.token;
    // A moved webview may have a focused native window while its new iframe is
    // still unfocused. Complete this explicit host request once, not on startup.
    if (first && document.visibilityState === 'visible' && !document.hasFocus()) window.focus();
    acknowledge();
  };
  window.addEventListener('message', receive);
  window.addEventListener('focus', acknowledge, true);
  return () => {
    token = undefined; lastRequested = undefined;
    window.removeEventListener('message', receive);
    window.removeEventListener('focus', acknowledge, true);
  };
}
