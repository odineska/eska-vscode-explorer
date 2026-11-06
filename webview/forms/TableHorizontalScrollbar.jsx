import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { paintCanvas } from './native-control-paint.js';
import { horizontalScrollbarGeometry, scrollTableByColumn, tableHorizontalPaint } from './table-scrollbar.mjs';

function ScrollFragment(props) {
  let canvas;
  const image = createMemo(() => props.image);
  createEffect(() => { paintCanvas(canvas, image()); });
  return <canvas ref={canvas} width={image().width} height={image().height} style={{ left: `${props.x}px`, top: `${props.y}px` }} aria-hidden="true"/>;
}

/** The DOM remains the scroll owner. This strip renders its range and provides the Taxi controls. */
export function TableHorizontalScrollbar(props) {
  const [position, setPosition] = createSignal(0);
  const [pointer, setPointer] = createSignal();
  const [dragging, setDragging] = createSignal(false);
  let drag;
  createEffect(() => {
    const target = props.target;
    const read = () => setPosition(target.scrollLeft);
    read();
    target.addEventListener('scroll', read, { passive: true });
    onCleanup(() => target.removeEventListener('scroll', read));
  });

  const geometry = createMemo(() => horizontalScrollbarGeometry(props.viewport, props.grid, position()));
  const before = () => props.enabled && geometry().position > 0;
  const after = () => props.enabled && geometry().position < geometry().maximum;
  const overThumb = x => x >= geometry().thumbLeft && x < geometry().thumbRight;
  const thumbPaint = createMemo(() => {
    if (!props.enabled) return tableHorizontalPaint.disabled;
    return dragging() || overThumb(pointer()) ? tableHorizontalPaint.hover : tableHorizontalPaint.active;
  });
  const startCap = () => geometry().thumbLeft === geometry().trackLeft ? thumbPaint().outerStart : thumbPaint().innerStart;
  const endCap = () => geometry().thumbRight === geometry().trackRight ? thumbPaint().outerEnd : thumbPaint().innerEnd;
  const leftArrow = () => !before() ? tableHorizontalPaint.left.disabled
    : pointer() >= 0 && pointer() < geometry().trackLeft ? tableHorizontalPaint.left.hover : tableHorizontalPaint.left.active;
  const rightArrow = () => !after() ? tableHorizontalPaint.right.disabled
    : pointer() >= geometry().trackRight && pointer() < props.viewport ? tableHorizontalPaint.right.hover : tableHorizontalPaint.right.active;

  function scrollTo(next) {
    props.target.scrollLeft = Math.round(next);
    setPosition(props.target.scrollLeft);
  }
  function step(direction) {
    scrollTo(scrollTableByColumn(props.columns, props.viewport, props.target.scrollLeft, direction));
  }
  function pointerPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return (event.clientX - rect.left) * event.currentTarget.clientWidth / rect.width;
  }
  function press(event) {
    if (!props.enabled || event.button !== 0 || drag) return;
    const x = pointerPosition(event);
    if (x < 0 || x >= props.viewport) return;
    setPointer(x);
    if (!overThumb(x)) {
      step(x < geometry().thumbLeft ? -1 : 1);
      return;
    }
    if (!geometry().pixelsPerUnit) return;
    drag = { id: event.pointerId, x, offset: props.target.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function move(event) {
    const x = pointerPosition(event);
    setPointer(x);
    const scale = geometry().pixelsPerUnit;
    if (props.enabled && scale && drag?.id === event.pointerId) scrollTo(drag.offset + (x - drag.x) / scale);
  }
  function release(event) {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    setDragging(false);
  }
  function key(event) {
    if (!props.enabled) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp':
        step(-1);
        break;
      case 'ArrowRight':
      case 'PageDown':
        step(1);
        break;
      case 'Home':
        scrollTo(0);
        break;
      case 'End':
        scrollTo(geometry().maximum);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return <div class="taxi-table-horizontal-scrollbar" role="scrollbar" tabIndex={props.enabled ? 0 : -1}
    aria-label={props.label} aria-controls={props.target.id} aria-orientation="horizontal" aria-disabled={!props.enabled}
    aria-valuemin={0} aria-valuemax={geometry().maximum} aria-valuenow={geometry().position}
    onPointerDown={press} onPointerMove={move} onPointerLeave={() => setPointer(undefined)}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={key}
    onClick={event => event.stopPropagation()} onDblClick={event => event.stopPropagation()}>
    <span class="taxi-table-horizontal-track" style={{ left: `${geometry().trackLeft}px`, width: `${geometry().trackRight - geometry().trackLeft}px` }}/>
    <ScrollFragment image={tableHorizontalPaint.trackStart} x={geometry().trackLeft} y={3}/>
    <ScrollFragment image={tableHorizontalPaint.trackEnd} x={geometry().trackRight - 4} y={3}/>
    <span class="taxi-table-horizontal-thumb" style={{ left: `${geometry().thumbLeft}px`, width: `${geometry().thumbRight - geometry().thumbLeft}px`,
      'background-color': `rgb(${thumbPaint().gray}, ${thumbPaint().gray}, ${thumbPaint().gray})` }}/>
    <ScrollFragment image={startCap()} x={geometry().thumbLeft} y={3}/>
    <ScrollFragment image={endCap()} x={geometry().thumbRight - 4} y={3}/>
    <ScrollFragment image={leftArrow()} x={9} y={4}/>
    <ScrollFragment image={rightArrow()} x={props.viewport - 13} y={4}/>
  </div>;
}
