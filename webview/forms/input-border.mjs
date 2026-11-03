const BORDER = [6,136,230,136,182,28,230,28,0];
const FILL = [0,0,0,0,73,227,0,227,255];
const blend = (outside, inside, alpha) => outside.map((value,index)=>Math.round((value*(255-alpha)+inside[index]*alpha)/255));
const rgb = value => Array.isArray(value) && value.length===3 && value.every(channel=>Number.isInteger(channel)&&channel>=0&&channel<=255);

/** Measured 96-DPI Linux profile; preserve the native border/fill composition order. */
export function inputBorderPixels(border, background, outside, {inactive=false, explicitBorder=false, choice=false} = {}) {
  if (![border,background,outside].every(rgb)) throw new Error('input-border-color');
  const stroke = inactive ? explicitBorder ? border.map(value=>Math.min(255,value+76)) : [215,215,215] : border;
  const fill = inactive ? outside : background;
  const corners = [];
  for(const [right,bottom] of [[false,false],[true,false],[false,true],[true,true]]) {
    const pixels = [];
    for(let y=0;y<3;y++) for(let x=0;x<3;x++) {
      const index=(bottom?2-y:y)*3+(right?2-x:x);
      let color=blend(outside,stroke,BORDER[index]);
      if (!inactive) color=blend(color,fill,FILL[index]);
      if (right && choice) color=blend(color,[255,255,255],FILL[index]);
      pixels.push(color);
    }
    corners.push(pixels);
  }
  return {border:stroke,background:fill,corners};
}

/** Native disabled text uses the original field fill, independently of its visible backdrop. */
export function disabledInputForeground(background) {
  if (!rgb(background)) throw new Error('input-border-color');
  return Array(3).fill(Math.ceil(Math.max(...background) / 2));
}
