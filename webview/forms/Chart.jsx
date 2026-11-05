import {For,Show,createEffect,createSignal,on,onCleanup} from 'solid-js';
import {chartSurfaceRgba,chartSampleValues,chartPalette} from './chart-surface.mjs';

// The Configurator supplies fresh sample values on each open. Their values are excluded
// from parity comparison; layout, series order, palette and labels remain profile-owned.
const values=chartSampleValues,palette=chartPalette.map(color=>'#'+color.map(v=>v.toString(16).padStart(2,'0')).join(''));

function BrowserChart(props) {
  const state = props.controller.state;
  const width = () => props.width, height = () => props.height;
  const plot = () => ({ x: 22, y: 8, width: Math.max(100, width() - 114), height: Math.max(60, height() - 32) });
  return <svg class="taxi-chart" width="100%" height="100%" viewBox={`0 0 ${width()} ${height()}`} aria-hidden="true">
    <For each={[0, 5, 10, 15, 20]}>{tick => <>
      <path d={`M${plot().x - 4} ${plot().y + plot().height * (1 - tick / 20)}h${plot().width + 4}`} stroke={tick === 0 ? '#aaa' : '#ddd'} stroke-width="1" shape-rendering="crispEdges"/>
      <text x={plot().x - 7} y={plot().y + plot().height * (1 - tick / 20)} text-anchor="end" dominant-baseline="middle">{tick}</text>
    </>}</For>
    <path d={`M${plot().x} ${plot().y}v${plot().height}`} fill="none" stroke="#aaa" shape-rendering="crispEdges"/>
    <For each={values}>{(point, index) => <>
      <For each={point}>{(value, series) => <rect x={plot().x + plot().width / 4 * (index() + 1 / 6 + series() / 6)} y={plot().y + plot().height * (1 - value / 20)}
        width={plot().width / 24} height={plot().height * value / 20} fill={palette[series()]}/>}</For>
      <text x={plot().x + plot().width / 4 * (index() + .5)} y={height() - 4} text-anchor="middle">{`<${state.strings.chartPoint} ${index() + 1}>`}</text>
    </>}</For>
    <For each={palette}>{(color, index) => <g transform={`translate(${width() - 90} ${(height() - 68) / 2 + index() * 17})`}>
      <rect width="14" height="14" fill={color}/><text x="17" y="7" dominant-baseline="middle">{`<${state.strings.chartSeries} ${index() + 1}>`}</text>
    </g>}</For>
  </svg>;
}

export function Chart(props){
 let surface,canvas;const [ready,setReady]=createSignal(false),owner={};
 createEffect(on(()=>[props.controller.state.sequence,props.controller.state.os,props.controller.state.ui.zoom,props.controller.state.culture,props.controller.state.strings.chartPoint,props.controller.state.strings.chartSeries,props.metrics],()=>{
  const runtime=props.controller.nativeText;runtime?.issue(owner,false);setReady(false);if(props.controller.state.os!=='linux'||!runtime)return;
  let current=true,face;
  const draw=()=>{
   if(!current)return;const metrics=props.metrics,rect=surface.getBoundingClientRect(),calibrated=metrics?.calibrated&&devicePixelRatio===1&&props.controller.state.ui.zoom===100&&rect.width===metrics.width-2&&rect.height===metrics.height-2;
   if(calibrated&&!face)return;
   const data=calibrated?chartSurfaceRgba(metrics,{culture:props.controller.state.culture,point:props.controller.state.strings.chartPoint,series:props.controller.state.strings.chartSeries},text=>face.raster(text,13,12,3,'lcd'),text=>face.rotated(text,13)):undefined;
   if(data){canvas.width=metrics.width-2;canvas.height=metrics.height-2;canvas.getContext('2d').putImageData(new ImageData(data,canvas.width,canvas.height),0,0);}
   setReady(!!data);runtime.issue(owner,!data);
  };
  const frame=requestAnimationFrame(draw),resize=new ResizeObserver(draw);resize.observe(surface);draw();runtime.face(400).then(value=>{if(current){face=value;draw();}}).catch(()=>{if(current)runtime.issue(owner,true);});
  onCleanup(()=>{current=false;cancelAnimationFrame(frame);resize.disconnect();runtime.issue(owner,false);});
 }));
 onCleanup(()=>props.controller.nativeText?.issue(owner,false));
 return <div ref={surface} data-native-chart={ready()?'ready':'browser'} style={{position:'relative',width:'100%',height:'100%','min-height':0}}><Show when={!ready()}><BrowserChart {...props}/></Show><canvas ref={canvas} aria-hidden="true" style={{display:ready()?undefined:'none',position:'absolute',left:0,top:0,width:'100%',height:'100%','pointer-events':'none'}}/></div>;
}
