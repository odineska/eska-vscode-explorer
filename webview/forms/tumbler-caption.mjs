import { controlCaptionOptions, hintedPairTextAdvances } from './font-metrics.mjs';
import { paintLcdGlyphs } from './lcd-caption.mjs';
import { fontLineMetrics } from './model.mjs';

function lineAdvances(text, options) {
  const advances = [];
  // Taxi shapes the words independently and uses the space's own advance.
  for (const part of text.match(/\S+|\s+/gu) ?? []) {
    const run = hintedPairTextAdvances(part, options);
    if (!run) return;
    advances.push(...run);
  }
  return advances;
}

export function tumblerCaptionWidth(text, options) {
  return lineAdvances(text, options)?.reduce((sum, advance) => sum + advance, 0);
}

function fitPrefix(text, limit, measure, suffix = '') {
  let end = 0;
  for (const char of text) {
    const next = end + char.length;
    if (end && measure(text.slice(0, next) + suffix) > limit) break;
    end = next;
  }
  return text.slice(0, end);
}

function wrap(text, limit, rows, measure) {
  if (!text || limit <= 0) return [''];
  if (!/\s/u.test(text)) rows = 1;
  const lines = [];
  let continued = false;
  while (text && lines.length < rows) {
    if (measure(text) <= limit) {
      lines.push(text);
      break;
    }
    const fitting = fitPrefix(text, limit, measure);
    const boundary = /^\s/u.test(text.slice(fitting.length)) ? fitting.length
      : ([...fitting.matchAll(/\S(?=\s)/gu)].at(-1)?.index ?? -1) + 1;
    if (lines.length + 1 === rows && (rows === 1 || continued || !boundary)) {
      lines.push(fitPrefix(text, limit, measure, '…') + '…');
      break;
    }
    const consumed = boundary || fitting.length;
    lines.push(text.slice(0, consumed).trimEnd());
    continued = !boundary;
    text = text.slice(consumed).trimStart();
  }
  return lines;
}

export function tumblerCaptionLayout(paragraphs, { width, first, side }, font, titleRows) {
  const options = controlCaptionOptions(font);
  const measure = text => tumblerCaptionWidth(text, options);
  if (measure('…') === undefined || paragraphs.some(parts => parts.length > 4096
      || parts.some(text => text.length > 4096 || measure(text) === undefined))) return;
  const padding = Math.max(0, side - 2);
  const bounds = [[1, first - 1], [first, width - 1]];
  return paragraphs.map((parts, index) => {
    const [left, right] = bounds[index];
    const limit = right - left - 2 * padding;
    const rows = Math.max(titleRows, parts.length);
    const lines = [];
    for (const [part, text] of parts.entries()) {
      // Keep a line for each subsequent explicit break.
      lines.push(...wrap(text, limit, rows - lines.length - (parts.length - part - 1), measure));
    }
    return { left, right, limit, padding, lines, explicitBreaks: parts.length > 1 };
  });
}

export function inactiveTumblerTextColor(foreground, fill) {
  const high = Math.max(...foreground), range = high - Math.min(...foreground);
  // Taxi mixes HSV saturation and value with the face after lowering its RGB levels.
  const fillHigh = Math.max(0, Math.max(...fill) - 76);
  const fillLow = Math.max(0, Math.min(...fill) - 76);
  const value = (high + fillHigh) / 2;
  const saturation = ((high ? range / high : 0) + (fillHigh ? (fillHigh - fillLow) / fillHigh : 0)) / 2;
  return foreground.map(channel => Math.round(range ? value * (1 - saturation * (high - channel) / range) : value));
}

export function paintTumblerCaptions(image, captions, font, face, foreground) {
  const { pixels, ascent, descent } = fontLineMetrics(font);
  const lineHeight = ascent + descent, options = controlCaptionOptions(font);
  const rasterOf = text => face.raster(text, pixels, ascent, descent, 'lcd', lineAdvances(text, options));
  for (const { left, right, limit, padding, lines, explicitBreaks } of captions) {
    const baseline = Math.max(ascent, Math.floor((image.height + ascent - descent - (lines.length - 1) * lineHeight) / 2));
    const center = advance => Math.floor((left + right - advance) / 2);
    const runs = lines.flatMap((text, index) => {
      if (!text) return [];
      const raster = rasterOf(text);
      return [{ text, raster, y: baseline + index * lineHeight }];
    });
    if (!runs.length) continue;
    const longest = Math.max(...runs.map(({ raster }) => raster.advance));
    const blockLeft = center(longest), blockRight = blockLeft + longest;
    // Explicit line breaks center each line inside the measured paragraph block.
    for (const run of runs) {
      run.x = explicitBreaks ? blockLeft + Math.floor((longest - run.raster.advance) / 2) : center(run.raster.advance);
    }
    const overhang = runs.some(({ raster, x }) => x + raster.inkRight > blockRight);
    const inkLeft = Math.min(...runs.map(({ raster, x }) => x + raster.inkLeft));
    for (const { text, raster, x, y } of runs) {
      const clipped = raster.advance > limit;
      const clippedHeight = y + descent > image.height;
      const clipLeft = Math.max(left + (clipped ? padding : 0), overhang ? Math.max(blockLeft, inkLeft) : left,
        clippedHeight ? x + Math.max(0, raster.inkLeft) : left);
      const clipRight = Math.min(right - (clipped ? padding : 0), overhang ? blockRight : right,
        clippedHeight ? x + Math.min(raster.advance, raster.inkRight) : right);
      const clip = [clipLeft, 0, clipRight, image.height];
      if (clipped && text.endsWith('…') && raster.glyphs.length > 1) {
        // A clipped prefix uses its ink edge. The ellipsis has a separate mask.
        const headRight = x + rasterOf(text.slice(0, -1)).inkRight;
        paintLcdGlyphs(image, raster.glyphs.slice(0, -1), foreground, x, y,
          [clipLeft, 0, Math.min(clipRight, headRight), image.height]);
        paintLcdGlyphs(image, raster.glyphs.slice(-1), foreground, x, y, clip);
      } else {
        paintLcdGlyphs(image, raster.glyphs, foreground, x, y, clip);
      }
    }
  }
}
