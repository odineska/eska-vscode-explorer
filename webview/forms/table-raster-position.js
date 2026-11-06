/** Match table-border raster coordinates while the surrounding preview resizes. */
export function observeTableRasterPosition(element, observer) {
  let viewport, shell;
  return (height, zoom) => {
    // A Solid branch may paint once before all its ancestors are attached.
    if (!viewport) {
      const bar = element.closest('.taxi-table-command-bar, .taxi-command-bar[data-table-commands]');
      viewport = bar?.closest('.preview-scroll');
      shell = viewport?.closest('.form-shell');
      const inspectors = shell?.querySelector('.form-inspectors');
      if (viewport) observer.observe(viewport);
      if (inspectors) observer.observe(inspectors);
    }
    if (!viewport || zoom !== 100 || devicePixelRatio !== 1) return;
    const rect = element.getBoundingClientRect();
    // Keep the paint origin in the scrolled content's logical coordinates.
    const x = rect.x + viewport.scrollLeft + (shell?.scrollLeft ?? 0);
    const y = rect.y + viewport.scrollTop + (shell?.scrollTop ?? 0);
    if (rect.height === height && rect.width >= 7 && [x,y,rect.width].every(value => Number.isInteger(value) && Math.abs(value) < 16000))
      return {x,y,width:rect.width};
  };
}
