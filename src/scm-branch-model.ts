import { isRecord } from "./protocol.js";
export type BranchKind = "head" | "local" | "remote" | "tag" | "commit";
export interface BranchRef { name: string; kind: BranchKind }
export interface BranchAction { target: BranchRef; branch?: string; detached?: boolean }
export function parseBranchRefs(data: Record<string, unknown>): BranchRef[] {
  if (!Array.isArray(data.refs)) throw new Error("Invalid SCM refs");
  return data.refs.map(ref => {
    if (!isRecord(ref) || typeof ref.name !== "string" || !ref.name || /[\x00-\x20\x7f]/.test(ref.name)
      || !["local", "remote", "tag"].includes(String(ref.kind))) throw new Error("Invalid SCM ref");
    return { name: ref.name, kind: ref.kind as BranchKind };
  });
}
/** Keep the transformation identical to VS Code's Git extension. */
export function sanitizeBranchName(name: string, whitespace: string): string {
  return name ? name.trim().replace(/^-+/, "").replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g, whitespace) : name;
}
