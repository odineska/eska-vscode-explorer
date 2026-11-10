import {For,Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {plannerSurfaceRgba,plannerTextAdvances} from './planner-surface.mjs';

function BrowserPlanner(props) {
  const state = props.controller.state, now = new Date(), date = new Intl.DateTimeFormat(state.culture, { dateStyle: 'long' }).format(now);
  return <div class="taxi-planner"><div class="taxi-planner-date">{date}</div><div class="taxi-planner-scroll"><div class="taxi-planner-hours">
    <For each={Array.from({ length: 24 }, (_, index) => index)}>{hour => <div class="taxi-planner-hour"><span>{String(hour).padStart(2, '0')}:00</span><i/></div>}</For>
    <div class="taxi-planner-meeting">01:00 {state.strings.sampleMeeting}</div><div class="taxi-planner-now" style={{ top: `${(now.getHours() + now.getMinutes() / 60) * 16}px` }}/>
  </div></div></div>;
}

export function Planner(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),[paintTime,setPaintTime]=createSignal(''),owner={};
 createEffect(on(()=>[props.controller.state.modelSequence,props.controller.state.os,props.controller.state.ui.zoom,props.controller.state.culture,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux'||!runtime)return;
  let current=true,face;
  const draw=()=>{
   if(!current)return;const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2;
   if(calibrated&&!face)return;
   const date=new Date(),data=calibrated?plannerSurfaceRgba(metrics,{date,culture:props.controller.state.culture,meeting:props.controller.state.strings.sampleMeeting},text=>face.raster(text,13,12,3,'lcd',plannerTextAdvances(text))):undefined;
   if(data){canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(data,canvas.width,canvas.height),0,0);setPaintTime(String(date.getTime()));}
   setReady(!!data);runtime.issue(owner,!data);
  };
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw),timer=setInterval(draw,1000);resize.observe(surface);draw();runtime.face(400).then(value=>{if(current){face=value;draw();}}).catch(()=>{if(current)runtime.issue(owner,true);});
  onCleanup(()=>{current=false;cancelAnimationFrame(frame);clearInterval(timer);resize.disconnect();runtime.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} data-native-planner={ready()?'ready':'browser'} data-planner-time={paintTime()} style={{position:'relative',width:'100%',height:'100%','min-height':0}}><Show when={!ready()}><BrowserPlanner {...props}/></Show><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/></div>;
}
