import {createMemo,For,Show} from 'solid-js';
import {calendarImage} from './input-calendar.mjs';
export function NativeInputCalendar(props) {
  const drawing=createMemo(()=>calendarImage(props.height,props.inactive));
  return <Show when={drawing()} fallback={props.fallback}>{image=><svg width={image().size} height={image().size} viewBox={'0 0 '+image().size+' '+image().size} aria-hidden="true" shape-rendering="crispEdges"
    style={{display:'block',flex:'none',position:'relative',left:image().shiftX+'px',top:image().shiftY+'px'}}>
    <For each={image().rects}>{([x,y,width,height,fill])=><rect x={x} y={y} width={width} height={height} fill={fill}/>}</For>
  </svg>}</Show>;
}
