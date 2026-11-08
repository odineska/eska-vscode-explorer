import { flag, fontLineHeight, number } from './model.mjs';
import { decorationCaptionProfile, fieldCaptionLines } from './font-metrics.mjs';

/** Automatic width wraps at 400px, then reserves only the longest resulting line. */
export function labelDecorationProfile(node, text) {
  const font = node.presentation.font;
  const caption = decorationCaptionProfile(text, font);
  if (!caption) return;
  const authored = Math.max(0, number(node, 'Width')) * 10;
  const limit = authored || (flag(node, 'AutoMaxWidth') ? 400 : Infinity);
  const lines = fieldCaptionLines(caption, limit);
  const width = authored || Math.max(0, ...lines.map(line => decorationCaptionProfile(line, font).preferred));
  return { caption, font, text, width, minimum: authored || Math.min(width, caption.minimum),
    preferred: labelDecorationLines({ caption, font, text }, width) };
}

export function labelDecorationLines({ caption, font, text }, width) {
  const lines = fieldCaptionLines(caption, Math.max(0, width));
  const lineHeight = fontLineHeight(font);
  return { text: text.trim() ? lines.join('\n') : text.replace(/(?:\r\n?|\n)$/u, ''),
    height: Math.max(1, lines.length) * lineHeight, lineHeight };
}
