import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

test('profile changes remeasure retained geometry even when the model stays identical', async () => {
  const bundle = await build({
    stdin: { contents: `export { createFormLayout } from './webview/forms/responsive-layout.js';
      export { createRoot, createStore, flush } from 'solid-js';`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, write: false, platform: 'browser', format: 'cjs',
    conditions: ['browser', 'production'], define: { 'process.env.NODE_ENV': '"production"' },
  });
  const callbacks = new Map(), module = { exports: {} };
  let nextFrame = 0;
  const context = createContext({ module, exports: module.exports, console, queueMicrotask,
    requestAnimationFrame: callback => { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => callbacks.delete(id),
    ResizeObserver: class { observe() {} disconnect() {} }, document: {} });
  runInContext(bundle.outputFiles[0].text, context);
  runInContext(`
    var dispose, set;
    module.exports.createRoot(cleanup => {
      dispose = cleanup;
      var [state, update] = module.exports.createStore({
        profile: 'taxi-8.3.27', os: 'linux', locale: 'ru-RU', culture: 'ru-RU',
        ui: { zoom: 100, collapsed: {} },
        model: { root: { key: 'root', kind: 'Form', properties: [], presentation: {}, children: [], auxiliary: [] } }
      });
      set = update;
      module.exports.createFormLayout({ state }, () => ({}), () => ({}), () => ({}), () => 'Top');
    });
    module.exports.flush();
  `, context);
  assert.equal(callbacks.size, 1);
  const drain = () => { const frames = [...callbacks.values()]; callbacks.clear(); for (const callback of frames) callback(); };
  // A hidden webview retains its last measurements, but must schedule a fresh read on profile change.
  drain();
  for (const profile of ['version-8.5', 'taxi-8.3.27']) {
    runInContext(`set(draft => { draft.profile = '${profile}'; }); module.exports.flush();`, context);
    assert.equal(callbacks.size, 1, profile);
    drain();
  }
  runInContext(`set(draft => { draft.selected = 'another'; }); module.exports.flush();`, context);
  assert.equal(callbacks.size, 0, 'selection does not affect geometry');
  runInContext('dispose()', context);
});
