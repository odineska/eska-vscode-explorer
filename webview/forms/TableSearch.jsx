import {For,Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {color} from './model.mjs';
import {inputBorderPixels} from './input-border.mjs';
import {searchClearPixels} from './search-control.mjs';
import {NativeInputCorners} from './NativeInputCorners.jsx';
import {NativeLabel} from './NativeLabel.jsx';
import {observeRasterPaint} from './raster-position.js';
import {useFormLayout} from './responsive-layout.js';

const rgb=value=>/^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);
function backdrop(element){
 for(let node=element.parentElement;node;node=node.parentElement){
  const css=getComputedStyle(node);if(css.backgroundImage!=='none')return;
  if(css.backgroundColor!=='rgba(0, 0, 0, 0)')return rgb(css.backgroundColor);
 }
}

export function TableSearch(props){
 let surface,clear;
 const state=props.controller.state,layout=useFormLayout(),[paint,setPaint]=createSignal(),owner={};
 const font=()=>state.model.root.presentation.font;
 const calibrated=()=>font().points===10&&font().weight===400;
 // Native toolbar hints use the smaller face until this preview pane is laid out again.
 const compact=()=>state.os==='linux'&&!props.top&&calibrated()&&layout&&!layout.viewportResized();
 createEffect(on(()=>[state.os,state.sequence,compact()],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setPaint();if(state.os!=='linux')return;
  const draw=()=>{
   const css=getComputedStyle(surface),border=rgb(css.borderTopColor),background=rgb(css.backgroundColor),outside=backdrop(surface),foreground=rgb(getComputedStyle(clear).color);
   if(parseFloat(css.height)!==23||surface.closest('.taxi-disabled')||!border||!background||!outside||!foreground){setPaint();runtime?.issue(owner,true);return;}
   setPaint({...inputBorderPixels(border,background,outside,{choice:true}),clear:searchClearPixels(foreground,background)});runtime?.issue(owner,false);
  };
  onCleanup(observeRasterPaint(surface,draw));
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} class="taxi-table-search" classList={{ "taxi-table-search--top": props.top, "taxi-table-search--compact": compact() }} data-native-search-field={paint()?'ready':'fallback'} data-element={props.node.key} onClick={event=>{event.stopPropagation();props.controller.select(props.node);}}>
  <input readOnly tabIndex="-1" placeholder={state.strings.searchShortcut} aria-label={state.strings.search}/>
  <span ref={clear} class="taxi-search-clear" style={{color:state.os==='linux'?color(state.model.root.presentation.foreground):undefined}}><span style={{visibility:paint()?'hidden':undefined}}>×</span>
   <Show when={paint()}><svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true" shape-rendering="crispEdges"><For each={paint().clear}>{(pixel,index)=><rect x={index()%7} y={Math.floor(index()/7)} width="1" height="1" fill={`rgb(${pixel.join(',')})`}/>}</For></svg></Show>
  </span>
  <NativeLabel text={state.strings.searchShortcut} placement="tableSearch" enabled={state.os==='linux'} calibrated={calibrated()} font={compact()?{...font(),points:8.25}:font()} runtime={props.controller.nativeText}/>
  <NativeInputCorners paint={paint()} rightOffset="-1px"/>
 </div>;
}
