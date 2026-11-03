import { ExplorerError } from "../protocol.js";
import { editorRange } from "../source.js";

/** VS Code normalizes physical line endings on open; retain the backend's exact byte snapshot check. */
export function formEditorRange(bytes: Buffer, start: number, end: number, text: string, eol: "\n" | "\r\n"): { start: number; end: number } {
  const source = editorRange(bytes, start, end);
  if (source.text === text) return { start: source.start, end: source.end };
  const normalize = (value: string): string => value.replace(/\r\n|\r|\n/g, eol);
  const betweenCrLf = (offset: number): boolean => source.text[offset - 1] === "\r" && source.text[offset] === "\n";
  if (normalize(source.text) !== text || betweenCrLf(source.start) || betweenCrLf(source.end)) throw new ExplorerError("sourceChanged");
  return { start: normalize(source.text.slice(0, source.start)).length, end: normalize(source.text.slice(0, source.end)).length };
}
