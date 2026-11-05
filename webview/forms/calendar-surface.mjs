import {flag,number,fontLineMetrics} from './model.mjs';
import {hintedTextWidth,hintedPairTextAdvances} from './font-metrics.mjs';

const profiles=[{points:10,weight:400,digit:7,pair11:[7,7]},{points:12,weight:400,digit:9,pair11:[8,9]},{points:16,weight:700,digit:12,pair11:[11,11]}];
const arrows={"dropdown": [[255, 255, 255, 255, 221, 255], [255, 255, 255, 171, 126, 255], [255, 255, 171, 121, 121, 255], [255, 171, 121, 121, 121, 255], [221, 126, 121, 121, 121, 255]], "previous": [[255, 255, 255, 255, 221], [255, 255, 255, 171, 126], [255, 255, 171, 123, 126], [255, 171, 123, 126, 221], [250, 127, 121, 193, 255], [255, 221, 123, 123, 221], [255, 255, 221, 123, 126], [255, 255, 255, 221, 126], [255, 255, 255, 255, 221]], "next": [[221, 255, 255, 255, 255], [123, 221, 255, 255, 255], [123, 123, 221, 255, 255], [221, 123, 123, 221, 255], [255, 157, 121, 132, 250], [171, 123, 126, 221, 255], [123, 126, 221, 255, 255], [126, 221, 255, 255, 255], [221, 255, 255, 255, 255]], "inactivePrevious": [[255, 255, 255, 255, 238], [255, 255, 255, 213, 191], [255, 255, 213, 190, 191], [255, 213, 190, 191, 238], [252, 190, 188, 224, 255], [255, 238, 190, 190, 238], [255, 255, 238, 190, 191], [255, 255, 255, 238, 191], [255, 255, 255, 255, 238]], "inactiveNext": [[238, 255, 255, 255, 255], [190, 238, 255, 255, 255], [190, 190, 238, 255, 255], [238, 190, 190, 238, 255], [255, 206, 188, 193, 252], [213, 190, 191, 238, 255], [190, 191, 238, 255, 255], [191, 238, 255, 255, 255], [238, 255, 255, 255, 255]]};
const upper=(value,culture)=>value[0].toLocaleUpperCase(culture)+value.slice(1);

/** Calendar month counts take precedence over character dimensions in 8.3.27. */
export function calendarSurfaceMetrics(node,os){
 const font=node.presentation.font??{},profile=profiles.find(p=>p.points===(font.points??10)&&p.weight===(font.weight??400)),line=fontLineMetrics(font);
 const digit=profile?.digit??hintedTextWidth('0',{family:'ESKA Taxi Sans',pixels:line.pixels,weight:font.weight??400})??7;
 const cellWidth=3*digit+21,rowHeight=line.ascent+line.descent+15;
 const widthMonths=number(node,'WidthInMonths',1),heightMonths=number(node,'HeightInMonths',1),columns=Math.max(1,Math.min(12,Math.trunc(widthMonths))),rows=Math.max(1,Math.min(12,Math.trunc(heightMonths)));
 const monthsPanel=flag(node,'ShowMonthsPanel',false),currentDate=flag(node,'ShowCurrentDate'),panelWidth=2*cellWidth+22,footer=currentDate&&!monthsPanel;
 const width=widthMonths===0&&number(node,'Width')>0?number(node,'Width')*10+2:columns*(cellWidth*7+17)+27+(monthsPanel?panelWidth+7:0);
 const height=rows*(rowHeight*8+7)-7+24+(footer?rowHeight+6:0);
 const calibrated=os==='linux'&&!!profile&&[null,undefined,'Arial','Liberation Sans'].includes(font.face)&&!font.italic&&!font.underline&&!font.strikeout
  &&[0,1,2].includes(widthMonths)&&[0,1,2].includes(heightMonths)
  &&(widthMonths!==0||[20,35,60].includes(number(node,'Width')))
  &&(heightMonths!==0||[5,9,20].includes(number(node,'Height',9)))
  &&Number.isInteger(width)&&Number.isInteger(height)&&width>2&&height>2&&width<=4096&&height<=4096&&width*height<=4194304;
 return {width,height,columns,rows,monthsPanel,currentDate,panelWidth,cellWidth,rowHeight,...line,profile,calibrated};
}

