import { onCleanup } from 'solid-js';
import { boundingScale } from './layout-box.mjs';

/** A floating menu may extend beyond its form, but must fit the host webview. */
export function positionCommandMenu(menu, anchor, nested) {
  const viewport = anchor.closest('.preview-scroll');
  const place = () => {
    const scale = boundingScale(anchor);
    if (!(scale > 0)) return;
    const rect = anchor.getBoundingClientRect();
    const width = window.innerWidth - 2, height = window.innerHeight - 2;
    menu.style.setProperty('--taxi-menu-max-width', `${width / scale}px`);
    const menuWidth = menu.getBoundingClientRect().width;
    const preferredLeft = nested ? rect.right - scale : rect.left;
    const alternateLeft = nested ? rect.left - menuWidth + scale : width - menuWidth;
    const left = Math.max(0, preferredLeft + menuWidth <= width ? preferredLeft : alternateLeft);
    const top = Math.max(0, Math.min(nested ? rect.top : rect.bottom, height - 60 * scale));
    menu.style.left = `${left / scale}px`;
    menu.style.top = `${top / scale}px`;
    menu.style.maxHeight = `${(height - top) / scale}px`;
  };
  place();
  const observer = new ResizeObserver(place);
  observer.observe(menu);
  observer.observe(anchor);
  if (viewport) observer.observe(viewport);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  onCleanup(() => {
    observer.disconnect();
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  });
}
