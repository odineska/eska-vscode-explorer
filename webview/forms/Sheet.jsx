import {For,Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {flag} from './model.mjs';
import {spreadsheetSurfaceRgba,spreadsheetSurfaceSize} from './spreadsheet-surface.mjs';

function BrowserSheet(props){const columns=Array.from({length:12},(_,i)=>i+1);return <table><Show when={flag(props.node,'ShowHeaders',false)}><thead><tr><th/><For each={columns}>{name=><th>{name}</th>}</For></tr></thead></Show><tbody><For each={Array.from({length:30},(_,i)=>i+1)}>{row=><tr><Show when={flag(props.node,'ShowHeaders',false)}><th>{row}</th></Show><For each={columns}>{(_,i)=><td classList={{'taxi-sheet-cell-selected':row===1&&i()===0}}/>}</For></tr>}</For></tbody></table>;}

export function Sheet(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),owner={};
 createEffect(on(()=>[props.controller.state.os,props.controller.state.sequence,props.controller.state.ui.zoom,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux')return;
  let current=true,faces;const showHeaders=flag(props.node,'ShowHeaders',false);if(showHeaders&&!runtime)return;const draw=()=>{if(!current)return;const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2&&spreadsheetSurfaceSize(metrics.width,metrics.height);
   if(calibrated&&showHeaders&&!faces)return;
   if(calibrated){const raster=(text,bold)=>faces[bold?1:0].raster(text,11,10,3,'lcd',[...text].map(()=>6));canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(spreadsheetSurfaceRgba(metrics.width,metrics.height,flag(props.node,'ShowGrid',false),showHeaders,raster),canvas.width,canvas.height),0,0);}
   setReady(!!calibrated);runtime?.issue(owner,!calibrated);
  };
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw);resize.observe(surface);draw();if(showHeaders)Promise.all([runtime.face(400),runtime.face(700)]).then(value=>{if(current){faces=value;draw();}}).catch(()=>{if(current)runtime.issue(owner,true);});
  onCleanup(()=>{current=false;cancelAnimationFrame(frame);resize.disconnect();runtime?.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} class="taxi-sheet" classList={{'taxi-sheet--no-grid':!flag(props.node,'ShowGrid',false)}} data-native-spreadsheet={ready()?'ready':'browser'} style={{position:'relative'}}><div style={{display:ready()?'none':undefined}}><BrowserSheet {...props}/></div><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/></div>;
}
