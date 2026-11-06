import { isRecord } from "../protocol.js";

export interface PreviewNavigation {
  pages: Record<string, string>;
  collapsed: Record<string, boolean>;
}

/** Validate the persisted and live navigation shared by both form windows. */
export function parsePreviewNavigation(value: unknown): PreviewNavigation | undefined {
  if (!isRecord(value) || !isRecord(value.pages) || !isRecord(value.collapsed)
    || !Object.entries(value.pages).every(([key, page]) => key.includes(":") && typeof page === "string" && page.includes(":"))
    || !Object.entries(value.collapsed).every(([key, collapsed]) => key.includes(":") && typeof collapsed === "boolean")) return;
  return { pages: { ...value.pages } as Record<string, string>, collapsed: { ...value.collapsed } as Record<string, boolean> };
}
