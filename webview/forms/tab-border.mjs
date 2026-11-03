const BORDER = [179,179,179];
// The two path ends have different native coverage; they are not mirror images.
const TOP_LEFT = [[16,0],[191,0],[255,0],[255,0],[191,0],[207,0],[80,127],[16,255],[255,0],[80,127],[0,255],[0,255],[255,0],[0,255],[0,255],[0,255]];
const TOP_RIGHT = [[255,0],[255,0],[191,0],[16,0],[0,255],[80,128],[207,0],[191,0],[0,255],[0,255],[80,128],[255,0],[0,255],[0,255],[16,255],[255,0]];
const rgb = value => Array.isArray(value) && value.length===3 && value.every(c=>Number.isInteger(c)&&c>=0&&c<=255);
// Qt composites premultiplied source and attenuated destination independently.
const blend = (outside,inside,alpha) => outside.map((c,i)=>Math.round(c*(255-alpha)/255)+Math.round(inside[i]*alpha/255));

export function tabBackground(background, active) {
  if (!rgb(background)) throw new Error('tab-border-color');
  return active ? background : background.every(c=>c===255) ? [235,235,235] : background.map(c=>Math.max(0,c-16));
}

/** Linux Taxi 8.3.27, 96 DPI, horizontal Auto/TabsOnTop/Swipe headers. */
export function tabCornerPixels({outside,background,pageBackground,active,previous,next}) {
  if (![outside,background,pageBackground].every(rgb) || [previous,next].some(n=>n&&!rgb(n.background))) throw new Error('tab-border-color');
  const top = (masks,neighbour,right) => masks.map(([stroke,fill],index)=>{
    let value=blend(outside,background,fill);
    if(neighbour && index%4===(right?3:0)) value=blend(value,BORDER,stroke);
    return blend(value,BORDER,stroke);
  });
  const bottom=(right)=>{
    const neighbour=right?next:previous,edgeTab=right&&next?next:{background,active};
    const upper=edgeTab.active?BORDER:blend(BORDER,edgeTab.background,32);
    const lower=active||neighbour?.active?blend(BORDER,pageBackground,32):BORDER;
    const inner=active?background:BORDER;
    return right?[background,background,upper,inner,inner,lower]:[upper,background,background,lower,inner,inner];
  };
  return {topLeft:top(TOP_LEFT,previous,false),topRight:top(TOP_RIGHT,next,true),bottomLeft:bottom(false),bottomRight:bottom(true)};
}
