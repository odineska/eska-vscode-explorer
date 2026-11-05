import {createMemo,For} from 'solid-js';
import {calculatorImage} from './input-calculator.mjs';
export function NativeInputCalculator(props) {
  const drawing=createMemo(()=>calculatorImage(props.height,props.inactive));
  return <svg class="taxi-input-calculator" width={drawing().width} height={drawing().height} viewBox={`0 0 ${drawing().width} ${drawing().height}`} aria-hidden="true" shape-rendering="crispEdges"
    style={{width:`${drawing().width}px`,height:`${drawing().height}px`,position:'relative',left:drawing().shiftX?`${drawing().shiftX}px`:undefined,top:`${drawing().shiftY}px`,transform:'none'}}>
    <For each={drawing().rects}>{([x,y,width,height,fill])=><rect x={x} y={y} width={width} height={height} fill={fill}/>}</For>
  </svg>;
}
