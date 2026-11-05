import {For,Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {flag} from './model.mjs';
import {periodSurfaceRgba,periodTextAdvances} from './period-surface.mjs';

function BrowserPeriod(props) {
  const state = props.controller.state, now = new Date();
  const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat(state.culture, { month: 'short' }).format(new Date(2026, index, 1)));
  return <div class="taxi-period"><i class="taxi-period-previous"/><For each={[-1, 0, 1]}>{offset => <div class="taxi-period-year"><b>{now.getFullYear() + offset}</b><div class="taxi-period-months"><For each={months}>{(month, index) => <span classList={{ current: offset === 0 && index() === now.getMonth() }}>{month}</span>}</For></div></div>}</For><i class="taxi-period-next"/></div>;
}

export function Period(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),[paintDate,setPaintDate]=createSignal(''),owner={};
 createEffect(on(()=>[props.controller.state.sequence,props.controller.state.os,props.controller.state.ui.zoom,props.controller.state.culture,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux'||!runtime)return;
  let current=true,faces,timer;
  const draw=()=>{
   if(!current)return;const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2;
   if(calibrated&&!faces)return;
   const date=new Date(),data=calibrated?periodSurfaceRgba(metrics,{date,culture:props.controller.state.culture,inactive:!flag(props.node,'Enabled')||flag(props.node,'ReadOnly',false)},(text,year)=>faces[year?1:0].raster(text,year?metrics.yearPixels:metrics.pixels,year?metrics.yearAscent:metrics.ascent,year?metrics.yearDescent:metrics.descent,'lcd',periodTextAdvances(text,metrics,year))):undefined;
   if(data){canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(data,canvas.width,canvas.height),0,0);setPaintDate([date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'));}
   setReady(!!data);runtime.issue(owner,!data);
  };
  const nextDay=()=>{const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);timer=setTimeout(()=>{draw();nextDay();},Math.max(1,next-now));};
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw);resize.observe(surface);draw();nextDay();Promise.all([runtime.face(props.metrics?.profile?.weight??400),runtime.face(700)]).then(value=>{if(current){faces=value;draw();}}).catch(()=>{if(current)runtime.issue(owner,true);});
  onCleanup(()=>{current=false;cancelAnimationFrame(frame);clearTimeout(timer);resize.disconnect();runtime.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} data-native-period={ready()?'ready':'browser'} data-period-date={paintDate()} style={{position:'relative',width:'100%',height:'100%','min-height':0}}><Show when={!ready()}><BrowserPeriod {...props}/></Show><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/></div>;
}
