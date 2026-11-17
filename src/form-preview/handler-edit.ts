import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { Connection } from "../connection.js";
import type { MetadataTree, TreeEntry } from "../tree.js";
import { ExplorerError, isRecord, type WirePath } from "../protocol.js";
import { configuredReadOnlyResource } from "../editor-policy.js";
import { existingSource, hasDirtySource, nativePath, sourceKey } from "../source.js";
import { SourceAccess } from "../source-access.js";
import { objectPlan, type ObjectRequest } from "../metadata-object-protocol.js";
import { verifyObjectSources } from "../metadata-object-review.js";
import { relativeFile } from "../reveal.js";
import { querySnapshot } from "../query/text-transfer.js";
import { formEditorRange } from "./source.js";
import type { HandlerEditSource, HandlerEditPlan } from "./handler-protocol.js";

type Context = { connection: Connection; tree: MetadataTree; entry: TreeEntry; formPath: string; formSnapshot: string; current: () => void };

async function checkedForm(context: Context, root: WirePath): Promise<WirePath> {
  context.current();
  const relative = relativeFile(nativePath(root), context.formPath), uri = vscode.Uri.file(context.formPath);
  if (relative === undefined || querySnapshot((await readFile(context.formPath)).toString("utf8")) !== context.formSnapshot) throw new ExplorerError("sourceChanged");
  if (await hasDirtySource([context.formPath], vscode.workspace.textDocuments)) throw new ExplorerError("requestFailed", "creation_dirty_source");
  if (configuredReadOnlyResource(uri, "xml")) throw new ExplorerError("requestFailed", "property_read_only");
  context.current();
  return { value: relative, encoding: "utf-8" };
}
async function checkProtection(context: Context, paths: WirePath[]): Promise<void> {
  const endpoint = context.connection.sources;
  if (!endpoint) throw new ExplorerError("incompatible");
  const { tree, entry } = context;
  const access = new SourceAccess(endpoint, () => ({ sessionId: tree.session.sessionId, projectId: entry.project.info.projectId, generation: entry.project.info.generation }));
  const protection = await access.protection(paths.map(path => ({ path, userReadOnly: false })), true);
  if (protection.some(source => !source.writable)) throw new ExplorerError("requestFailed", "property_read_only");
  context.current();
}

/** The same fixed-role metadata operation creates missing modules; no generic filesystem write. */
export async function createHandlerModule(context: Context, source: HandlerEditSource): Promise<void> {
  context.current();
  const { tree, entry } = context;
  if (entry.node.id.kind !== "object" || sourceKey(nativePath(source.root)) !== sourceKey(nativePath(entry.project.info.sourcePath))) throw new ExplorerError("requestFailed", "property_read_only");
  const formPath = await checkedForm(context, source.root);
  await checkProtection(context, [formPath]);
  const request: ObjectRequest = { operation: "create-module", owner: entry.node.id.objectId, role: "module" };
  const plan = objectPlan(await tree.request(entry.project, "metadata/previewObject", { request }));
  context.current();
  if (!isDeepStrictEqual(plan.prepared.request, request) || plan.files.length !== 1 || plan.files[0]?.action !== "create"
    || nativePath(plan.files[0].path) !== nativePath(source.path)) throw new ExplorerError("protocolInvalid");
  await verifyObjectSources(vscode, source.root, plan, uri => configuredReadOnlyResource(uri, "bsl"), context.current);
  await checkedForm(context, source.root);
  context.current();
  const result = await tree.request(entry.project, "metadata/applyObject", { prepared: plan.prepared });
  if (!isRecord(result) || result.schemaVersion !== 1 || result.changed !== true || result.objectId !== plan.objectId
    || result.snapshot !== plan.prepared.expectedOutputSnapshot) throw new ExplorerError("protocolInvalid");
}

/** Only the generated insertion is edited, retaining VS Code undo and encoding handling. */
export async function applyHandlerPlan(context: Context, document: vscode.TextDocument, plan: HandlerEditPlan): Promise<boolean> {
  const change = plan.change;
  if (!change) return false;
  const { entry } = context;
  const path = await existingSource(plan.root, plan.path);
  if (document.uri.scheme !== "file" || sourceKey(document.uri.fsPath) !== sourceKey(path)
    || sourceKey(nativePath(plan.root)) !== sourceKey(nativePath(entry.project.info.sourcePath))) throw new ExplorerError("requestFailed", "property_read_only");
  const formPath = relativeFile(nativePath(plan.root), context.formPath);
  if (formPath === undefined) throw new ExplorerError("sourceChanged");
  const formUri = vscode.Uri.file(context.formPath);
  const text = document.getText(), version = document.version, disk = await readFile(path);
  const check = async (): Promise<void> => {
    context.current();
    if (document.isDirty || await hasDirtySource([path, context.formPath], vscode.workspace.textDocuments)) throw new ExplorerError("requestFailed", "creation_dirty_source");
    if (document.version !== version || document.getText() !== text || querySnapshot(text) !== plan.snapshot || String(version) !== plan.version
      || !disk.equals(await readFile(path)) || querySnapshot((await readFile(context.formPath)).toString("utf8")) !== context.formSnapshot) throw new ExplorerError("sourceChanged");
    if (configuredReadOnlyResource(document.uri, "bsl") || configuredReadOnlyResource(formUri, "xml")) throw new ExplorerError("requestFailed", "property_read_only");
    context.current();
  };
  await check();
  await checkProtection(context, [plan.path, { value: formPath, encoding: "utf-8" }]);
  await check();
  const bytes = Buffer.from(text, "utf8");
  const range = formEditorRange(bytes, change.range.start, change.range.end, text, document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
  const output = text.slice(0, range.start) + change.text + text.slice(range.end);
  if (querySnapshot(output) !== plan.outputSnapshot) throw new ExplorerError("protocolInvalid");
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(range.start), change.text);
  if (!await vscode.workspace.applyEdit(edit) || document.getText() !== output) throw new ExplorerError("sourceChanged");
  if (!await document.save() || document.isDirty) throw new ExplorerError("requestFailed", "creation_dirty_source");
  return true;
}

export function handlerFailure(error: unknown): string {
  if (error instanceof ExplorerError) {
    if (error.domain === "creation_dirty_source") return "editDirty";
    if (["property_read_only", "source_protected", "support_restricted"].includes(error.domain ?? "")) return "editLocked";
  }
  return "handlerUnavailable";
}
