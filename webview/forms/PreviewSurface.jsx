import { Show, onMount, onCleanup } from 'solid-js';
import { Preview } from './Preview.jsx';
import { InspectorIcon } from './InspectorIcon.jsx';

/** Window controls stay outside the scrolling form and its measured layout. */
export function PreviewSurface(props) {
  const c = props.controller, state = c.state;
  const detached = () => state.role === 'preview';
  let surface;
  onMount(() => {
    if (detached()) return;
    const viewport = surface.querySelector('.preview-scroll');
    const measure = () => surface.style.setProperty('--preview-scrollbar', `${viewport.offsetWidth - viewport.clientWidth}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return <div class="form-preview-surface" ref={surface}>
    <Preview controller={c}/>
    <Show when={!detached()}><button type="button" class="form-preview-window" title={state.strings.detach}
      aria-label={state.strings.detach} data-edit-action="detachPreview"
      onClick={() => c.post({ type: 'detach' })} onDblClick={event => event.stopPropagation()}>
      <InspectorIcon name="pip"/>
    </button></Show>
  </div>;
}
