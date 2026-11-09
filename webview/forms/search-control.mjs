/** Native 7x7 clear glyph, measured against the initial Linux search control. */
export const searchClearAlpha=Object.freeze([0,27,0,0,0,27,0,30,212,57,0,57,212,30,0,57,212,105,212,59,0,0,0,106,231,106,0,0,0,57,212,106,212,57,0,30,212,57,0,57,212,30,0,27,0,0,0,27,0]);

const inactiveClear = [
  255,245,255,255,255,245,255,
  244,179,235,255,235,179,244,
  255,234,179,217,179,234,255,
  255,255,217,172,217,255,255,
  255,235,179,217,179,234,255,
  244,179,234,255,234,179,244,
  255,245,255,255,255,245,255,
];

export function searchClearPixels(foreground,background,inactive=false){
 if(inactive)return inactiveClear.map(value=>[value,value,value]);
 if([foreground,background].some(color=>!Array.isArray(color)||color.length!==3||color.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new Error('search-clear-color');
 return searchClearAlpha.map(alpha=>background.map((value,index)=>Math.round(value+(foreground[index]-value)*alpha/255)));
}

/** Gray hint measured on light and dark fills, separately from the authored value ink. */
export function searchHintGray(background, authoredInk) {
  const light = Math.max(...background);
  if (!authoredInk && light <= 220) return Math.round(light * 2 / 3 + 32);
  const base = !authoredInk ? 200 : Math.max(...authoredInk) >= 200 ? 77 : 240;
  return Math.max(0, base - Math.round((255 - light) / 2));
}
