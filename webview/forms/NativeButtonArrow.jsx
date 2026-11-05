import {createEffect,createSignal,on,onCleanup} from 'solid-js';
import {buttonArrowPixels} from './button-caption.mjs';

const rgb=value=>/^rgb\((\d+), (\d+), (\d+)\)$/.exec(value)?.slice(1).map(Number);

export function NativeButtonArrow(props){
 let canvas;const [ready,setReady]=createSignal(false),owner={};
 createEffect(on(()=>[props.enabled,props.foreground,props.controller.state.sequence],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(!props.enabled)return;
  const button=props.button(),draw=()=>{
   try{
    const css=getComputedStyle(button),background=rgb(css.backgroundColor),foreground=rgb(getComputedStyle(canvas).color);
    if(parseFloat(css.height)!==26||!foreground||!background)throw new Error('button-arrow-profile');
    const context=canvas.getContext('2d');if(!context)throw new Error('button-arrow-canvas');
    canvas.width=6;canvas.height=3;context.putImageData(new ImageData(buttonArrowPixels(foreground,background),6,3),0,0);setReady(true);runtime?.issue(owner,false);
   }catch{setReady(false);runtime?.issue(owner,true);}
  };
  const observer=new ResizeObserver(draw);observer.observe(button);draw();onCleanup(()=>{observer.disconnect();runtime?.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <><span style={{visibility:ready()?'hidden':undefined}}>▾</span><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',color:props.foreground,right:'6px',top:'12px','pointer-events':'none'}}/></>;
}
