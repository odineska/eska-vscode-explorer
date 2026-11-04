import {calendarImages} from './input-calendar-images.mjs';
export function calendarImage(height,inactive) {
  const size=Math.max(1,Math.min(16,Math.trunc(height)-2)),gray=calendarImages[size+':'+Number(!!inactive)];
  if(!gray)return;
  const rects=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;){
    const start=x,color=gray.slice((y*size+x)*2,(y*size+x+1)*2);x++;
    while(x<size&&gray.slice((y*size+x)*2,(y*size+x+1)*2)===color)x++;
    if(color!=='ff')rects.push([start,y,x-start,1,'#'+color.repeat(3)]);
  }
  const free=height-2-size;
  return {size,shiftX:size%2?0:.5,shiftY:Math.floor(free/2)-free/2,rects};
}
