import { createSignal } from 'solid-js';
import { createFontRaster } from './font-raster.mjs';
import binary from '../../resources/forms/native-text/font-raster.wasm';
import regular from '../../resources/forms/fonts/LiberationSans-Regular.ttf';
import bold from '../../resources/forms/fonts/LiberationSans-Bold.ttf';

/** A webview owns one lazy module and at most two immutable font faces. */
export function createNativeTextRuntime(scriptUrl, zoom = () => 100) {
  const [failed, setFailed] = createSignal(false);
  const [density, setDensity] = createSignal(window.devicePixelRatio);
  let resolution;
  const observeDensity = () => {
    resolution?.removeEventListener('change', observeDensity);
    setDensity(window.devicePixelRatio);
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    resolution.addEventListener('change', observeDensity);
  };
  observeDensity();
  const issues = new Set(), pending = new AbortController(), fonts = new Map();
  let engine, loading, disposed = false;
  const read = async asset => {
    const response = await fetch(new URL(asset, scriptUrl), { signal: pending.signal });
    if (!response.ok) throw new Error('font-raster-resource');
    return new Uint8Array(await response.arrayBuffer());
  };
  return {
    failed,
    // Native glyph bitmaps are calibrated for one physical pixel per CSS pixel.
    // Browser text retains the same layout while remaining sharp on scaled displays.
    pixelAligned: () => density() === 1 && zoom() === 100,
    issue(owner, value) {
      if (disposed) return;
      if (value) issues.add(owner); else issues.delete(owner);
      setFailed(issues.size > 0);
    },
    async face(weight) {
      if (disposed) throw new Error('font-raster-disposed');
      if (!loading) loading = read(binary).then(bytes => {
        if (disposed) throw new Error('font-raster-disposed');
        engine = createFontRaster(bytes); return engine;
      });
      const key = Number(weight) > 500 ? 'bold' : 'regular';
      if (!fonts.has(key)) fonts.set(key, Promise.all([loading, read(key === 'bold' ? bold : regular)]).then(([module, bytes]) => {
        if (disposed) throw new Error('font-raster-disposed');
        return module.open(bytes);
      }));
      return fonts.get(key);
    },
    dispose() {
      if (disposed) return;
      resolution?.removeEventListener('change', observeDensity);
      disposed = true; pending.abort(); engine?.dispose(); engine = undefined;
      fonts.clear(); issues.clear(); setFailed(false);
    },
  };
}
