import {hintedTextWidth,hintedPairTextAdvances} from './font-metrics.mjs';
import {scrollbarPaint} from './scrollbar-paint.mjs';
export {fixedChartSurfaceMetrics as ganttSurfaceMetrics,fixedChartBorderColor as ganttBorderColor} from './fixed-chart-surface.mjs';

const font={family:'ESKA Taxi Sans',pixels:13,weight:400};
const coverage={"topLeft":[[0,0,70,124],[0,163,255,255],[70,255,255,255],[117,255,255,255]],"topRight":[[125,70,0,0],[255,255,164,0],[255,255,255,70],[255,255,255,125]],"bottomLeft":[[117,255,255,255],[70,255,255,255],[0,163,255,255],[0,0,70,116]],"bottomRight":[[255,255,255,125],[255,255,255,70],[255,255,164,0],[116,70,0,0]],"top":136,"bottom":119,"left":120,"right":135};
// The native color-point overlay has its own lower-right coverage phase.
const colorPointBottomRight=coverage.bottomRight.map(row=>[...row]);colorPointBottomRight[3][1]=71;
const axes={
 150:{point:[40,38],column:0,rows:[70,70],days:[14,14]},
 200:{point:[55,59],column:0,rows:[54,54],days:[15,15]},
 350:{point:[67,71],column:21,rows:[102,166],days:[15,16]},
 500:{point:[67,71],column:33,rows:[54,70],days:[12,12]},
 600:{point:[67,71],column:42,rows:[54,70],days:[11,11]},
};
export function ganttTextAdvances(text,numeric=false){return numeric?[...text].map(char=>hintedTextWidth(char,font)):hintedPairTextAdvances(text,font);}

