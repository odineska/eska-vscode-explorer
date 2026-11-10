export function Splitter(props) {
  let start, initial;
  const position = event => props.vertical ? event.clientX : event.clientY;
  const range = () => props.range;
  const disabled = () => range() && range().maximum <= range().minimum;

  return <div role="separator" tabindex={disabled() ? -1 : 0} aria-orientation={props.vertical ? 'vertical' : 'horizontal'}
    aria-label={props.label} aria-disabled={disabled() || undefined} aria-valuemin={range()?.minimum}
    aria-valuemax={range()?.maximum} aria-valuenow={range() ? props.value() : undefined}
    class={props.class ?? (props.vertical ? 'form-splitter form-splitter--vertical' : 'form-splitter')}
    onClick={event => event.stopPropagation()} onDblClick={event => event.stopPropagation()}
    onPointerDown={event => {
      if (event.button !== 0 || disabled()) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      start = position(event);
      initial = props.value();
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        props.change(initial + (position(event) - start) * (props.factor?.() ?? 1));
      }
    }}
    onKeyDown={event => {
      if (disabled()) return;
      const delta = { ArrowLeft: -10, ArrowUp: -10, ArrowRight: 10, ArrowDown: 10 }[event.key];
      const edge = { Home: 'minimum', End: 'maximum' }[event.key];
      const bound = range()?.[edge];
      if (bound === undefined && delta === undefined) return;
      event.preventDefault();
      props.change(bound ?? props.value() + delta, edge);
    }}/>
}
