import metrics from '../../resources/forms/fonts/advances.json' with { type: 'json' };
import { font, fontLineMetrics } from './model.mjs';

export function firstFontFamily(families) {
  return families.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}

export function supportsNativeSans(family, font) {
  return family === 'ESKA Taxi Sans' && !font?.italic && !font?.underline && !font?.strikeout;
}

export function linuxControlFont(value) {
  return { ...font(value, 'linux'), 'font-size': `${fontLineMetrics(value).pixels}px` };
}

export function controlCaptionOptions(value) {
  const style = linuxControlFont(value);
  return {
    family: /^"([^"]+)",/.exec(style['font-family'])?.[1],
    pixels: parseFloat(style['font-size']),
    weight: style['font-weight'],
    italic: style['font-style'] === 'italic',
  };
}

export function controlCaptionWidth(text, value) {
  return hintedTextWidth(text, controlCaptionOptions(value));
}

function selectFace({ family, pixels, weight, italic }) {
  const name = family === 'ESKA Taxi Sans' ? 'Sans' : family === 'ESKA Taxi Serif' ? 'Serif' : family === 'ESKA Taxi Mono' ? 'Mono' : undefined;
  if (!name || !Number.isInteger(pixels) || pixels < metrics.minPixels || pixels > metrics.maxPixels) return;
  const style = `${Number(weight) > 500 ? 'Bold' : ''}${italic ? 'Italic' : ''}` || 'Regular';
  return metrics.faces[`Liberation${name}-${style}.ttf`];
}

/** Hinted advances and rounded unattenuated kerning of the bundled Linux fonts. */
export function hintedTextWidth(text, options) {
  const face = selectFace(options), { pixels } = options;
  if (!face) return;
  let width = 0, previous = '';
  for (const char of text) {
    const index = face.characters[char];
    // A fallback font or contextual shaping needs the browser's measurement.
    if (index === undefined || /[\p{Mark}\p{Format}]/u.test(char)) return;
    const [units, differences] = face.classes[index];
    const pair = face.kerningPairs[previous + char];
    if (previous && pair !== undefined) {
      const [units, differences] = face.kerningClasses[pair];
      width += Math.round(units * pixels / face.units) + (differences[pixels] ?? 0);
    }
    width += Math.round(units * pixels / face.units) + (differences[pixels] ?? 0);
    previous = char;
  }
  return width;
}

/** Native form-title layout rounds the design advance and following pair together. */
export function designTextAdvances(text, options) {
  const face = selectFace(options), { pixels } = options;
  if (!face) return;
  const characters = [...text], output = [];
  for (const [position, char] of characters.entries()) {
    const index = face.characters[char];
    if (index === undefined || /[\p{Mark}\p{Format}]/u.test(char)) return;
    const units = face.classes[index][0], pair = face.kerningPairs[char + (characters[position + 1] ?? '')];
    const adjustment = pair === undefined ? 0 : face.kerningClasses[pair][0];
    output.push(Math.round((units + adjustment) * pixels / face.units));
  }
  return output;
}

export function designCaptionWidth(text, font) {
  return designTextAdvances(text, controlCaptionOptions(font))?.reduce((sum, width) => sum + width, 0);
}

function captionParagraph(text, options, advancesFor) {
  const characters = [...text];
  const advances = advancesFor(text, options);
  if (!advances) return;
  const edges = [0];
  for (const advance of advances) edges.push(edges.at(-1) + advance);
  const preferred = edges.at(-1);
  let minimum = 0, compact = preferred, word = 0;
  for (let index = 0; index < characters.length; index++) {
    if (characters[index] !== ' ') continue;
    minimum = Math.max(minimum, edges[index] - edges[word]);
    compact = Math.min(compact, Math.max(edges[index], preferred - edges[index + 1]));
    word = index + 1;
  }
  minimum = Math.max(minimum, preferred - edges[word]);
  return { characters, edges, minimum, compact, preferred };
}

