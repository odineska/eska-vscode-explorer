/** Paint after layout settles, with one redraw per animation frame. */
export function observeRasterPaint(element, paint) {
  let viewport, shell, scheduled;
  const position = (height, zoom) => {
    // A Solid branch may paint once before all its ancestors are attached.
    if (!viewport) {
      viewport = element.closest('.preview-scroll');
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

  // A resize callback can see the element and its ancestors in the same
  // delivery. Defer SVG and canvas writes until that delivery has finished.
  const schedule = () => {
    if (scheduled !== undefined) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = undefined;
      paint(position);
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  schedule();
  return () => {
    if (scheduled !== undefined) cancelAnimationFrame(scheduled);
    observer.disconnect();
  };
}
