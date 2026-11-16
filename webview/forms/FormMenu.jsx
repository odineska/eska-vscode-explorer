import { For, Show, createSignal, onCleanup } from 'solid-js';
import { InspectorIcon } from './InspectorIcon.jsx';

export function createFormMenu() {
  const [menu, setMenu] = createSignal(null);
  function close(restore = true) {
    const anchor = menu()?.anchor;
    setMenu(null);
    if (restore && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }
  function open({ anchor, x, y, label, actions }) {
    const bounds = anchor.getBoundingClientRect();
    setMenu({ anchor, x: x ?? bounds.left, y: y ?? bounds.bottom, label, actions });
  }
  return { menu, open, close };
}

function Popup(props) {
  const { entry, controller } = props;
  const itemButtons = () => [...popup.querySelectorAll('button:not(:disabled)')];
  let popup;
  function dismiss(event) {
    if (!popup.contains(event.target) && !entry.anchor.contains(event.target)) controller.close(false);
  }
  function layout() {
    const width = popup.offsetWidth, height = popup.offsetHeight;
    popup.style.left = Math.max(4, Math.min(entry.x, window.innerWidth - width - 4)) + 'px';
    popup.style.top = Math.max(4, Math.min(entry.y, window.innerHeight - height - 4)) + 'px';
  }
  function mount(element) {
    popup = element;
    queueMicrotask(() => {
      if (!popup.isConnected) return;
      layout();
      (itemButtons()[0] ?? popup).focus();
    });
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', layout);
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', layout);
    });
  }
  function keyboard(event) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      controller.close();
      if (event.key === 'Escape') event.preventDefault();
      return;
    }
    const buttons = itemButtons();
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    const next = { Home: 0, End: buttons.length - 1, ArrowDown: (index + 1) % buttons.length,
      ArrowUp: (index + buttons.length - 1) % buttons.length }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons[next].focus();
  }
  return <div class="form-action-menu" role="menu" tabIndex="-1" aria-label={entry.label} ref={mount} onKeyDown={keyboard}>
    <div class="form-menu-context form-truncate">{entry.label}</div>
    <For each={entry.actions}>{action => <button type="button" role="menuitem" data-edit-action={action.id}
      disabled={action.disabled} onClick={() => { controller.close(); action.run(); }}>
      <InspectorIcon name={action.icon}/><span>{action.label}</span>
    </button>}</For>
  </div>;
}

export function FormMenu(props) {
  return <Show when={props.controller.menu()} keyed>{entry => <Popup entry={entry} controller={props.controller}/>}</Show>;
}
