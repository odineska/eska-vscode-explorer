import * as vscode from "vscode";
import { dirname } from "node:path";
import { findTool } from "./tooling/inspect.js";
import { runtimeJson } from "./runtime-tools.js";
import { isRecord } from "./protocol.js";
import { message, type MessageKey } from "./messages.js";

export interface ComparisonProject { root: string; name: string; executable: string; validate(): void }
export interface CommitChoice { id: string; subject: string; date: string }
const kinds = ["object_added", "object_removed", "object_changed", "module_changed", "method_added", "method_removed", "method_changed", "function_added", "function_removed", "function_changed", "form_changed", "metadata_attribute_changed"] as const;
export type SemanticKind = typeof kinds[number];
export interface SemanticRow { kind: SemanticKind; object: string; member: string; path: string }
export interface SemanticResult { rows: SemanticRow[]; fallbacks: { reason: string; path: string }[] }
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);

export function comparisonHistory(value: unknown): CommitChoice[] {
  if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.commits)) throw new Error("history-contract");
  const seen = new Set<string>();
  return value.commits.map(item => {
    if (!isRecord(item) || !hash(item.id) || seen.has(item.id) || typeof item.subject !== "string" || typeof item.authored_at !== "string"
      || !["utf-8", "base64"].includes(String(item.subject_encoding))) throw new Error("history-contract");
    seen.add(item.id);
    return { id: item.id, subject: item.subject_encoding === "base64" ? `[base64] ${item.subject}` : item.subject, date: item.authored_at };
  });
}

export function semanticComparison(value: unknown, from: string, to: string): SemanticResult {
  if (!isRecord(value) || value.schema_version !== 4 || value.kind !== "semantic" || !Array.isArray(value.events)
    || !isRecord(value.comparison) || value.comparison.kind !== "revisions" || !isRecord(value.comparison.from)
    || !isRecord(value.comparison.to) || value.comparison.from.commit !== from || value.comparison.to.commit !== to
    || !isRecord(value.analysis) || typeof value.analysis.complete !== "boolean" || !Array.isArray(value.analysis.fallbacks)) throw new Error("semantic-contract");
  const rows = value.events.map(item => {
    if (!isRecord(item) || !kinds.includes(item.kind as SemanticKind) || !isRecord(item.object) || typeof item.object.id !== "string"
      || !(item.member === null || typeof item.member === "string") || typeof item.path !== "string"
      || !["utf-8", "base64"].includes(String(item.path_encoding))) throw new Error("semantic-contract");
    return { kind: item.kind as SemanticKind, object: item.object.id, member: item.member ?? "", path: item.path_encoding === "base64" ? `[base64] ${item.path}` : item.path };
  });
  const fallbacks = value.analysis.fallbacks.map(item => {
    if (!isRecord(item) || typeof item.reason !== "string" || typeof item.path !== "string"
      || !["utf-8", "base64"].includes(String(item.path_encoding))) throw new Error("semantic-contract");
    return { reason: item.reason, path: item.path_encoding === "base64" ? `[base64] ${item.path}` : item.path };
  });
  if (value.analysis.complete !== (fallbacks.length === 0)) throw new Error("semantic-contract");
  return { rows, fallbacks };
}

export const escapeComparisonHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Only immutable full commit IDs from this project's history reach the read-only VCS component. */
export async function compareRevisions(projects: ComparisonProject[]): Promise<void> {
  const text = (key: MessageKey, ...args: string[]) => message(vscode.env.language, key, ...args);
  if (!vscode.workspace.isTrusted) throw new Error(text("scmUntrusted"));
  if (!projects.length) throw new Error(text("scmCompareNoProject"));
  const project = projects.length === 1 ? projects[0] : (await vscode.window.showQuickPick(projects.map(project => ({ label: project.name, description: project.root, project })), { title: text("scmCompareProject") }))?.project;
  if (!project) return;
  project.validate();
  const executable = await findTool("eska-vcs", "eska-vcs", dirname(project.executable));
  if (!executable) throw new Error(text("scmCompareMissing"));
  const args = ["--project-dir", project.root, "--lang", vscode.env.language.startsWith("ru") ? "ru-RU" : "en-US"];
  let commits: CommitChoice[];
  try { commits = comparisonHistory(await runtimeJson(executable, [...args, "history", "--format", "json", "--limit", "1000"], { timeout: 30_000 })); }
  catch { throw new Error(text("scmCompareFailed")); }
  if (commits.length < 2) throw new Error(text("scmCompareHistory"));
  const pick = (items: CommitChoice[], key: MessageKey) => vscode.window.showQuickPick(items.map(commit => ({ label: commit.subject, description: commit.id.slice(0, 12), detail: commit.date, commit })), { title: text(key), matchOnDescription: true, matchOnDetail: true });
  const from = (await pick(commits, "scmCompareFrom"))?.commit;
  if (!from) return;
  const to = (await pick(commits.filter(commit => commit.id !== from.id), "scmCompareTo"))?.commit;
  if (!to) return;
  project.validate();
  let result: SemanticResult;
  try { result = semanticComparison(await runtimeJson(executable, [...args, "diff", from.id, to.id, "--semantic", "--format", "json"], { timeout: 120_000 }), from.id, to.id); }
  catch { throw new Error(text("scmCompareFailed")); }
  project.validate();
  const html = escapeComparisonHtml;
  const panel = vscode.window.createWebviewPanel("eska.semanticComparison", text("scmCompareRevisions"), vscode.ViewColumn.Active, { enableScripts: false, localResourceRoots: [] });
  const cells = (values: string[]) => values.map(value => `<td>${html(value)}</td>`).join("");
  const columns = ["scmCompareChange", "scmCompareObject", "scmCompareMember", "scmComparePath"] as const;
  const header = columns.map(key => `<th scope="col">${html(text(key))}</th>`).join("");
  const rows = result.rows.map(row => `<tr>${cells([text(`scmCompare_${row.kind}`), row.object, row.member, row.path])}</tr>`).join("");
  const table = rows ? `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
    : `<p>${html(text(result.fallbacks.length ? "scmCompareNoReliable" : "scmCompareEmpty"))}</p>`;
  const reasons = new Map<string, MessageKey>([
    ["descriptor-parse", "scmCompareDescriptorParse"], ["routine-parse", "scmCompareRoutineParse"],
    ["owner-inferred", "scmCompareOwnerInferred"], ["owner-unresolved", "scmCompareOwnerUnresolved"],
  ]);
  const files = result.fallbacks.map(item => `<li>${html(item.path)} — ${html(text(reasons.get(item.reason) ?? "scmCompareFallback"))}</li>`).join("");
  panel.webview.html = `<!doctype html><html lang="${vscode.env.language.startsWith("ru") ? "ru" : "en"}">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>
    body{font-family:var(--vscode-font-family);padding:20px}
    table{border-collapse:collapse;width:100%}
    td,th{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}
    p{overflow-wrap:anywhere}
    </style></head><body><main id="root"><article class="semantic-comparison">
      <h1>${html(text("scmCompareRevisions"))}</h1>
      <p>${html(project.name)} · ${html(project.root)}</p>
      <p>${html(from.id)} → ${html(to.id)}</p>
      <p>${html(from.subject)} → ${html(to.subject)}</p>
      ${table}
      ${files ? `<h2>${html(text("scmCompareIncomplete"))}</h2><ul>${files}</ul>` : ""}
    </article></main></body></html>`;
}
