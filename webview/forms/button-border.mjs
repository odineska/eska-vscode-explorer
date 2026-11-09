import { buttonBackgroundShade } from './model.mjs';

const F = Math.fround, UNIT = 65536, INV255 = F(1 / 255), INV257 = F(1 / 257);
const OUTER = [[30,187,249],[188,255,255],[249,255,255]];
const INNER = [[0,0,0],[0,133,249],[0,249,255]];
const rgb = value => Array.isArray(value) && value.length === 3 && value.every(c => Number.isInteger(c) && c >= 0 && c <= 255);
const blend = (outside, inside, alpha) => Math.floor((outside * (255 - alpha) + inside * alpha + 127) / 255);
const even = value => { const lower = Math.floor(value); return value - lower === .5 ? lower + (lower % 2) : Math.round(value); };

/** Native blendColors(type=4, color, black, weight=38). */
export function buttonBorderShade(top) {
  if (!rgb(top)) throw new Error('button-border-color');
  return top.map(c => Math.floor(c * 217 / 255));
}

// Keep the transformed gradient origin and integer raster offset within the
// same fixed-point range. Which translation rounds best depends on both axes.
function positionedPhase(height, step, {x,y,width}) {
  const scaleX = 1 / width, scaleY = 1 / height;
  const tx = -x * scaleX, ty = -y * scaleY;
  let offsetY = ty, extent = Math.max(Math.abs(tx),Math.abs(ty));
  for (const sideX of [-1,1]) for (const sideY of [-1,1]) {
    const dx = -tx / (scaleX + sideX), dy = -ty / (scaleY + sideY);
    const next = Math.max(Math.abs(dx),Math.abs(dy));
    if (next < extent) {
      offsetY = dy;
      extent = next;
    }
  }
  // The fixed-point centre correction runs before applying the integer offset
  // in the pixel sampler. At a half unit the sampler rounds towards +infinity.
  const center = height / 2 + Math.floor(offsetY);
  return even(center * UNIT * scaleY) - Math.round(step * center);
}

function intrinsicPhase(height, step) {
  const center = height / 2;
  let phase = 0;
  for (let i = 0; i < 5; i++) {
    const point = even(step * center + phase), delta = Math.round((point / UNIT * height - center) / height * UNIT);
    phase -= delta;
    if (delta === 0) break;
  }
  return phase;
}

/** Three lower scanlines of the Linux border in raster coordinates. */
export function buttonBorderTail(height, top, position) {
  if (!Number.isInteger(height) || height < 7 || height > 4096) throw new Error('button-border-height');
  const lower = buttonBorderShade(top), step = Math.round(UNIT / height);
  const phase = position ? positionedPhase(height,step,position) : intrinsicPhase(height,step);
  const left = Math.round(F((height - 3) / height) * UNIT), lx = F(left / UNIT), width = F(1 / F(1 - lx));
  const base = (a,b) => F(F(F(a - F(b * lx)) * width) * INV255);
  const alpha = F(255 * base(255,255));
  const coefficients = top.map((c,i) => {
    const a = F(c * 257 * INV257), b = F(lower[i] * 257 * INV257);
    return { base:base(a,b), slope:F(F(F(b - a) * width) * INV255) };
  });
  return [height - 3,height - 2,height - 1].map(y => {
    const position = Math.floor(step * (y + .5) + phase + .5), t = F(position / UNIT);
    // One rounding for the multiply-add matches the native float32 sampler.
    return position <= left ? [...top] : coefficients.map(c => Math.trunc(F(F(alpha * F(c.slope * t + c.base)) + .5)));
  });
}

function coverage(x,y,width,height,mask) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const dx = Math.min(x,width - 1 - x), dy = Math.min(y,height - 1 - y);
  if (mask === INNER && (dx === 0 || dy === 0)) return 0;
  return dx < 3 && dy < 3 ? mask[dy][dx] : 255;
}

/** Raised text-button border, rounded corners and the one-pixel native shadow. */
export function buttonBorderPaint({height,background,outside,primary,position,stroke,inactive}) {
  if (!rgb(background) || !rgb(outside)) throw new Error('button-border-color');
  const top = stroke ?? (primary ? background.map(c => Math.floor(c * 170 / 255)) : [178,178,178]);
  const tail = inactive ? [top, top, top] : buttonBorderTail(height,top,position);
  const width = 7;
  const pixel = (x,y) => {
    const shadow = coverage(x,y - 1,width,height,OUTER), border = coverage(x,y,width,height,OUTER), fill = coverage(x,y,width,height,INNER);
    const edge = y < height - 3 ? top : tail[Math.min(2,y - height + 3)];
    return outside.map((c,i) => {
      // Keep alpha*coverage until compositing; quantizing either first changes colored parents.
      const behind = Math.round(c * (65025 - 45 * shadow) / 65025);
      const value = blend(behind,edge[i],border);
      return fill ? blend(value,buttonBackgroundShade(height - 2,Math.max(0,Math.min(height - 3,y - 1)),background[i]),fill) : value;
    });
  };
  const region = (right,bottom) => Array.from({length:bottom ? 12 : 9},(_,i) => pixel((right ? width - 3 : 0) + i % 3,(bottom ? height - 3 : 0) + Math.floor(i / 3)));
  return {top,tail,bottom:tail[2],shadow:outside.map(c => Math.round(c * 210 / 255)),corners:{topLeft:region(false,false),topRight:region(true,false),bottomLeft:region(false,true),bottomRight:region(true,true)}};
}
