import {documentSurfaceMetrics} from './document-surface.mjs';
import {viewStatusAddition} from './model.mjs';

// Empty native PDF samples share these small opaque scrollbar fragments.
import {scrollbarPaint as paint} from './scrollbar-paint.mjs';
const horizontal={"200":31,"300":85,"310":91,"350":121,"500":266},vertical={"43":0,"68":0,"93":8,"118":8,"218":27,"243":36};

export function pdfSurfaceMetrics(node,os){
 const document=documentSurfaceMetrics(node,os),width=document.calibrated&&viewStatusAddition(node)?Math.max(300,document.width):document.width;
 return {...document,width,calibrated:document.calibrated&&Object.hasOwn(horizontal,width)&&Object.hasOwn(vertical,document.height)};
}

/** Recorded axes only: the general native thumb-length rule is still unmeasured. */
export function pdfSurfaceRgba(width,height,enabled=true){
 if(!Object.hasOwn(horizontal,width)||!Object.hasOwn(vertical,height))return undefined;
 const data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);const colors=paint[enabled?'active':'disabled'];
 function pixel(x,y,value){const i=((y-1)*(width-2)+x-1)*4;data[i]=data[i+1]=data[i+2]=value;}
 function rect(x,y,w,h,value){for(let b=y;b<y+h;b++)for(let a=x;a<x+w;a++)pixel(a,b,value);}
 function fragment(name,x,y){const value=colors[name];for(let b=0;b<value.length;b++)for(let a=0;a<value[b].length;a++)pixel(x+a,y+b,value[b][a]);}
 rect(1,9,1,height-24,0);rect(1,9,width-16,1,0);
 rect(24,height-12,width-62,8,214);fragment('horizontalTrackEnd',width-42,height-12);rect(24,height-12,horizontal[width],8,enabled?154:194);fragment('horizontalStart',24,height-12);fragment('horizontalThumbEnd',24+horizontal[width]-4,height-12);fragment('leftArrow',10,height-11);fragment('rightArrow',width-28,height-11);
 const available=height-16,first=Math.min(23,Math.floor(available/2)),last=Math.min(23,available-first);
 fragment('upArrow',width-11,1+Math.floor((first-4)/2));fragment('downArrow',width-11,1+available-last+Math.ceil((last-4)/2));
 if(vertical[height]){rect(width-12,24,8,height-62,214);fragment('verticalTrackEnd',width-12,height-42);rect(width-12,24,8,vertical[height],enabled?154:194);fragment('verticalStart',width-12,24);fragment('verticalThumbEnd',width-12,24+vertical[height]-4);}
 return data;
}
