import {smallCalculatorImages} from './input-calculator-images.mjs';
// Taxi 8.3.27 Linux at 96 DPI: the numeric input uses a 9x11 mark at the standard image size.
export const calculatorRects = [
  [1,0,7,1,'#4d4d4d'], [0,1,1,9,'#4d4d4d'], [8,1,1,9,'#4d4d4d'],
  [1,2,7,1,'#4d4d4d'], [1,10,7,1,'#4d4d4d'],
  [2,4,1,1,'#4d4d4d'], [4,4,1,1,'#4d4d4d'], [6,4,1,1,'#4d4d4d'],
  [2,6,1,1,'#4d4d4d'], [4,6,1,1,'#4d4d4d'], [6,6,1,3,'#4d4d4d'],
  [2,8,1,1,'#4d4d4d'], [4,8,1,1,'#4d4d4d'],
  [0,0,1,1,'#565656'], [8,0,1,1,'#565656'],
  [0,10,1,1,'#747474'], [8,10,1,1,'#747474'],
];

const inactiveColors = {'#4d4d4d':'#a4a4a4','#565656':'#a8a8a8','#747474':'#b7b7b7'};
export function calculatorFill(fill, inactive) { return inactive ? inactiveColors[fill] ?? fill : fill; }

export function calculatorImage(height, inactive) {
  const size=Math.max(1,Math.min(16,Math.trunc(height)-2)),small=smallCalculatorImages[`${size}:${Number(!!inactive)}`];
  if(!small)return {width:9,height:11,shiftX:0,shiftY:-1,rects:calculatorRects.map(([x,y,w,h,fill])=>[x,y,w,h,calculatorFill(fill,inactive)])};
  const rects=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;){
    const start=x,gray=small.gray.slice((y*size+x)*2,(y*size+x+1)*2);x++;
    while(x<size&&small.gray.slice((y*size+x)*2,(y*size+x+1)*2)===gray)x++;
    if(gray!=='ff')rects.push([start,y,x-start,1,'#'+gray.repeat(3)]);
  }
  return {width:size,height:size,shiftX:size%2?0:.5,shiftY:0,rects};
}
