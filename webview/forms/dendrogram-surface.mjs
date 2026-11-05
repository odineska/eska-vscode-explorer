import {flag} from './model.mjs';
import {hintedTextWidth} from './font-metrics.mjs';
export {fixedChartSurfaceMetrics as dendrogramSurfaceMetrics} from './fixed-chart-surface.mjs';

/** Native border paint ignores BorderColor, including explicitly requested web colors. */
export function dendrogramBorderColor(node){return !flag(node,'Enabled')||flag(node,'ReadOnly',false)?'#e8e8e8':'#a0a0a0';}

const font={family:'ESKA Taxi Sans',pixels:13,weight:400};
function labelText(value,width){
 const advance=hintedTextWidth(value,font);if(advance===undefined)return;
 if(advance<width)return value;
 let head='';for(const char of value){const next=head+char;if(hintedTextWidth(next+'...',font)>=width)break;head=next;}
 return head+'...';
}

/** Settled native four-leaf demonstration; no bound data or handlers execute. */
export function dendrogramSurfaceRgba(metrics,{culture='en-US',element='Element'}={},raster){
 if(!metrics.calibrated||culture!=='en-US'||typeof element!=='string'||typeof raster!=='function')return;
 const {width,height}=metrics,data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);
 const bottom=height-18,scale=(height-27)/3.5,cell=(width-24)/4,x=fraction=>23+(width-24)*fraction,y=value=>Math.round(bottom-value*scale);
 function pixel(xx,yy,color){if(xx<1||xx>=width-1||yy<1||yy>=height-1)return;const index=((yy-1)*(width-2)+xx-1)*4;for(let c=0;c<3;c++)data[index+c]=typeof color==='number'?color:color[c];}
 function line(x0,y0,x1,y1,color){for(let yy=Math.max(1,Math.min(y0,y1));yy<=Math.min(height-2,Math.max(y0,y1));yy++)for(let xx=Math.max(1,Math.min(x0,x1));xx<=Math.min(width-2,Math.max(x0,x1));xx++)pixel(xx,yy,color);}
 function text(value,pen,baseline){
  const image=raster(value);for(const g of image.glyphs)for(let yy=0;yy<g.rows;yy++)for(let xx=0;xx<g.columns;xx++){
   const tx=pen+g.pen+g.left+xx,ty=baseline-g.top+yy;if(tx<1||tx>=width-1||ty<1||ty>=height-1)continue;
   const index=((ty-1)*(width-2)+tx-1)*4,alpha=(yy*g.columns+xx)*3;for(let c=0;c<3;c++){const coverage=g.coverage[alpha+c];data[index+c]=Math.round((51*coverage+data[index+c]*(255-coverage))/255);}
  }
 }
 line(23,9,23,bottom,169);line(23,bottom,width-2,bottom,169);
 for(const [first,last,value]of [[0,1,2],[2,3,1]]){
  const left=Math.round(x((first+.5)/4)),right=Math.round(x((last+.5)/4)),top=y(value);line(left,top,left,bottom-1,[0,0,128]);line(right,top,right,bottom-1,[0,0,128]);line(left,top,right,top,[0,0,128]);
 }
 const left=Math.round(x(.25)),right=Math.round(x(.75));line(left,y(3),right,y(3),[0,0,128]);line(left,y(3),left,y(2),[0,0,128]);line(right,y(3),right,y(1),[0,0,128]);
 const step=.5*Math.ceil(15/(.5*scale)),format=new Intl.NumberFormat(culture);
 for(let value=0;value<=3.5;value+=step){const label=format.format(value);text(label,23-hintedTextWidth(label,font),y(value)+4);}
 for(let index=0;index<4;index++){const label=labelText(`<${element} ${index+1}>`,cell);if(label===undefined)return;text(label,Math.ceil(x((index+.5)/4)-hintedTextWidth(label,font)/2),height-5);}
 return data;
}
