import { scrollbarFragment as fragment, scrollbarPaint } from './scrollbar-paint.mjs';

/** The disabled vertical arrow is shared with the other native scrollbars. */
export const tableScrollbarGrays = Object.freeze(scrollbarPaint.disabled.upArrow.flat());

/** Native disabled DynamicList pagination glyphs, ordered first/previous/next/last. */
export const tablePaginationGlyphs = Object.freeze([{"width":9,"height":6,"grays":[194,194,194,194,194,194,194,194,194,243,243,243,209,169,209,243,243,243,255,255,213,175,175,175,213,255,255,255,214,175,175,175,175,175,214,255,215,175,175,175,175,175,175,175,215,175,175,175,175,175,175,175,175,175]},{"width":9,"height":5,"grays":[255,255,255,219,177,219,255,255,255,255,255,213,175,175,175,213,255,255,255,214,175,175,175,175,175,214,255,215,175,175,175,175,175,175,175,215,175,175,175,175,175,175,175,175,175]},{"width":9,"height":5,"grays":[175,175,175,175,175,175,175,175,175,216,175,175,175,175,175,175,175,216,255,217,175,175,175,175,175,217,255,255,255,213,175,175,175,214,255,255,255,255,255,218,177,218,255,255,255]},{"width":9,"height":6,"grays":[175,175,175,175,175,175,175,175,175,216,175,175,175,175,175,175,175,216,255,217,175,175,175,175,175,217,255,255,255,213,175,175,175,214,255,255,243,243,243,208,169,208,243,243,243,194,194,194,194,194,194,194,194,194]}].map(glyph=>Object.freeze({...glyph,grays:Object.freeze(glyph.grays)})));


const horizontalInset = 23;
const minimumThumb = 8;
export const minimumHorizontalTableViewport = 2 * horizontalInset + minimumThumb;

export function horizontalScrollbarGeometry(viewport, grid, offset, railWidth = viewport) {
  const trackLength = Math.max(0, railWidth - 2 * horizontalInset);
  const maximum = Math.max(0, grid - viewport);
  const position = Math.min(maximum, Math.max(0, Math.round(offset)));
  const minimum = Math.min(trackLength, minimumThumb);
  const fixedThumb = trackLength * viewport < minimum * grid;
  const trackTravel = fixedThumb ? trackLength - minimum : trackLength;
  const scrollRange = (fixedThumb ? maximum : grid) || 1;
  const thumbStart = Math.floor(position * trackTravel / scrollRange);
  // Native rounds the two edges independently. A short thumb keeps its minimum length at either end.
  const thumbEnd = fixedThumb ? thumbStart + minimum : Math.floor((position + viewport) * trackLength / scrollRange);
  return { position, maximum, pixelsPerUnit: trackTravel / scrollRange, trackLeft: horizontalInset, trackRight: horizontalInset + trackLength,
    thumbLeft: horizontalInset + thumbStart, thumbRight: horizontalInset + Math.min(trackLength, thumbEnd) };
}

/** Step to the next right edge or the preceding left edge of a physical column. */
export function scrollTableByColumn(columns, viewport, position, direction) {
  const current = Math.round(position);
  let start = 0;
  for (const column of columns) {
    const end = start + column.width;
    if (direction < 0 ? end >= current : end > current + viewport) {
      return direction < 0 ? start : end - viewport;
    }
    start = end;
  }
  return direction < 0 ? 0 : Math.max(0, start - viewport);
}

const reverseRows = rows => rows.map(row => [...row].reverse());
const trackStart = [
  [255, 249, 227, 216], [249, 217, 214, 214], [227, 214, 214, 214], [216, 214, 214, 214],
  [216, 214, 214, 214], [227, 214, 214, 214], [249, 217, 214, 214], [255, 249, 227, 216],
];
const hoverRight = [
  [116, 246, 255, 255], [32, 70, 217, 255], [32, 32, 41, 171],
  [32, 32, 41, 171], [32, 70, 217, 255], [116, 246, 255, 255],
];

/** Native thumb caps differ on the white ends and over the gray track. */
export const tableHorizontalPaint = {
  trackStart: fragment(trackStart),
  trackEnd: fragment(scrollbarPaint.active.horizontalTrackEnd),
  left: {
    disabled: fragment(scrollbarPaint.disabled.leftArrow),
    active: fragment(reverseRows(scrollbarPaint.active.rightArrow)),
    hover: fragment(reverseRows(hoverRight)),
  },
  right: {
    disabled: fragment(scrollbarPaint.disabled.rightArrow),
    active: fragment(scrollbarPaint.active.rightArrow),
    hover: fragment(hoverRight),
  },
  active: {
    gray: 154,
    outerStart: fragment(scrollbarPaint.active.horizontalStart),
    innerStart: fragment([
      [214, 205, 173, 157], [205, 158, 154, 154], [173, 154, 154, 154], [157, 154, 154, 154],
      [157, 154, 154, 154], [173, 154, 154, 154], [205, 158, 154, 154], [214, 205, 173, 158],
    ]),
    innerEnd: fragment(scrollbarPaint.active.horizontalThumbEnd),
    outerEnd: fragment([
      [157, 177, 235, 255], [154, 154, 158, 234], [154, 154, 154, 178], [154, 154, 154, 157],
      [154, 154, 154, 157], [154, 154, 154, 178], [154, 154, 158, 235], [158, 177, 235, 255],
    ]),
  },
  hover: {
    gray: 117,
    outerStart: fragment([
      [255, 228, 152, 122], [228, 123, 117, 117], [152, 117, 117, 117], [122, 117, 117, 117],
      [122, 117, 117, 117], [152, 117, 117, 117], [229, 123, 117, 117], [255, 230, 152, 123],
    ]),
    innerStart: fragment([
      [214, 199, 148, 122], [199, 123, 117, 117], [148, 117, 117, 117], [122, 117, 117, 117],
      [122, 117, 117, 117], [148, 117, 117, 117], [199, 123, 117, 117], [214, 200, 148, 123],
    ]),
    innerEnd: fragment([
      [122, 148, 200, 214], [117, 117, 123, 199], [117, 117, 117, 149], [117, 117, 117, 122],
      [117, 117, 117, 122], [117, 117, 117, 149], [117, 117, 123, 200], [123, 148, 200, 214],
    ]),
    outerEnd: fragment([
      [122, 152, 229, 255], [117, 117, 123, 229], [117, 117, 117, 153], [117, 117, 117, 122],
      [117, 117, 117, 122], [117, 117, 117, 153], [117, 117, 123, 229], [123, 152, 230, 255],
    ]),
  },
  disabled: {
    gray: 194,
    outerStart: fragment(scrollbarPaint.disabled.horizontalStart),
    innerStart: fragment(reverseRows(scrollbarPaint.disabled.horizontalThumbEnd)),
    innerEnd: fragment(scrollbarPaint.disabled.horizontalThumbEnd),
    outerEnd: fragment(reverseRows(scrollbarPaint.disabled.horizontalStart)),
  },
};
