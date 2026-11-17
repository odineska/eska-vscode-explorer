import type * as vscode from "vscode";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ExplorerError, type WirePath } from "./protocol.js";
import { hasDirtySource, existingSource, nativePath, resolveSourcePath } from "./source.js";
import { message } from "./messages.js";
import type { ObjectPlan } from "./metadata-object-protocol.js";

/** Review remains bounded in memory even when a copied object owns large binary templates. */
export async function verifyObjectSources(api: typeof vscode, root: WirePath, plan: ObjectPlan,
  readOnly: (uri: vscode.Uri) => boolean, current: () => void): Promise<void> {
  const paths = new Map<string, { path: WirePath; changed: boolean }>();
  for (const path of plan.inputs) paths.set(resolveSourcePath(root, path), { path, changed: false });
  for (const file of plan.files) paths.set(resolveSourcePath(root, file.path), { path: file.path, changed: true });
  const checkBuffers = async (): Promise<void> => {
    current();
    if (await hasDirtySource(paths.keys(), api.workspace.textDocuments))
      throw new ExplorerError("requestFailed", "creation_dirty_source");
    current();
    for (const [path, use] of paths) {
      const uri = api.Uri.file(path);
      if (use.changed && readOnly(uri)) throw new ExplorerError("requestFailed", "property_read_only");
    }
  };
  await checkBuffers();
  for (const file of plan.files) {
    if (!file.before) continue;
    const path = await existingSource(root, file.path);
    const metadata = await stat(path); current();
    if (metadata.size !== file.before.bytes) throw new ExplorerError("sourceChanged");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path)) { current(); digest.update(chunk); }
    if (digest.digest("hex") !== file.before.snapshot) throw new ExplorerError("sourceChanged");
  }
  // Hashing yields to the editor; a buffer or read-only setting may have changed meanwhile.
  await checkBuffers();
}

/** Use existing review tabs and translations; UUID allocations stay inspectable before acceptance. */
export function objectReview(plan: ObjectPlan, language: "ru-RU" | "en-US"): string {
  const text = (key: Parameters<typeof message>[1], ...args: string[]): string => message(language, key, ...args);
  const lines = [text("objectSourceOnly"), "", text("objectFiles", String(plan.files.length))];
  for (const file of plan.files) {
    const action = text(file.action === "create" ? "objectFileCreate" : file.action === "delete" ? "objectFileDelete" : "objectFileUpdate");
    lines.push(`${action}  ${nativePath(file.path)}  (${file.before?.bytes ?? 0} → ${file.after?.bytes ?? 0})`);
  }
  const identities = Object.entries(plan.prepared.identities);
  if (identities.length) { lines.push("", text("objectIdentities", String(identities.length))); for (const [source, target] of identities) lines.push(`${source} → ${target}`); }
  if (plan.references.length) {
    lines.push("", text("objectReferences", String(plan.references.length)), text("objectReferencesNotice"));
    for (const reference of plan.references) lines.push(`${text(reference.confirmed ? "objectReferenceConfirmed" : "objectReferenceCandidate")}  ${nativePath(reference.path)}:${reference.range.start}`);
  }
  return lines.join("\n");
}
