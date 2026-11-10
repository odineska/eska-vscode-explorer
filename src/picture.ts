import { isRecord } from "./protocol.js";

export type PicturePreview = { status: "ready"; mimeType: string; data: string; fileName: string; isTemplate?: true; glyph?: { width: number; height: number } }
  | { status: "missing" | "unsupported" | "invalid" | "too_large" | "unavailable" };

const mimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp", "image/x-icon", "image/webp", "image/svg+xml"]);
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_PICTURE_BYTES / 3) * 4;

/** Equal base64 lengths can represent different byte counts because of padding. */
function boundedImageData(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length > MAX_ENCODED_LENGTH
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding <= MAX_PICTURE_BYTES;
}

/** Atlas frames must have bounded positive pixel dimensions. */
function glyph(value: unknown): value is { width: number; height: number } {
  return isRecord(value) && [value.width, value.height].every(size => typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size <= 16_384);
}

/** Only bounded image data may cross into an img element; older backends omit this field. */
export function picturePreview(value: unknown): PicturePreview | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return { status: "invalid" };
  if (value.status === "ready") {
    if (typeof value.mimeType !== "string" || !mimeTypes.has(value.mimeType)
      || !boundedImageData(value.data)
      || typeof value.fileName !== "string"
      || (value.isTemplate !== undefined && value.isTemplate !== true)
      || (value.glyph !== undefined && !glyph(value.glyph))) return { status: "invalid" };
    return { status: "ready", mimeType: value.mimeType, data: value.data, fileName: value.fileName,
      ...(value.isTemplate ? { isTemplate: true } : {}), ...(glyph(value.glyph) ? { glyph: value.glyph } : {}) };
  }
  switch (value.status) {
    case "missing": case "unsupported": case "invalid": case "too_large": case "unavailable":
      return { status: value.status };
    default: return { status: "invalid" };
  }
}
