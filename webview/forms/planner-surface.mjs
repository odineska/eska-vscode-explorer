import {number} from './model.mjs';
import {hintedTextWidth} from './font-metrics.mjs';

const paint={"verticalThumbStart":[[255,239,210,204,204,210,241,255],[248,206,204,204,204,204,207,248],[227,204,204,204,204,204,204,228],[213,204,204,204,204,204,204,214],[207,204,204,204,204,204,204,207]],"verticalThumbEnd":[[207,204,204,204,204,204,204,207],[213,204,204,204,204,204,204,214],[227,204,204,204,204,204,204,228],[248,206,204,204,204,204,207,248],[245,238,210,204,204,210,240,245]],"verticalTrackEnd":[[235,234,234,234,234,234,234,236],[238,234,234,234,234,234,234,238],[244,234,234,234,234,234,234,244],[252,235,234,234,234,234,235,252],[255,248,236,234,234,237,249,255]],"horizontalThumbStart":[[255,248,227,213,207],[239,206,204,204,204],[210,204,204,204,204],[204,204,204,204,204],[204,204,204,204,204],[210,204,204,204,204],[241,207,204,204,204],[255,248,227,213,207]],"horizontalThumbEnd":[[207,213,227,248,245],[204,204,204,206,238],[204,204,204,204,210],[204,204,204,204,204],[204,204,204,204,204],[204,204,204,204,210],[204,204,204,207,240],[207,214,228,248,245]],"horizontalTrackEnd":[[235,238,244,252,255],[234,234,234,235,248],[234,234,234,234,237],[234,234,234,234,234],[234,234,234,234,234],[234,234,234,234,237],[234,234,234,235,249],[235,238,244,252,255]],"axisJoin":[[246,241,241],[251,241,241],[250,241,241],[244,241,241]],"scrollbarCorner":[230,227,224]};
const recordedAxes=new Set(['0:0','20:5','35:9','15:3','60:20']);

/** Native PlannerField ignores the generic Font, BackColor and BorderColor properties. */
export function plannerSurfaceMetrics(node,os){
 const width=number(node,'Width'),height=number(node,'Height'),linux=os==='linux';
 return {width:width>0?Math.max(15,width)*(linux?10:8)+(linux?0:4):500,height:height>0?Math.max(2,height)*(linux?25:20)+(linux?-7:3):243,
  pixels:13,ascent:12,descent:3,calibrated:linux&&recordedAxes.has(`${width}:${height}`)};
}

/** The recorded planner captions use hinted single advances, including an unkerned 11. */
export function plannerTextAdvances(text){return [...text].map(char=>hintedTextWidth(char,{family:'ESKA Taxi Sans',pixels:13,weight:400}));}

