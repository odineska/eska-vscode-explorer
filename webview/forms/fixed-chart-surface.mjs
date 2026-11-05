import {number,flag} from './model.mjs';

const recordedAxes=new Set(['0:0','20:5','35:9','15:3','60:20']);

/** Measured complex fields use an internal font and the same bounded dimension matrix. */
export function fixedChartSurfaceMetrics(node,os){
 const width=number(node,'Width'),height=number(node,'Height'),linux=os==='linux';
 return {width:width>0?Math.max(15,width)*(linux?10:8)+(linux?0:4):500,height:height>0?Math.max(2,height)*(linux?25:20)+(linux?-7:3):243,
  pixels:13,ascent:12,descent:3,calibrated:linux&&recordedAxes.has(`${width}:${height}`)};
}

/** The settled chart surfaces ignore requested BorderColor in this profile. */
export function fixedChartBorderColor(node){return !flag(node,'Enabled')||flag(node,'ReadOnly',false)?'#e8e8e8':'#a0a0a0';}
