import {For,Show} from 'solid-js';

const CORNERS=[[false,false],[true,false],[false,true],[true,true]],PIXELS=[0,1,2,3,4,5,6,7,8];

export function NativeInputCorners(props){
 // Choice inputs extend one pixel; search controls already allocate their complete width.
 const right=()=>props.rightOffset??(props.paint.choice?'-2px':'-1px');
 return <Show when={props.paint}><For each={CORNERS}>{([isRight,bottom],index)=><svg class="taxi-input-corner" width="3" height="3" viewBox="0 0 3 3" aria-hidden="true" shape-rendering="crispEdges"
  style={{left:isRight?undefined:'-1px',right:isRight?right():undefined,top:bottom?undefined:'-1px',bottom:bottom?'-1px':undefined}}>
  <For each={PIXELS}>{pixel=><rect x={pixel%3} y={Math.floor(pixel/3)} width="1" height="1" fill={`rgb(${props.paint.corners[index()][pixel].join(',')})`}/>}</For>
 </svg>}</For></Show>;
}
