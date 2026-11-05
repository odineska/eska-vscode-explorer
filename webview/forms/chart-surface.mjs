import {hintedTextWidth} from './font-metrics.mjs';
export {fixedChartSurfaceMetrics as chartSurfaceMetrics,fixedChartBorderColor as chartBorderColor} from './fixed-chart-surface.mjs';

// Captured design-time samples: these are never values from a bound runtime chart.
export const chartSampleValues=Object.freeze([[10,19,13,12.5],[12,12.5,6,2],[16.5,1.7,11,20],[5,11.5,1,12.5]].map(Object.freeze));
export const chartPalette=Object.freeze([[76,200,255],[255,135,121],[255,192,0],[95,194,110]].map(Object.freeze));
const font={family:'ESKA Taxi Sans',pixels:13,weight:400};
const rotatedPens={en:{200:[9,38,67,96],150:[5,25,44,64]},ru:{200:[8,37,65,94],350:[12,72,132,191],150:[5,24,43,62]}};

/** Only the five measured Linux dimensions and two native UI label sets are calibrated. */
export function chartLayout(metrics,{culture='en-US',point='Point',series='Series'}={}){
 const ru=point==='Точка'&&series==='Серия',en=point==='Point'&&series==='Series';
 if(!metrics?.calibrated||culture!=='en-US'||!ru&&!en||![150,200,350,500,600].includes(metrics.width))return;
 const {width,height}=metrics,legendWidth=Math.min(91,Math.floor((width-4)/4)),legendX=width-legendWidth,advance=hintedTextWidth(`<${point} 1>`,font),rotated=advance>(legendX-25)/4;
 const axisX=width>=350?22:width===200?(ru?34:31):(ru?35:32),plotWidth=legendX-axisX-3,plotBottom=Math.max(8,height-(rotated?Math.floor((advance+15)*46340/65536)+10:25)),plotHeight=plotBottom-8;
 const step=plotHeight?5*Math.ceil(15/(plotHeight/4)):5,legendRowHeight=Math.max(17,Math.min(17*Math.ceil(64/Math.max(1,legendWidth-24)),Math.floor((height-2)/4))),legendTop=1+Math.max(0,Math.floor((height-2-4*legendRowHeight)/2));
 return{width,height,ru,point,series,axisX,plotWidth,plotBottom,plotHeight,step,rotated,legendWidth,legendX,legendRowHeight,legendTop};
}

