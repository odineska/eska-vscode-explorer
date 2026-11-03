const MAX_FONT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_WIDTH = 8192;

/** Owns the module, memory-backed font files and reusable glyph-slot header. */
export function createFontRaster(bytes) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: { emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_close: () => 8, fd_read: () => 8 },
  });
  const api = instance.exports;
  api._initialize();
  let library = api.eska_ft_init();
  if (!library || api.eska_ft_version(library) !== 0x020d02) throw new Error('font-raster-version');
  let header = api.eska_ft_alloc(48);
  if (!header) { api.eska_ft_done(library); throw new Error('font-raster-memory'); }
  const faces = new Set();
  function open(bytes) {
    if (!library) throw new Error('font-raster-disposed');
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FONT_BYTES) throw new Error('font-raster-input');
    const data = api.eska_ft_alloc(bytes.length);
    if (!data) throw new Error('font-raster-memory');
    // Never retain a view across a WASM call: growing memory detaches old views.
    new Uint8Array(api.memory.buffer).set(bytes, data);
    let handle = api.eska_ft_open(library, data, bytes.length);
    if (!handle) { api.eska_ft_free(data); throw new Error('font-raster-font'); }
    const face = {
      raster(text, pixels, ascent, descent) {
        if (!handle) throw new Error('font-raster-disposed');
        if (typeof text !== 'string' || text.length > 4096 || /[\p{Mark}\p{Format}\p{Control}]/u.test(text)
            || !/^[\p{Script=Latin}\p{Script=Cyrillic}\p{Number}\p{Punctuation}\p{Separator}\p{Symbol}]*$/u.test(text)
            || !Number.isInteger(pixels) || pixels < 1 || pixels > 128
            || !Number.isInteger(ascent) || !Number.isInteger(descent) || ascent < 1 || descent < 0 || ascent + descent > 256) {
          throw new Error('font-raster-text');
        }
        if (api.eska_ft_size(handle, pixels)) throw new Error('font-raster-size');
        const glyphs = [];
        let width = 0, inkLeft = Infinity, inkRight = -Infinity;
        for (const char of text) {
          if (api.eska_ft_glyph(handle, char.codePointAt(0), header)) throw new Error('font-raster-glyph');
          const fields = [...new Int32Array(api.memory.buffer, header, 12)];
          const [advance, bearingX, , inkWidth, , left, top, columns, rows, pitch, address, mode] = fields;
          if (mode !== 5 || advance < 0 || advance % 64 || columns < 0 || columns > 4096 || rows < 0 || rows > 4096
              || pitch < columns * 3 || address < 0 || address + pitch * rows > api.memory.buffer.byteLength) {
            throw new Error('font-raster-bitmap');
          }
          if (width + advance / 64 > MAX_TEXT_WIDTH) throw new Error('font-raster-width');
          const coverage = new Uint8Array(columns * rows);
          for (let y = 0; y < rows; y++) {
            const source = new Uint8Array(api.memory.buffer, address + y * pitch, columns * 3);
            for (let x = 0; x < columns; x++) coverage[y * columns + x] = source[x * 3];
          }
          if (columns) {
            inkLeft = Math.min(inkLeft, width + bearingX / 64);
            inkRight = Math.max(inkRight, width + (bearingX + inkWidth) / 64);
          }
          glyphs.push({ pen: width, left, top, columns, rows, coverage });
          width += advance / 64;
        }
        const height = ascent + descent, alpha = new Uint8Array(width * height);
        const clipLeft = Math.max(0, inkLeft), clipRight = Math.min(width, inkRight);
        for (const glyph of glyphs) {
          for (let y = 0; y < glyph.rows; y++) {
            const ty = ascent - glyph.top + y;
            if (ty < 0 || ty >= height) continue;
            for (let x = 0; x < glyph.columns; x++) {
              const tx = glyph.pen + glyph.left + x;
              if (tx < clipLeft || tx >= clipRight) continue;
              const index = ty * width + tx;
              // Configurator adds LCD red-channel coverage before one tint pass.
              alpha[index] = Math.min(255, alpha[index] + glyph.coverage[y * glyph.columns + x]);
            }
          }
        }
        return { width, height, ascent, descent, alpha };
      },
      dispose() {
        if (!handle) return;
        api.eska_ft_close(handle); handle = 0;
        api.eska_ft_free(data); faces.delete(face);
      },
    };
    faces.add(face);
    return face;
  }
  return {
    open,
    dispose() {
      if (!library) return;
      for (const face of faces) face.dispose();
      api.eska_ft_free(header); header = 0;
      api.eska_ft_done(library); library = 0;
    },
  };
}
