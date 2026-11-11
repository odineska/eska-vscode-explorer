const BORDER = [179,179,179];
const DISABLED_BORDER = [251,251,251];
// The two path ends have different native coverage; they are not mirror images.
const TOP_LEFT = [[16,0],[191,0],[255,0],[255,0],[191,0],[207,0],[80,127],[16,255],[255,0],[80,127],[0,255],[0,255],[255,0],[0,255],[0,255],[0,255]];
const TOP_RIGHT = [[255,0],[255,0],[191,0],[16,0],[0,255],[80,128],[207,0],[191,0],[0,255],[0,255],[80,128],[255,0],[0,255],[0,255],[16,255],[255,0]];
// Bottom alignment moves one partial stroke between the two inside edges.
const BOTTOM_RIGHT = TOP_RIGHT.map((pixel, index) => index === 4 ? [16,255] : index === 14 ? [0,255] : pixel);
const rgb = value => Array.isArray(value) && value.length===3 && value.every(c=>Number.isInteger(c)&&c>=0&&c<=255);
// Qt composites premultiplied source and attenuated destination independently.
const blend = (outside,inside,alpha) => outside.map((c,i)=>Math.round(c*(255-alpha)/255)+Math.round(inside[i]*alpha/255));

function paintCorner(masks, outside, background, border, overlaps) {
  return masks.map(([stroke, fill], index) => {
    const pixel = blend(blend(outside, background, fill), border, stroke);
    return overlaps(index) ? blend(pixel, border, stroke) : pixel;
  });
}

export function tabBackground(background, active) {
  if (!rgb(background)) throw new Error('tab-border-color');
  return active ? background : background.every(c=>c===255) ? [235,235,235] : background.map(c=>Math.max(0,c-16));
}

/** Linux Taxi 8.3.27, 96 DPI, horizontal headers. */
export function tabCornerPixels({outside,background,pageBackground,active,previous,next,bottom}) {
  if (![outside,background,pageBackground].every(rgb) || [previous,next].some(n=>n&&!rgb(n.background))) throw new Error('tab-border-color');
  const top = (masks,neighbour,right) => paintCorner(masks, outside, background, BORDER,
    index => neighbour && index % 4 === (right ? 3 : 0));
  const join=(right)=>{
    const neighbour=right?next:previous,edgeTab=right&&next?next:{background,active};
    const upper=edgeTab.active?BORDER:blend(BORDER,edgeTab.background,32);
    const lower=active||neighbour?.active?blend(BORDER,pageBackground,32):BORDER;
    const inner=active?background:BORDER;
    return right?[background,background,upper,inner,inner,lower]:[upper,background,background,lower,inner,inner];
  };
  return {topLeft:top(TOP_LEFT,previous,false),topRight:top(bottom ? BOTTOM_RIGHT : TOP_RIGHT,next,true),bottomLeft:join(false),bottomRight:join(true)};
}


// Side headers overlap vertically. The outer mask starts at the top left in
// strip coordinates; its horizontal ordering is reversed for the right side.
const SIDE_BOTTOM = half => [
  [255,0], [0,half], [0,255], [0,255],
  [255,0], [80,0],   [0,half], [0,255],
  [191,0], [207,0],  [80,0],   [16,half],
  [16,0],  [191,0],  [255,0],  [255,0],
];
const SIDE_DISABLED_TOP_STROKE = [
  0,   255, 255, 255,
  255, 0,   0,   0,
  255, 0,   0,   0,
  255, 0,   0,   0,
];
function mirrorCorner(pixels) {
  const mirrored = [];
  for (let row = 0; row < pixels.length; row += 4) {
    mirrored.push(...pixels.slice(row, row + 4).reverse());
  }
  return mirrored;
}

/** Linux Taxi 8.3.27, 96 DPI, horizontal captions on a vertical tab strip. */
export function sideTabCornerPixels({ side, outside, background, active, previous, next, disabled }) {
  const right = side === 'right', border = disabled ? DISABLED_BORDER : BORDER;
  const top = right ? mirrorCorner(TOP_RIGHT) : TOP_LEFT;
  const bottom = SIDE_BOTTOM(right ? 128 : 127);
  const outer = (masks, below, neighbour) => {
    // Designer uses an aliased highlight stroke on disabled pages, with the same fill mask.
    const coverage = disabled ? masks.map(([, fill], index) => {
      const row = Math.floor(index / 4), column = index % 4;
      return [SIDE_DISABLED_TOP_STROKE[(below ? 3 - row : row) * 4 + column], fill];
    }) : masks;
    const pixels = paintCorner(coverage, outside, background, border,
      index => neighbour && Math.floor(index / 4) === (below ? 3 : 0));
    return right ? mirrorCorner(pixels) : pixels;
  };
  const join = (fill, joinsPage) => {
    const edge = blend(fill, border, 223);
    const pixels = joinsPage ? [border, edge] : [edge, border];
    return right ? pixels.reverse() : pixels;
  };
  return {
    outerTop: outer(top, false, previous),
    outerBottom: outer(bottom, true, next),
    joinTop: join(background, active),
    joinBottom: next ? join(next.background, next.active) : join(active ? border : outside, false),
  };
}
