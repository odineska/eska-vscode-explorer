const legacyClientRects = new WeakMap();

function legacyZoomClientRect(document) {
  if (!legacyClientRects.has(document)) {
    const probe = document.createElement('div');
    Object.assign(probe.style, {
      position: 'fixed', left: '0', top: '0', width: '10px', height: '0',
      margin: '0', padding: '0', border: '0', zoom: '2', visibility: 'hidden',
      pointerEvents: 'none',
    });
    document.body.append(probe);
    legacyClientRects.set(document, probe.getBoundingClientRect().width === 10);
    probe.remove();
  }
  return legacyClientRects.get(document);
}

/** Convert legacy Electron CSS zoom bounds to the coordinates used by pointer events. */
export function previewClientRect(element) {
  const rect = element.getBoundingClientRect();
  const zoom = Number(element.closest('.taxi-preview')?.style.zoom);
  if (!(zoom > 0) || zoom === 1 || !legacyZoomClientRect(element.ownerDocument)) return rect;
  return new element.ownerDocument.defaultView.DOMRect(rect.x * zoom, rect.y * zoom, rect.width * zoom, rect.height * zoom);
}
