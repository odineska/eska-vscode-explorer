import {For,Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {flag} from './model.mjs';
import {calendarSurfaceRgba,calendarTextAdvances} from './calendar-surface.mjs';

function BrowserCalendar(props) {
  const state = props.controller.state, date = new Date(), locale = state.culture;
  const culture = new Intl.Locale(locale), weekStart = (culture.getWeekInfo?.().firstDay ?? culture.weekInfo?.firstDay ?? 1) % 7;
  const first = (new Date(date.getFullYear(), date.getMonth(), 1).getDay() - weekStart + 7) % 7;
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 5, index + weekStart)));
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date);
  return <div class="taxi-calendar"><div class="taxi-calendar-title"><span>{date.getFullYear()}<i>◢</i></span><span>{month}<i>◢</i></span><span>‹</span><span>›</span></div><div class="taxi-calendar-grid">
    <For each={weekdays}>{(day, index) => <b classList={{ weekend: [0, 6].includes((index() + weekStart) % 7) }}>{day}</b>}</For>
    <For each={Array.from({ length: 42 }, (_, index) => new Date(date.getFullYear(), date.getMonth(), index - first + 1))}>{day => <span classList={{ today: day.toDateString() === date.toDateString(), weekend: day.getDay() === 0 || day.getDay() === 6, adjacent: day.getMonth() !== date.getMonth() }}>{day.getDate()}</span>}</For>
  </div><div class="taxi-calendar-today"><span>{state.strings.today}, {new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)}</span></div></div>;
}

export function Calendar(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),[paintDate,setPaintDate]=createSignal(''),owner={};
 createEffect(on(()=>[props.controller.state.modelSequence,props.controller.state.os,props.controller.state.ui.zoom,props.controller.state.culture,props.controller.state.strings.today,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux'||!runtime)return;
  let current=true,face,timer;
  const draw=()=>{
   if(!current)return;const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2;
   if(calibrated&&!face)return;
   const date=new Date(),data=calibrated?calendarSurfaceRgba(metrics,{date,culture:props.controller.state.culture,todayLabel:props.controller.state.strings.today,inactive:!flag(props.node,'Enabled')||flag(props.node,'ReadOnly',false)},text=>face.raster(text,metrics.pixels,metrics.ascent,metrics.descent,'lcd',calendarTextAdvances(text,metrics))):undefined;
   if(data){canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(data,canvas.width,canvas.height),0,0);setPaintDate([date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'));}
   setReady(!!data);runtime.issue(owner,!data);
  };
  const nextDay=()=>{const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);timer=setTimeout(()=>{draw();nextDay();},Math.max(1,next-now));};
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw);resize.observe(surface);draw();nextDay();runtime.face(props.metrics?.profile?.weight??400).then(value=>{if(current){face=value;draw();}}).catch(()=>{if(current)runtime.issue(owner,true);});
  onCleanup(()=>{current=false;cancelAnimationFrame(frame);clearTimeout(timer);resize.disconnect();runtime.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} data-native-calendar={ready()?'ready':'browser'} data-calendar-date={paintDate()} style={{position:'relative',width:'100%',height:'100%','min-height':0}}><Show when={!ready()}><BrowserCalendar {...props}/></Show><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/></div>;
}
