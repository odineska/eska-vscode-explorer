const alpha=Object.freeze([74,227,255,227,59,0,255,0,0]);

/** Native rounded inner stroke on the empty geographical field's white surface. */
export function geographicalBorderPaint(border){
 if(!Array.isArray(border)||border.length!==3||border.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error('geographical-border-color');
 const stroke=border.map(v=>Math.max(0,v-17));
 const corners=[[false,false],[true,false],[false,true],[true,true]].map(([right,bottom])=>alpha.map((_,i)=>{
  const x=right?2-i%3:i%3,y=bottom?2-Math.floor(i/3):Math.floor(i/3),a=alpha[y*3+x];
  return stroke.map(v=>Math.round(255+(v-255)*a/255));
 }));
 return {stroke,corners};
}
