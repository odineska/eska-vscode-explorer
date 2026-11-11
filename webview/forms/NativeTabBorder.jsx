import { For, Show, createEffect, on, onCleanup } from 'solid-js';
import { color, property } from './model.mjs';
import { sideTabCornerPixels, tabBackground, tabCornerPixels } from './tab-border.mjs';
import { rgb, solidBackdrop } from './native-control-paint.js';
import { inactiveTabTextColor } from './choice-colors.mjs';

const TOP_REGIONS = [['topLeft',false,false,4,4],['topRight',true,false,4,4],['bottomLeft',false,true,3,2],['bottomRight',true,true,3,2]];
const sideRegions = right => [['outerTop',right,false,4,4],['outerBottom',right,true,4,4],
  ['joinTop',!right,false,2,1],['joinBottom',!right,true,2,1]];
const REGIONS = { left:sideRegions(false), right:sideRegions(true) };

export function NativeTabBorder(props) {
  let source, neighbours, lastKey;
  const state=props.controller.state;
  createEffect(on(()=>[state.modelSequence,state.os,props.enabled,props.side,props.bottom,props.active,props.selected,props.titleColorAuthored,
    JSON.stringify([props.node.presentation.background,props.node.presentation.titleColor,props.previous?.presentation.background,props.next?.presentation.background,props.pageBackground,props.pageHasBackground])],()=>{
    const frame=requestAnimationFrame(()=>{
      const button=props.button();
      const disabled=!!button.closest('.taxi-disabled');
      if(!props.enabled||disabled&&!props.side){lastKey=undefined;props.setPaint(undefined);return;}
      const css=getComputedStyle(source),adjacent=getComputedStyle(neighbours),outside=solidBackdrop(button.parentElement);
      const own=property(props.node,'BackColor')?rgb(css.color):outside,pageBackground=props.pageHasBackground?rgb(css.backgroundColor):outside;
      const previousColor=property(props.previous,'BackColor')?rgb(adjacent.color):outside,nextColor=property(props.next,'BackColor')?rgb(adjacent.backgroundColor):outside;
      if(!own||!pageBackground||!outside||!previousColor||!nextColor){lastKey=undefined;props.setPaint(undefined);return;}
      const neighbour=(node,fill)=>node?{active:node.key===props.selected,background:tabBackground(fill,node.key===props.selected)}:undefined;
      const background=tabBackground(own,props.active),previous=neighbour(props.previous,previousColor),next=neighbour(props.next,nextColor);
      const title = disabled ? rgb(css.borderTopColor) : undefined;
      // An authored title uses its tab's face. The automatic title uses the surrounding group.
      const foreground = title ? inactiveTabTextColor(title, props.titleColorAuthored ? background : outside) : undefined;
      const value={outside,background,pageBackground,active:props.active,previous,next,side:props.side,bottom:props.bottom,disabled},key=JSON.stringify([value,foreground]);
      if(key===lastKey)return;
      lastKey=key;props.setPaint({background,foreground,corners:props.side?sideTabCornerPixels(value):tabCornerPixels(value)});
    });
    // Both local page selection and dirty ancestor colors must reach the DOM first.
    onCleanup(()=>cancelAnimationFrame(frame));
  }));
  return <span class="taxi-tab-border" aria-hidden="true">
    <span ref={source} hidden style={{color:color(props.node.presentation.background),'background-color':color(props.pageBackground),'border-top-color':color(props.node.presentation.titleColor)}}/>
    <span ref={neighbours} hidden style={{color:color(props.previous?.presentation.background??props.node.presentation.background),'background-color':color(props.next?.presentation.background??props.node.presentation.background)}}/>
    <Show when={props.paint}><For each={REGIONS[props.side] ?? TOP_REGIONS}>{([name, right, atBottom, width, height]) => {
      const bottom = () => atBottom !== !!props.bottom;
      return <svg class="taxi-tab-corner" width={width} height={height} viewBox={`0 0 ${width} ${height}`} shape-rendering="crispEdges"
        style={{left:right?undefined:'-1px',right:right?'-1px':undefined,top:bottom()?undefined:'-1px',bottom:bottom()?'-1px':undefined}}>
        <For each={props.paint.corners[name]}>{(pixel, index) => {
          const row = () => Math.floor(index() / width);
          return <rect x={index()%width} y={props.bottom ? height - 1 - row() : row()} width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>;
        }}</For>
      </svg>;
    }}</For></Show>
  </span>;
}
