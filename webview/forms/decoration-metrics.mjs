import { flag, fontLineHeight, fontPixels, number } from './model.mjs';
import { controlCaptionOptions, decorationCaptionProfile, fieldCaptionLines } from './font-metrics.mjs';

/** The reference Mono line covers both its fitted pixel box and logical point-size box. */
function monoLineMetrics(font) {
  const pixels = fontPixels(font);
  const ascent = Math.ceil(pixels * 1705 / 2048), descent = Math.ceil(pixels * 615 / 2048);
  const height = Math.max(ascent + descent, Math.ceil((font?.points ?? 10) * 4 / 3 * 2320 / 2048));
  // Hard separators reserve the union with the reference Noto Sans Mono fallback.
  const top = Math.max(0, Math.ceil(pixels * 1069 / 1000) - ascent);
  const bottom = Math.max(0, Math.ceil(pixels * 293 / 1000) - descent);
  return { height, breakHeight: height + top + bottom, breakTop: top };
}

/** Automatic width wraps at 400px, then reserves only the longest resulting line. */
export function labelDecorationProfile(node, text) {
  const font = node.presentation.font;
  const caption = decorationCaptionProfile(text, font);
  if (!caption) return;
  const authored = Math.max(0, number(node, 'Width')) * 10;
  const limit = authored || (flag(node, 'AutoMaxWidth') ? 400 : Infinity);
  const lines = fieldCaptionLines(caption, limit);
  const width = authored || Math.max(0, ...lines.map(line => decorationCaptionProfile(line, font).preferred));
  return { caption, font, width, minimum: authored || Math.min(width, caption.minimum),
    preferred: labelDecorationLines({ caption, font }, width) };
}

export function labelDecorationLines({ caption, font }, width) {
  width = Math.max(0, width);
  if (controlCaptionOptions(font).family === 'ESKA Taxi Mono') {
    const metrics = monoLineMetrics(font);
    const boxes = caption.paragraphs.flatMap((paragraph, index) => {
      const lines = fieldCaptionLines({ paragraphs: [paragraph] }, width);
      return lines.map((line, position) => {
        const closed = position === lines.length - 1
          && (index < caption.paragraphs.length - 1 || caption.terminalSeparator);
        return {
          text: paragraph.characters.every(char => char === ' ') ? paragraph.characters.join('') : line,
          height: closed ? metrics.breakHeight : metrics.height,
          top: closed ? metrics.breakTop : 0,
        };
      });
    });
    return { text: boxes.map(box => box.text).join('\n'), height: boxes.reduce((sum, box) => sum + box.height, 0),
      lineHeight: metrics.height, boxes };
  }
  const lines = fieldCaptionLines(caption, width), lineHeight = fontLineHeight(font);
  const content = caption.content.trim() ? lines.join('\n') : caption.content;
  return { text: content, height: Math.max(1, lines.length) * lineHeight, lineHeight };
}

/** Equal total heights can hide different hard-separator positions after a dirty edit. */
export function sameDecorationLines(previous, next) {
  return !!previous && previous.text === next.text && previous.height === next.height
    && previous.lineHeight === next.lineHeight && previous.boxes?.length === next.boxes?.length
    && (!next.boxes || next.boxes.every((box, index) => {
      const before = previous.boxes[index];
      return before.text === box.text && before.height === box.height && before.top === box.top;
    }));
}
