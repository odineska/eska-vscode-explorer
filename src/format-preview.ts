import * as vscode from "vscode";
import { isAbsolute } from "node:path";
import { FormattingBackend } from "./formatting/backend.js";
import { formatEdits, withFormatText } from "./formatting/protocol.js";
import { ExplorerError, isRecord } from "./protocol.js";

interface Request { type: "format-preview"; id: string; revision: string | null; edits: unknown[]; source?: string }
export interface FormatPreviewHost { formatter(root: string, signal: AbortSignal): Promise<string | undefined> }

export function formatPreviewRequest(value: unknown): Request | undefined {
  if (!isRecord(value) || value.type !== "format-preview" || typeof value.id !== "string"
    || !/^[0-9a-f-]{36}$/.test(value.id) || !Array.isArray(value.edits)
    || value.revision !== null && (typeof value.revision !== "string" || !/^[0-9a-f]{64}$/.test(value.revision))
    || value.source !== undefined && (typeof value.source !== "string" || !isAbsolute(value.source))) return;
  return { type: "format-preview", id: value.id, revision: value.revision, edits: value.edits,
    ...(typeof value.source === "string" ? { source: value.source } : {}) };
}

/** Native buffers and their dirty text stay read-only; Rust resolves the complete draft policy. */
export async function handleFormatPreview(request: Request, root: string, executable: string, language: string,
  version: string, host: FormatPreviewHost, signal: AbortSignal): Promise<unknown> {
  const reply = { type: request.type, id: request.id };
  const backend = new FormattingBackend(version, () => {});
  try {
    const picked = request.source ? vscode.Uri.file(request.source) : (await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(root), canSelectMany: false, canSelectFiles: true, canSelectFolders: false,
      filters: { BSL: ["bsl"] },
      title: language.startsWith("ru") ? "Выберите BSL-модуль для примера" : "Choose a BSL module for the example",
    }))?.[0];
    if (!picked || signal.aborted) return { ...reply, cancelled: true };
    const document = await vscode.workspace.openTextDocument(picked);
    const before = document.getText(), documentVersion = document.version;
    const formatter = await host.formatter(root, signal);
    if (!formatter || signal.aborted) return { ...reply, cancelled: true };
    const endpoint = await backend.endpoint(executable, root, language.startsWith("ru") ? "ru-RU" : "en-US");
    if (!endpoint.limits.settingsPreview) throw new ExplorerError("incompatible");
    const result = await withFormatText(endpoint, before, input => endpoint.request("format/settingsPreview", {
      ...input, version: String(documentVersion), userReadOnly: false,
      source: { encoding: "utf-8", value: picked.fsPath }, settingsRoot: { encoding: "utf-8", value: root },
      revision: request.revision, edits: request.edits, formatter: { encoding: "utf-8", value: formatter },
    }, signal), signal);
    if (signal.aborted) return;
    if (document.version !== documentVersion) return { ...reply, error: { code: "source_conflict" } };
    let after = before;
    for (const edit of formatEdits(result, before, documentVersion).reverse()) after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
    return { ...reply, source: picked.fsPath, before, after };
  } catch (error) {
    const code = error instanceof ExplorerError ? typeof error.details?.code === "string" ? error.details.code : error.code : "unavailable";
    return { ...reply, error: { code } };
  } finally { await backend.shutdown(); }
}
