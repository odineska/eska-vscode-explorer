import { createEffect, onCleanup } from 'solid-js';

/** Pack whole categories without moving their DOM nodes, focus or logical reading order. */
export function PropertyGroups(props) {
  let container;
  createEffect(() => {
    if (!props.wide || !container) return;
    let frame;
    const measure = () => {
      frame = undefined;
      const style = getComputedStyle(container);
      const unit = parseFloat(style.getPropertyValue('--form-property-row'));
      const gap = parseFloat(style.getPropertyValue('--form-property-gap'));
      for (const table of container.children) {
        const span = 'span ' + Math.max(1, Math.ceil((table.getBoundingClientRect().height + gap) / unit));
        if (table.style.gridRowEnd !== span) table.style.gridRowEnd = span;
      }
      container.dataset.propertyLayout = 'packed';
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      resize.disconnect();
      resize.observe(container);
      for (const table of container.children) resize.observe(table);
      schedule();
    };
    const children = new MutationObserver(observe);
    children.observe(container, { childList: true });
    observe();
    onCleanup(() => {
      resize.disconnect();
      children.disconnect();
      cancelAnimationFrame(frame);
      delete container.dataset.propertyLayout;
      for (const table of container.children) table.style.removeProperty('grid-row-end');
    });
  });
  return <div ref={container} classList={{ 'form-property-groups': true, 'form-property-groups--wide': props.wide }}>{props.children}</div>;
}