/** Recorded settled design-time demonstration, never a runtime Gantt chart. */
export function ganttSurfaceRgba(metrics,{culture='en-US',point='Point',value='Value',series='Series'}={},raster){
 const ru=point==='Точка'&&value==='Значение'&&series==='Серия',en=point==='Point'&&value==='Value'&&series==='Series';
 if(!metrics.calibrated||culture!=='en-US'||!ru&&!en||typeof raster!=='function')return;
 const {width,height}=metrics,axis=axes[width];if(!axis)return;
 const language=ru?1:0,legend=Math.max(width-90,Math.round((width-4)*.75)),pointDivider=axis.point[language],column=axis.column,rowHeight=axis.rows[language],days=axis.days[language],scroll=23+rowHeight*4>height-2,right=legend-(scroll?13:0),start=pointDivider+2*column+1,step=(right-start)/days;
 const data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);
 function pixel(x,y,color){if(x<1||x>=width-1||y<1||y>=height-1)return;const i=((y-1)*(width-2)+x-1)*4;for(let c=0;c<3;c++)data[i+c]=typeof color==='number'?color:color[c];}
 function rect(x,y,w,h,color,clip=[1,1,width-1,height-1]){for(let yy=Math.max(1,y,clip[1]);yy<Math.min(height-1,y+h,clip[3]);yy++)for(let xx=Math.max(1,x,clip[0]);xx<Math.min(width-1,x+w,clip[2]);xx++)pixel(xx,yy,color);}
 function text(value,pen,baseline,{foreground=77,clip=[1,1,width-1,height-1],numeric=false,clipAdvance=false}={}){
  const image=raster(value,numeric),bounds=[...clip];
  // A partially visible line goes through the native bounded text-image path.
  if(foreground===77&&baseline>height-2){bounds[0]=Math.max(bounds[0],pen+Math.max(0,image.inkLeft));bounds[2]=Math.min(bounds[2],pen+Math.min(image.advance,image.inkRight));}
  else if(clipAdvance){bounds[0]=Math.max(bounds[0],pen);bounds[2]=Math.min(bounds[2],pen+image.advance);}
  for(const g of image.glyphs)for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++){
   const tx=pen+g.pen+g.left+x,ty=baseline-g.top+y;if(tx<Math.max(1,bounds[0])||tx>=Math.min(width-1,bounds[2])||ty<Math.max(1,bounds[1])||ty>=Math.min(height-1,bounds[3]))continue;
   const i=((ty-1)*(width-2)+tx-1)*4,alpha=(y*g.columns+x)*3;for(let c=0;c<3;c++){const coverage=g.coverage[alpha+c];data[i+c]=Math.round((foreground*coverage+data[i+c]*(255-coverage))/255);}
  }
 }
 function cell(left,end,label,table=false){rect(left+1,3,end-left-2,19,242);rect(end,2,1,21,204);if(label)text(label,left+(table?4:1),17,{clip:[left,2,end,23],numeric:!table});}
 let previous=2;for(const divider of [pointDivider,...(column?[pointDivider+column,pointDivider+2*column]:[])]){cell(previous,divider,previous===2?undefined:'<',true);previous=divider+1;}
 if(step>=15){previous=start;for(let i=0;i<days;i++){const end=Math.floor(start+(i+1)*step);cell(previous,end,String(i+1).padStart(2,'0'));previous=end+1;}}
 else rect(start+1,3,right-start-2,19,242);
 rect(2,23,right-2,1,204);if(scroll)rect(right,2,1,21,255);
 for(let i=0;i<4;i++)rect(2,23+rowHeight*(i+1),right-2,1,230);
 if(step>=15)for(let i=1;i<days;i++)for(let y=24;y<Math.min(height-1,24+rowHeight*4);y+=2)pixel(Math.floor(start+i*step),y,230);
 for(let i=0;i<4;i++){
  const baseline=39+rowHeight*i,caption=`<${point} ${i+1}>`,lines=width>=350?[caption]:width===200?[`<${point}`,`${i+1}>`]:['<',ru?'Точк':'Point',`${ru?'а ':''}${i+1}>`];
  lines.forEach((line,index)=>text(line,6,baseline+index*16,{clip:[2,24,pointDivider,height-2]}));
  if(column){
   const values=ru?(column===33?['<','Зна','чен','ие>']:column===42?['<','Знач','ение','>']:['<','З','н','а','ч','е','н','и','е','>']):(column===33?['<','Val','ue>']:column===42?['<','Value','>']:['<','V','al','u','e','>']);
   for(let col=0;col<2;col++)values.forEach((line,index)=>text(line,pointDivider+5+column*col,baseline+index*16,{clip:[pointDivider+1+col*column,24,pointDivider+(col+1)*column,height-2],clipAdvance:ru&&column===33&&index===1}));
  }
 }
 function interval(x,y,w,color,point=false){
  const bottomRight=point?colorPointBottomRight:coverage.bottomRight;
  for(let yy=0;yy<22;yy++)for(let xx=0;xx<=w;xx++){
   const alpha=yy<4&&xx<4?coverage.topLeft[yy][xx]:yy<4&&xx>w-4?coverage.topRight[yy][xx-w+3]:yy>17&&xx<4?coverage.bottomLeft[yy-18][xx]:yy>17&&xx>w-4?bottomRight[yy-18][xx-w+3]:yy===0?coverage.top:yy===21?coverage.bottom:xx===0?coverage.left:xx===w?coverage.right:255;
   const tx=x+xx,ty=y+yy;if(tx<1||tx>=right||ty<24||ty>=height-2)continue;const i=((ty-1)*(width-2)+tx-1)*4;for(let c=0;c<3;c++)data[i+c]=Math.round((color[c]*alpha+data[i+c]*(255-alpha))/255);
  }
 }
 for(const [row,begin,end,point]of [[0,0,2,false],[0,4,9,false],[1,1,5,false],[3,2,6,false],[3,3,4,true]]){
  const x=Math.floor(start+begin*step),last=end===6?Math.ceil(start+end*step)-1:Math.floor(start+end*step),y=23+rowHeight*row+Math.round((rowHeight-21)/2);
  // A native color point paints the default blue interval before its own color.
  interval(x,y,last-x,[87,146,239]);if(point)interval(x,y,last-x,[249,141,82],true);
 }
 if(!scroll)rect(right,2,1,height-4,160);
 else{
  const colors=scrollbarPaint.active,thumb=ru&&width===500?128:8;
  function fragment(name,x,y){colors[name].forEach((row,yy)=>row.forEach((value,xx)=>pixel(x+xx,y+yy,value)));}
  rect(right+3,25,8,height-50,214);fragment('verticalTrackEnd',right+3,height-29);rect(right+3,25,8,thumb,154);fragment('verticalStart',right+3,25);fragment('verticalThumbEnd',right+3,25+thumb-4);fragment('upArrow',right+4,11);fragment('downArrow',right+4,height-15);
 }
 const swatchY=Math.floor((height-1)/2)-7;rect(legend+4,swatchY,16,16,160);rect(legend+5,swatchY+1,14,14,[87,146,239]);let label=`<${series} 1>`;if(width===200)label=label.slice(0,2)+'…';if(width===150)label=label.slice(0,1)+'…';text(label,legend+21,swatchY+12,{foreground:51,clip:[legend+21,1,width-1,height-1]});
 return data;
}
