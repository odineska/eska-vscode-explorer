import {createEffect,createSignal,on,For,Show,onCleanup} from 'solid-js';
import {color} from './model.mjs';
import {geographicalBorderPaint} from './geographical-border.mjs';

export function Geographical(props){
 let surface;const [paint,setPaint]=createSignal(),owner={};
 createEffect(on(()=>[props.controller.state.os,props.controller.state.modelSequence,JSON.stringify(props.node.presentation.border)],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setPaint(undefined);if(props.controller.state.os!=='linux')return;
  const draw=()=>{const match=/^rgb\((\d+), (\d+), (\d+)\)$/.exec(getComputedStyle(surface).color);setPaint(match?geographicalBorderPaint(match.slice(1).map(Number)):undefined);runtime?.issue(owner,!match);};
  const frame=requestAnimationFrame(draw);draw();onCleanup(()=>{cancelAnimationFrame(frame);runtime?.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} class="taxi-document-surface taxi-geographical-schema" data-native-geographical-border={paint()?'ready':'browser'} style={{position:'relative',color:color(props.node.presentation.border),'border-color':paint()?`rgb(${paint().stroke.join(',')})`:undefined,'border-radius':paint()?'0':undefined}}>
  <Show when={paint()}><For each={[[false,false],[true,false],[false,true],[true,true]]}>{([right,bottom],index)=><svg width="3" height="3" viewBox="0 0 3 3" shape-rendering="crispEdges" aria-hidden="true" style={{position:'absolute',left:right?undefined:'-1px',right:right?'-1px':undefined,top:bottom?undefined:'-1px',bottom:bottom?'-1px':undefined,'pointer-events':'none'}}><For each={paint().corners[index()]}>{(pixel,i)=><rect x={i()%3} y={Math.floor(i()/3)} width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>}</For></svg>}</For></Show>
 </div>;
}
