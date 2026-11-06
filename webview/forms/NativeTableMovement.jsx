import {createEffect,createSignal,on,onCleanup} from 'solid-js';
import {tableMovementRgba} from './table-movement.mjs';
import {observeRasterPaint} from './raster-position.js';
import {useFormLayout} from './responsive-layout.js';

function whiteBackdrop(element) {
  for (let parent=element.parentElement;parent;parent=parent.parentElement) {
    const css=getComputedStyle(parent);
    if(css.backgroundImage!=='none')return false;
    if(css.backgroundColor!=='rgba(0, 0, 0, 0)')return css.backgroundColor==='rgb(255, 255, 255)';
  }
  return false;
}

export function NativeTableMovement(props) {
 const layout=useFormLayout();
 let canvas;const [ready,setReady]=createSignal(false),owner={};
 createEffect(on(()=>[props.controller.state.os,props.controller.state.sequence,props.controller.state.ui.zoom,props.commands.map(c=>c.key).join('|'),layout?.preferred()],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux')return;
  const group=props.element();
  const stop=observeRasterPaint(group,position=>{
   const rect=group.getBoundingClientRect(),commands=props.commands;
   const calibrated=devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===60&&rect.height===26&&commands.length===2
    &&commands[0].key.endsWith('.MoveUp')&&commands[1].key.endsWith('.MoveDown')
    &&getComputedStyle(canvas).backgroundColor==='rgb(255, 255, 255)'&&whiteBackdrop(group);
   if(calibrated){canvas.width=60;canvas.height=27;canvas.getContext('2d').putImageData(new ImageData(tableMovementRgba(position(26,props.controller.state.ui.zoom)),60,27),0,0);}
   setReady(calibrated);runtime?.issue(owner,!calibrated);
  });
  onCleanup(()=>{stop();runtime?.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <canvas ref={canvas} data-native-table-movement={ready()?'ready':'browser'} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'60px',height:'27px','background-color':'var(--taxi-ButtonBackColor)','pointer-events':'none'}}/>;
}
