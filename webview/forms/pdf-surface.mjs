import {documentSurfaceMetrics} from './document-surface.mjs';
import {viewStatusAddition} from './model.mjs';

// Empty native PDF samples share these small opaque scrollbar fragments.
const paint={"active":{"horizontalStart":[[255,234,177,157],[234,158,154,154],[177,154,154,154],[157,154,154,154],[157,154,154,154],[177,154,154,154],[234,158,154,154],[255,235,177,158]],"horizontalThumbEnd":[[157,173,205,214],[154,154,158,205],[154,154,154,174],[154,154,154,157],[154,154,154,157],[154,154,154,174],[154,154,158,205],[158,173,205,214]],"horizontalTrackEnd":[[216,227,249,255],[214,214,217,249],[214,214,214,227],[214,214,214,216],[214,214,214,216],[214,214,214,227],[214,214,217,249],[216,227,249,255]],"verticalStart":[[255,234,177,157,157,177,235,255],[234,158,154,154,154,154,158,234],[177,154,154,154,154,154,154,178],[157,154,154,154,154,154,154,157]],"verticalThumbEnd":[[157,154,154,154,154,154,154,157],[173,154,154,154,154,154,154,174],[205,158,154,154,154,154,158,205],[214,205,173,158,158,173,205,214]],"verticalTrackEnd":[[216,214,214,214,214,214,214,216],[227,214,214,214,214,214,214,227],[249,217,214,214,214,214,217,249],[255,249,227,216,216,227,249,255]],"leftArrow":[[255,255,253,217],[255,244,205,194],[232,196,194,194],[232,196,194,194],[255,244,205,194],[255,255,253,217]],"rightArrow":[[151,248,255,255],[89,118,226,255],[89,89,96,193],[89,89,96,193],[89,118,226,255],[151,248,255,255]],"upArrow":[[255,255,232,232,255,255],[255,245,196,196,245,255],[253,204,194,194,204,253],[217,194,194,194,194,217]],"downArrow":[[151,89,89,89,89,151],[248,116,89,89,116,248],[255,228,96,96,228,255],[255,255,193,193,255,255]]},"disabled":{"horizontalStart":[[255,240,205,195],[240,195,194,194],[204,194,194,194],[195,194,194,194],[195,194,194,194],[205,194,194,194],[241,195,194,194],[255,241,205,195]],"horizontalThumbEnd":[[195,200,211,214],[194,194,195,211],[194,194,194,201],[194,194,194,195],[194,194,194,195],[194,194,194,201],[194,194,195,211],[195,200,211,214]],"horizontalTrackEnd":[[216,227,249,255],[214,214,217,249],[214,214,214,227],[214,214,214,216],[214,214,214,216],[214,214,214,227],[214,214,217,249],[216,227,249,255]],"verticalStart":[[255,240,205,195,195,205,241,255],[240,195,194,194,194,194,195,241],[204,194,194,194,194,194,194,205],[195,194,194,194,194,194,194,195]],"verticalThumbEnd":[[195,194,194,194,194,194,194,195],[200,194,194,194,194,194,194,201],[211,195,194,194,194,194,195,211],[214,211,200,195,195,200,211,214]],"verticalTrackEnd":[[216,214,214,214,214,214,214,216],[227,214,214,214,214,214,214,227],[249,217,214,214,214,214,217,249],[255,249,227,216,216,227,249,255]],"leftArrow":[[255,255,253,217],[255,244,205,194],[232,196,194,194],[232,196,194,194],[255,244,205,194],[255,255,253,217]],"rightArrow":[[217,253,255,255],[194,205,244,255],[194,194,196,232],[194,194,196,232],[194,205,244,255],[217,253,255,255]],"upArrow":[[255,255,232,232,255,255],[255,245,196,196,245,255],[253,204,194,194,204,253],[217,194,194,194,194,217]],"downArrow":[[217,194,194,194,194,217],[253,204,194,194,204,253],[255,245,196,196,245,255],[255,255,232,232,255,255]]}};
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
