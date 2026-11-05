import {createEffect,createSignal,on,onCleanup} from 'solid-js';
import {flag} from './model.mjs';
import {pdfSurfaceRgba} from './pdf-surface.mjs';

export function Pdf(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),owner={};
 createEffect(on(()=>[props.controller.state.os,props.controller.state.sequence,props.controller.state.ui.zoom,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux')return;
  const draw=()=>{const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2;
   if(calibrated){canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(pdfSurfaceRgba(metrics.width,metrics.height,flag(props.node,'Enabled')),canvas.width,canvas.height),0,0);}
   setReady(!!calibrated);runtime?.issue(owner,!calibrated);
  };
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw);resize.observe(surface);draw();onCleanup(()=>{cancelAnimationFrame(frame);resize.disconnect();runtime?.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 const fallback=()=>({display:ready()?'none':undefined});
 return <div ref={surface} class="taxi-pdf" data-native-pdf={ready()?'ready':'browser'}>
  <div class="taxi-pdf-page" style={fallback()}/><div class="taxi-pdf-scroll-vertical" style={fallback()}><i/><b/></div><div class="taxi-pdf-scroll-horizontal" style={fallback()}><i/><b/></div>
  <canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/>
 </div>;
}
