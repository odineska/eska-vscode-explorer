import { For, Show, createEffect, on, onCleanup } from 'solid-js';
import { color, property } from './model.mjs';
import { tabBackground, tabCornerPixels } from './tab-border.mjs';

const REGIONS = [['topLeft',false,false,4,4],['topRight',true,false,4,4],['bottomLeft',false,true,3,2],['bottomRight',true,true,3,2]];
function rgb(value) {
  return /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);
}
function backdrop(element) {
  for(let node=element.parentElement;node;node=node.parentElement) {
    const style=getComputedStyle(node);
    if(style.backgroundImage!=='none')return;
    if(style.backgroundColor!=='rgba(0, 0, 0, 0)')return rgb(style.backgroundColor);
  }
}

export function NativeTabBorder(props) {
  let source, neighbours, lastKey;
  const state=props.controller.state;
  createEffect(on(()=>[state.sequence,state.os,props.enabled,props.active,props.selected,
    JSON.stringify([props.node.presentation.background,props.previous?.presentation.background,props.next?.presentation.background,props.pageBackground,props.pageHasBackground])],()=>{
    const frame=requestAnimationFrame(()=>{
      const button=props.button();
      if(!props.enabled||button.closest('.taxi-disabled')){lastKey=undefined;props.setPaint(undefined);return;}
      const css=getComputedStyle(source),adjacent=getComputedStyle(neighbours),outside=backdrop(button);
      const own=property(props.node,'BackColor')?rgb(css.color):outside,pageBackground=props.pageHasBackground?rgb(css.backgroundColor):outside;
      const previousColor=property(props.previous,'BackColor')?rgb(adjacent.color):outside,nextColor=property(props.next,'BackColor')?rgb(adjacent.backgroundColor):outside;
      if(!own||!pageBackground||!outside||!previousColor||!nextColor){lastKey=undefined;props.setPaint(undefined);return;}
      const neighbour=(node,fill)=>node?{active:node.key===props.selected,background:tabBackground(fill,node.key===props.selected)}:undefined;
      const background=tabBackground(own,props.active),previous=neighbour(props.previous,previousColor),next=neighbour(props.next,nextColor);
      const value={outside,background,pageBackground,active:props.active,previous,next},key=JSON.stringify(value);
      if(key===lastKey)return;
      lastKey=key;props.setPaint({background,corners:tabCornerPixels(value)});
    });
    // Both local page selection and dirty ancestor colors must reach the DOM first.
    onCleanup(()=>cancelAnimationFrame(frame));
  }));
  return <span class="taxi-tab-border" aria-hidden="true">
    <span ref={source} hidden style={{color:color(props.node.presentation.background),'background-color':color(props.pageBackground)}}/>
    <span ref={neighbours} hidden style={{color:color(props.previous?.presentation.background??props.node.presentation.background),'background-color':color(props.next?.presentation.background??props.node.presentation.background)}}/>
    <Show when={props.paint}><For each={REGIONS}>{([name,right,bottom,width,height])=><svg class="taxi-tab-corner" width={width} height={height} viewBox={`0 0 ${width} ${height}`} shape-rendering="crispEdges"
      style={{left:right?undefined:'-1px',right:right?'-1px':undefined,top:bottom?undefined:'-1px',bottom:bottom?'-1px':undefined}}>
      <For each={props.paint.corners[name]}>{(pixel,index)=><rect x={index()%width} y={Math.floor(index()/width)} width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>}</For>
    </svg>}</For></Show>
  </span>;
}