function captionProfile(text, font, advancesFor) {
  const options = controlCaptionOptions(font);
  const paragraphs = text.split(/\r\n?|\n/u).map(line => captionParagraph(line, options, advancesFor));
  if (paragraphs.some(paragraph => !paragraph)) return;
  const width = kind => paragraphs.reduce((size, paragraph) => Math.max(size, paragraph[kind]), 0);
  return { paragraphs, minimum: width('minimum'), compact: width('compact'), preferred: width('preferred') };
}

/** The minimum keeps each word intact. The compact width fits a paragraph on two lines. */
export function fieldCaptionProfile(text, font) {
  return captionProfile(text, font, designTextAdvances);
}

/** Designer shapes words independently, without kerning across whitespace. */
export function wordTextAdvances(text, options) {
  const runs = text.split(/(\s+)/u).map(run => hintedPairTextAdvances(run, options));
  if (runs.some(run => !run)) return;
  return runs.flat();
}

export function wordCaptionWidth(text, font) {
  return wordTextAdvances(text, controlCaptionOptions(font))?.reduce((sum, width) => sum + width, 0);
}

/** Breakable text closes its terminal separator; unbroken text keeps the final line. */
export function decorationCaptionProfile(text, font) {
  const terminalSeparator = /(?:\r\n?|\n)$/u.test(text);
  const content = text.includes(' ') ? text.replace(/(?:\r\n?|\n)$/u, '') : text;
  const profile = captionProfile(content, font, wordTextAdvances);
  return profile && { ...profile, content, terminalSeparator };
}

/** A parenthesized suffix keeps the break space in its width but starts at the left edge. */
function wrapFieldCaption(profile, width, format) {
  return profile.paragraphs.flatMap(({characters, edges}) => {
    if (!characters.length) return [format('', 0)];
    const lines = [];
    let start = 0;
    while (start < characters.length) {
      while (characters[start] === ' ' && characters[start + 1] !== '(') start++;
      if (start >= characters.length) break;
      let end = start, boundary = start;
      while (end < characters.length && (end === start || edges[end + 1] - edges[start] <= width)) {
        if (characters[end] === ' ' && end > start + Number(characters[start] === ' ')) boundary = end;
        end++;
      }
      if (end < characters.length && characters[end] !== ' ' && boundary > start) end = boundary;
      const line = characters.slice(start, end).join('').trim();
      if (line) lines.push(format(line, edges[end] - edges[start]));
      start = end;
    }
    return lines.length ? lines : [format('', 0)];
  });
}

export function fieldCaptionLines(profile, width) {
  return wrapFieldCaption(profile, width, text => text);
}

export function fieldCaptionOccupiedWidth(profile, width) {
  if (width >= profile.preferred) return profile.preferred;
  return Math.max(0, ...wrapFieldCaption(profile, width, (_, span) => span));
}

/** Keep kerning inside each native caption fragment, never across fragment boundaries. */
export function segmentedTextAdvances(segments, options) {
  const result=[];
  for (const segment of segments) {
    const chars=[...segment];
    for (let index=0;index<chars.length;index++) {
      const next=chars[index+1]??'',pair=hintedTextWidth(chars[index]+next,options),following=next?hintedTextWidth(next,options):0;
      if (pair===undefined||following===undefined) return;
      result.push(pair-following);
    }
  }
  return result;
}

/** Hinted single advances; round the design advance together with a following pair. */
export function hintedPairTextAdvances(text,options){
 const face=selectFace(options);if(!face)return;const chars=[...text],output=[];
 for(const [index,char]of chars.entries()){
  const glyph=face.characters[char];if(glyph===undefined||/[\p{Mark}\p{Format}]/u.test(char))return;
  const pair=face.kerningPairs[char+(chars[index+1]??'')];
  output.push(pair===undefined?hintedTextWidth(char,options):Math.round((face.classes[glyph][0]+face.kerningClasses[pair][0])*options.pixels/face.units));
 }
 return output;
}