/** Static native demonstration; it does not evaluate the bound planner or execute handlers. */
export function plannerSurfaceRgba(metrics,{date,culture='en-US',meeting='Meeting'},raster){
 if(!metrics.calibrated||culture!=='en-US'||!(date instanceof Date)||!Number.isFinite(date.getTime())||!['Meeting','Встреча'].includes(meeting)||typeof raster!=='function')return;
 const {width,height}=metrics,data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);
 const horizontal=width<160,viewportHeight=height-(horizontal?12:0),vertical=viewportHeight<402,plotRight=width-2-(vertical?12:0),bottom=height-1-(horizontal?12:0),step=Math.max(384,viewportHeight-20)/24,axisStep=Math.max(383,viewportHeight-20)/24,plotWidth=Math.max(110,plotRight-41),clip=[1,1,plotRight+1,bottom];
 function pixel(x,y,color){if(x<1||x>=width-1||y<1||y>=height-1)return;const index=((y-1)*(width-2)+x-1)*4;for(let c=0;c<3;c++)data[index+c]=typeof color==='number'?color:color[c];}
 function rect(x,y,w,h,color,bounds=clip){for(let yy=Math.max(1,y,bounds[1]);yy<Math.min(height-1,y+h,bounds[3]);yy++)for(let xx=Math.max(1,x,bounds[0]);xx<Math.min(width-1,x+w,bounds[2]);xx++)pixel(xx,yy,color);}
 function text(image,pen,baseline,foreground=162,bounds=clip){
  for(const g of image.glyphs)for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++){
   const tx=pen+g.pen+g.left+x,ty=baseline-g.top+y;if(tx<Math.max(1,bounds[0])||tx>=Math.min(width-1,bounds[2])||ty<Math.max(1,bounds[1])||ty>=Math.min(height-1,bounds[3]))continue;
   const index=((ty-1)*(width-2)+tx-1)*4,alpha=(y*g.columns+x)*3;
   for(let c=0;c<3;c++){const coverage=g.coverage[alpha+c];data[index+c]=Math.round(foreground*coverage/255)+Math.round(data[index+c]*(255-coverage)/255);}
  }
 }
 rect(40,2,1,bottom-2,227);
 for(let hour=0;hour<24;hour++){
  const line=hour===0?17:18+Math.round(hour*step),axisLine=hour===0?17:18+Math.round(hour*axisStep),partial=18+Math.round((hour+1)*axisStep)>bottom;
  rect(2,axisLine,39,1,227);rect(41,line,1,1,hour===0?241:255);rect(42,line,plotRight-41,1,227);
  text(raster(`${String(hour).padStart(2,'0')}:00`),5,hour===0?30:31+Math.round(hour*axisStep),162,[1,18,partial?37:40,bottom]);
 }
 const heading=raster(new Intl.DateTimeFormat(culture,{dateStyle:'long'}).format(date));text(heading,42+Math.round((plotWidth-heading.advance)/2),14,162,[45,1,plotRight+1,17]);
 const eventTop=18+Math.round(step),eventWidth=Math.round(plotWidth*.95)-2,eventHeight=Math.round(4*step)-Math.round(step),eventClip=[45,eventTop+1,Math.min(plotRight+1,44+eventWidth-1),Math.min(bottom,eventTop+eventHeight-1)];
 rect(44,eventTop,eventWidth,eventHeight,255);rect(45,eventTop+1,eventWidth-2,eventHeight-2,[159,198,231]);text(raster('01:00'),53,eventTop+15,0,eventClip);
 const caption=raster(meeting);text(caption,88,eventTop+15,0,[Math.max(eventClip[0],meeting==='Встреча'?89:88),eventClip[1],Math.min(eventClip[2],88+caption.advance),eventClip[3]]);
 const hours=date.getHours()+date.getMinutes()/60+date.getSeconds()/3600+date.getMilliseconds()/3600000;rect(42,18+Math.round(hours*step),plotRight-41,1,[255,0,0]);
 // Configurator paints this demonstration layer halfway onto white, after its own LCD composition.
 for(let index=0;index<data.length;index+=4)for(let c=0;c<3;c++)data[index+c]=Math.floor((data[index+c]+255)/2);
 paint.axisJoin.forEach((color,index)=>pixel(40,23+index,color));
 function fragment(bitmap,x,y){for(let yy=0;yy<bitmap.length;yy++)for(let xx=0;xx<bitmap[yy].length;xx++)pixel(x+xx,y+yy,bitmap[yy][xx]);}
 function scrollbar(x,y,length,horizontal=false){
  const track=length-30,thumb=horizontal?95:Math.max(15,Math.min(track,Math.round(track*length/400))),bounds=[1,1,width-1,height-1];
  if(horizontal){
   rect(x,y,15,12,224,bounds);rect(x+length-15,y,15,12,224,bounds);rect(x+15,y+2,track,8,234,bounds);fragment(paint.horizontalTrackEnd,x+length-20,y+2);rect(x+15,y+2,thumb,8,204,bounds);fragment(paint.horizontalThumbStart,x+15,y+2);fragment(paint.horizontalThumbEnd,x+15+thumb-5,y+2);
  }else{
   rect(x,y,12,15,224,bounds);rect(x,y+length-15,12,15,224,bounds);rect(x+2,y+15,8,track,234,bounds);fragment(paint.verticalTrackEnd,x+2,y+length-20);rect(x+2,y+15,8,thumb,204,bounds);fragment(paint.verticalThumbStart,x+2,y+15);fragment(paint.verticalThumbEnd,x+2,y+15+thumb-5);
  }
 }
 if(vertical)scrollbar(width-13,1,viewportHeight-2);
 if(horizontal){scrollbar(1,height-13,width-14,true);rect(width-13,height-13,12,12,230,[1,1,width-1,height-1]);pixel(width-13,height-13,paint.scrollbarCorner);}
 return data;
}
