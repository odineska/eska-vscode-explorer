/** Native 7x7 clear glyph, measured against the initial Linux search control. */
export const searchClearAlpha=Object.freeze([0,27,0,0,0,27,0,30,212,57,0,57,212,30,0,57,212,105,212,59,0,0,0,106,231,106,0,0,0,57,212,106,212,57,0,30,212,57,0,57,212,30,0,27,0,0,0,27,0]);

export function searchClearPixels(foreground,background){
 if([foreground,background].some(color=>!Array.isArray(color)||color.length!==3||color.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new Error('search-clear-color');
 return searchClearAlpha.map(alpha=>background.map((value,index)=>Math.round(value+(foreground[index]-value)*alpha/255)));
}