/** Injected sample values allow native reference heights to be tested without accepting random values as data. */
export function chartSurfaceRgba(metrics,labels={},raster,rotatedRaster,values=chartSampleValues){
 const layout=chartLayout(metrics,labels);if(!layout||typeof raster!=='function'||typeof rotatedRaster!=='function')return;
 if(!Array.isArray(values)||values.length!==4||values.some(row=>!Array.isArray(row)||row.length!==4||row.some(value=>!Number.isFinite(value)||value<0||value>20)))return;
 const {width,height,ru,point,series,axisX,plotWidth,plotBottom,plotHeight,step,rotated,legendWidth,legendX,legendRowHeight,legendTop}=layout,data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);
 function pixel(x,y,color){if(x<1||x>=width-1||y<1||y>=height-1)return;const i=((y-1)*(width-2)+x-1)*4;for(let c=0;c<3;c++)data[i+c]=typeof color==='number'?color:color[c];}
 function blend(x,y,color,alpha){if(x<1||x>=width-1||y<1||y>=height-1)return;const i=((y-1)*(width-2)+x-1)*4;for(let c=0;c<3;c++)data[i+c]=Math.round((color[c]*alpha+data[i+c]*(255-alpha))/255);}
 function rect(x,y,w,h,color){for(let yy=Math.max(1,y);yy<Math.min(height-1,y+h);yy++)for(let xx=Math.max(1,x);xx<Math.min(width-1,x+w);xx++)pixel(xx,yy,color);}
 function text(value,pen,baseline,isRotated=false,clipRight=width-1){
  const image=isRotated?rotatedRaster(value):raster(value);
  if(isRotated){for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const tx=pen+image.originX+x;if(tx<clipRight)blend(tx,baseline+image.originY+y,[51,51,51],image.alpha[y*image.width+x]);}}
  else for(const g of image.glyphs)for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++){
   const tx=pen+g.pen+g.left+x,ty=baseline-g.top+y;if(tx<1||tx>=clipRight||ty<1||ty>=height-1)continue;
   const i=((ty-1)*(width-2)+tx-1)*4,a=(y*g.columns+x)*3;for(let c=0;c<3;c++){const coverage=g.coverage[a+c];data[i+c]=Math.round((51*coverage+data[i+c]*(255-coverage))/255);}
  }
 }
 for(let value=0;value<=20;value+=step){
  const y=Math.round(plotBottom-value*plotHeight/20);rect(axisX-3,y,4,1,169);
  if(value){rect(axisX+1,y,plotWidth,1,221);pixel(axisX+1,y,202);if([500,600].includes(width)&&value!==10||width===350&&value===20)pixel(axisX+plotWidth+1,y,242);}
  blend(axisX-4,y,[169,169,169],95);const label=String(value);text(label,axisX-hintedTextWidth(label,font)-7,y+5);
 }
 rect(axisX,8,1,plotHeight+1,169);rect(axisX,plotBottom,plotWidth+1,1,169);
 if([500,600].includes(width)||width===350&&!ru)pixel(axisX+plotWidth+1,plotBottom,215);
 for(let i=0;i<5;i++){const x=axisX+Math.round(plotWidth*i/4);rect(x,plotBottom+1,1,4,169);pixel(x,plotBottom+5,224);}
 for(let pointIndex=0;pointIndex<4;pointIndex++){
  for(let seriesIndex=0;seriesIndex<4;seriesIndex++){
   const left=axisX+1+plotWidth*(pointIndex/4+(seriesIndex+1)/24),right=axisX+1+plotWidth*(pointIndex/4+(seriesIndex+2)/24),top=plotBottom-Math.round(values[pointIndex][seriesIndex]*plotHeight*15/20)/15,color=chartPalette[seriesIndex];
   // The recorded rasterizer covers 17 horizontal by 15 vertical samples.
   // A left-edge sample exactly on the edge is excluded; the right edge includes it.
   for(let y=Math.floor(top);y<plotBottom;y++){
    const cy=Math.round(Math.max(0,Math.min(y+1,plotBottom)-Math.max(y,top))*15);
    for(let x=Math.floor(left);x<Math.ceil(right);x++){
     const coverage=Math.max(0,Math.min(x+1,right)-Math.max(x,left))*17;
     const cx=x===Math.floor(left)&&left!==Math.floor(left)?Math.max(0,Math.min(17,Math.ceil(coverage-.5-1e-8))):Math.round(coverage);
     blend(x,y,color,cx*cy);
    }
   }
  }
  const label=`<${point} ${pointIndex+1}>`,center=axisX+plotWidth*(pointIndex+.5)/4,pen=rotated?rotatedPens[ru?'ru':'en'][width][pointIndex]:width===350?[24,84,144,204][pointIndex]:Math.floor(center-hintedTextWidth(label,font)/2+1),baseline=rotated?(ru&&width===150?height:height-3):height-4;
  text(label,pen,baseline,rotated,legendX-2);
 }
 for(let i=0;i<4;i++){
  if(legendTop+(i+1)*legendRowHeight>height-1)break;
  const y=legendTop+i*legendRowHeight+Math.floor((legendRowHeight-14)/2);rect(legendX,y,14,14,chartPalette[i]);let label=`<${series} ${i+1}>`;
  if(hintedTextWidth(label,font)>legendWidth-18){let count=1;for(let n=2;n<label.length;n++){if(hintedTextWidth(label.slice(0,n)+'…',font)>legendWidth-18)break;count=n;}label=label.slice(0,count)+'…';}
  text(label,legendX+17,y+11+legendRowHeight%2);
 }
 return data;
}