/** Recorded calendar glyph placement; the numeric 11 pair has its own native advance. */
export function calendarTextAdvances(value,metrics){
 const {profile,pixels}=metrics;if(!profile)return;
 if(/^\d+$/.test(value))return value==='11'?[...profile.pair11]:[...value].map(()=>profile.digit);
 const output=hintedPairTextAdvances(value,{family:'ESKA Taxi Sans',pixels,weight:profile.weight});
 // The 12pt native UI label retains the hinted advance of Cyrillic г before о.
 if(output&&pixels===16)for(let i=0;i<value.length-1;i++)if(value.slice(i,i+2)==='го')output[i]=hintedTextWidth('г',{family:'ESKA Taxi Sans',pixels,weight:profile.weight});
 return output;
}

/** The complete static calendar surface; OS borders are painted by the enclosing control. */
export function calendarSurfaceRgba(metrics,{date,culture='en-US',todayLabel='Today',inactive=false},raster){
 const {width,height,columns,rows,cellWidth:cw,rowHeight:rh,panelWidth:pw,monthsPanel,currentDate,profile,ascent,descent,pixels}=metrics;
 if(!metrics.calibrated||culture!=='en-US'||!['Today','Сегодня'].includes(todayLabel)||!(date instanceof Date)||!Number.isFinite(date.getTime())||typeof raster!=='function')return;
 const data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);
 let clipRight=width-1;
 function pixel(x,y,color){if(x<1||x>=clipRight||y<1||y>=height-1)return;const index=((y-1)*(width-2)+x-1)*4;for(let c=0;c<3;c++)data[index+c]=typeof color==='number'?color:color[c];}
 function rect(x,y,w,h,color){for(let b=Math.max(1,y);b<Math.min(height-1,y+h);b++)for(let a=Math.max(1,x);a<Math.min(clipRight,x+w);a++)pixel(a,b,color);}
 function text(value,pen,baseline,foreground){const glyphs=raster(String(value));for(const g of glyphs.glyphs)for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++){
  const tx=pen+g.pen+g.left+x,ty=baseline-g.top+y;if(tx<1||tx>=clipRight||ty<1||ty>=height-1)continue;
  const index=((ty-1)*(width-2)+tx-1)*4,alpha=(y*g.columns+x)*3;
  for(let c=0;c<3;c++)data[index+c]=Math.round((foreground[c]*g.coverage[alpha+c]+data[index+c]*(255-g.coverage[alpha+c]))/255);
 }return glyphs.advance;}
 function center(value,x,baseline,w,color,numeric=false,round=false){const advance=raster(String(value)).advance,offset=numeric||round?Math.round((w-advance)/2):Math.floor((w-advance)/2);text(value,x+offset,baseline,color);}
 function fragment(name,x,y){const bitmap=arrows[inactive&&name!=='dropdown'?'inactive'+name[0].toUpperCase()+name.slice(1):name];for(let b=0;b<bitmap.length;b++)for(let a=0;a<bitmap[b].length;a++){const gray=bitmap[b][a];pixel(x+a,y+b,inactive&&name==='dropdown'?Math.round((gray+255)/2):gray);}}
 function selected(x,y,w,h){rect(x,y,w,h,inactive?[101,203,149]:[0,150,70]);rect(x+2,y+2,w-4,h-4,255);rect(x+3,y+3,w-6,h-6,inactive?176:96);}
 const normal=inactive?[211,211,211]:[77,77,77],header=inactive?[166,166,166]:normal,weekend=inactive?[255,210,192]:[255,74,0],headerWeekend=inactive?[255,165,128]:weekend,adjacent=inactive?[211,211,211]:[166,166,166],link=inactive?[154,200,231]:[70,151,206];
 const year=date.getFullYear(),month=date.getMonth(),gw=cw*7,gh=rh*8,group=columns*gw+(columns-1)*7+(monthsPanel?pw+7:0),left=Math.floor((width-group)/2),baseline=Math.ceil((rh+ascent-descent)/2);
 const monthNames=Array.from({length:12},(_,m)=>upper(new Intl.DateTimeFormat(culture,{month:'long'}).format(new Date(2026,m,1)),culture));
 const weekdays=Array.from({length:7},(_,d)=>upper(new Intl.DateTimeFormat(culture,{weekday:'short'}).format(new Date(2026,5,7+d)),culture));
 for(let index=0;index<columns*rows;index++){
  const first=new Date(year,month+index,1),x=left+(monthsPanel?pw+7:0)+(index%columns)*(gw+7),y=12+Math.floor(index/columns)*(gh+7),headerBaseline=y+baseline;
  for(let row=0;row<9;row++)rect(x,y+row*rh,gw+1,1,222);
  for(let col=0;col<8;col++){const edge=col===0||col===7;rect(x+col*cw,y+(edge?rh:2*rh),1,(edge?7:6)*rh+1,222);}
  rect(x,y,1,rh,222);rect(x+gw,y,1,rh,222);
  if(index===0){
   for(const col of monthsPanel?[5,6]:[2,5,6])rect(x+col*cw,y,1,rh,222);
   if(!monthsPanel){text(first.getFullYear(),x+(profile.weight>500?8:9),headerBaseline,header);fragment('dropdown',x+2*cw-8,y+rh-8);}
   text(monthNames[first.getMonth()],x+(monthsPanel?0:2*cw)+10,headerBaseline,header);fragment('dropdown',x+5*cw-8,y+rh-8);
   fragment('previous',x+5*cw+Math.round(cw/2)-3,y+Math.floor(rh/2)-4);fragment('next',x+6*cw+Math.round(cw/2)-1,y+Math.floor(rh/2)-4);
  }else if(index%columns===0&&first.getFullYear()!==year){rect(x+2*cw,y,1,rh,222);text(first.getFullYear(),x+9,headerBaseline,header);text(monthNames[first.getMonth()],x+2*cw+10,headerBaseline,header);}
  else text(monthNames[first.getMonth()],x+10,headerBaseline,header);
  for(let col=0;col<7;col++)center(weekdays[col],x+col*cw,y+rh+baseline,cw,col===0||col===6?headerWeekend:header);
  for(let cell=0;cell<42;cell++){
   const day=new Date(first.getFullYear(),first.getMonth(),cell-first.getDay()+1),col=cell%7,xx=x+col*cw,yy=y+(Math.floor(cell/7)+2)*rh,other=day.getMonth()!==first.getMonth();
   if(other&&!((day<first&&index===0)||(day>first&&index===columns*rows-1)))continue;
   let foreground=other?adjacent:col===0||col===6?weekend:normal;
   if(day.getFullYear()===year&&day.getMonth()===month&&day.getDate()===date.getDate()){
    if(currentDate)selected(xx,yy,cw+1,rh+1);else rect(xx+2,yy+2,cw-3,rh-3,inactive?176:96);
    foreground=[218,218,218];
   }
   center(day.getDate(),xx,yy+baseline,cw,foreground,true);
  }
 }
 let pen,base,advance;
 if(monthsPanel){
  const x=left,y=12;rect(x,y,pw+1,1,222);rect(x,y+8*rh,pw+1,1,222);rect(x,y,1,8*rh,222);rect(x+pw,y,1,8*rh,222);
  for(let row=1;row<8;row++)rect(x,y+row*rh,pw+1,1,222);rect(x+Math.floor(pw/2),y+rh,1,6*rh,222);
  text(year,x+16,y+baseline,normal);fragment('dropdown',x+pw-8,y+rh-8);
  for(let m=0;m<12;m++){
   const xx=x+Math.floor(m/6)*Math.floor(pw/2),yy=y+(m%6+1)*rh;let foreground=normal;
   if(m===month){rect(xx+2,yy+2,Math.floor(pw/2)-3,rh-3,96);foreground=[218,218,218];}
   const label=upper(new Intl.DateTimeFormat(culture,{month:'short'}).format(new Date(2026,m,1)),culture);center(label,xx,yy+baseline,Math.floor(pw/2),foreground,false,true);
  }
  advance=raster(todayLabel).advance;pen=x+Math.round((pw-advance)/2);base=y+7*rh+baseline;text(todayLabel,pen,base,link);
 }else if(currentDate){
  const rest=', '+new Intl.DateTimeFormat(culture,{dateStyle:'long'}).format(date),labelAdvance=raster(todayLabel).advance;advance=labelAdvance+raster(rest).advance;
  pen=left+9;base=12+rows*gh+(rows-1)*7+Math.ceil((rh+6+ascent-descent)/2);
  // Native clips the link's own text rectangle when its left edge is outside the field.
  if(pen<1)clipRight=Math.min(clipRight,pen+advance);
  text(todayLabel,pen,base,link);text(rest,pen+labelAdvance,base,link);
 }else return data;
 if(!inactive)for(let offset=0;offset<advance;offset++){
  const cap=todayLabel==='Сегодня'&&pixels===13?192:224,alpha=Math.min([224,255,255,224,0,0][offset%6],offset===advance-1?cap:255);
  const rgb=alpha===255?link:alpha===192?[116,177,218]:alpha===224?[93,164,212]:[255,255,255];pixel(pen+offset,base+Math.round(pixels/4),rgb);
 }
 return data;
}
