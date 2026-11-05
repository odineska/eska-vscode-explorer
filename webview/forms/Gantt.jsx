import {Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {Gantt as BrowserGantt} from './ComplexCharts.jsx';
import {ganttSurfaceRgba,ganttTextAdvances} from './gantt-surface.mjs';

export function Gantt(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),owner={};
 createEffect(on(()=>[props.controller.state.sequence,props.controller.state.os,props.controller.state.ui.zoom,props.controller.state.culture,props.controller.state.strings.chartPoint,props.controller.state.strings.chartValue,props.controller.state.strings.chartSeries,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux'||!runtime)return;
  let current=true,face;
  const draw=()=>{
   if(!current)return;const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2;
   if(calibrated&&!face)return;
   const data=calibrated?ganttSurfaceRgba(metrics,{culture:props.controller.state.culture,point:props.controller.state.strings.chartPoint,value:props.controller.state.strings.chartValue,series:props.controller.state.strings.chartSeries},(text,numeric)=>face.raster(text,13,12,3,'lcd',ganttTextAdvances(text,numeric))):undefined;
   if(data){canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(data,canvas.width,canvas.height),0,0);}
   setReady(!!data);runtime.issue(owner,!data);
  };
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw);resize.observe(surface);draw();runtime.face(400).then(value=>{if(current){face=value;draw();}}).catch(()=>{if(current)runtime.issue(owner,true);});
  onCleanup(()=>{current=false;cancelAnimationFrame(frame);resize.disconnect();runtime.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} data-native-gantt={ready()?'ready':'browser'} style={{position:'relative',width:'100%',height:'100%','min-height':0}}><Show when={!ready()}><BrowserGantt {...props}/></Show><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/></div>;
}
