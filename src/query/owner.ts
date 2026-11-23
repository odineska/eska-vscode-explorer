import { constants } from "node:fs";
import { access } from "node:fs/promises";
import * as vscode from "vscode";
import { ExplorerError, isRecord, isWirePath, type WirePath } from "../protocol.js";
import { revealFile } from "../reveal.js";
import { existingSource, nativePath, isForm } from "../source.js";
import { nodeKey, type MetadataTree, type TreeEntry } from "../tree.js";

export interface QueryOwnerView {
  entry: TreeEntry;
  source: WirePath;
  path: string;
  document: vscode.TextDocument;
}

/** Query candidates come from declared owner kinds, never a workspace-wide XML search. */
export function isXmlQueryOwner(entry: TreeEntry): boolean {
  return entry.node.id.kind === "object" && ["common-template", "template", "common-form", "form"].includes(entry.node.metadataKind ?? "");
}

/** Locate the native view from backend source roles; ESKA owns descriptor, disk and permission checks. */
export async function xmlQueryOwner(tree: MetadataTree, entry: TreeEntry): Promise<QueryOwnerView | undefined> {
  if (!isXmlQueryOwner(entry)) return undefined;
  const result = await tree.request(entry.project, "metadata/source", { node: entry.node.id });
  if (!Array.isArray(result.sources)) throw new ExplorerError("protocolInvalid");
  const payloadName = isForm(entry) ? "Form.xml" : "Template.xml";
  const payloads = result.sources.filter(value => isRecord(value) && isRecord(value.role) && value.role.kind === "payload"
    && isWirePath(value.path) && nativePath(value.path).replaceAll("\\", "/").split("/").at(-1) === payloadName);
  if (payloads.length === 0) return undefined;
  if (payloads.length !== 1) throw new ExplorerError("protocolInvalid");
  const source = payloads[0]!.path as WirePath;
  const path = await existingSource(entry.project.info.sourcePath, source);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
  if (entry.project.nodes.get(nodeKey(entry.node.id)) !== entry || document.isClosed) throw new ExplorerError("sourceChanged");
  return { entry, source, path, document };
}

/** File permissions apply to every view, independently of read-only settings in a particular editor. */
export async function nativeReadOnly(document: vscode.TextDocument): Promise<boolean> {
  const stat = await vscode.workspace.fs.stat(document.uri);
  if (stat.permissions === vscode.FilePermission.Readonly) return true;
  return document.uri.scheme === "file" && !await access(document.uri.fsPath, constants.W_OK).then(() => true, () => false);
}

/** Native tabs retain dirty state when a concurrent save notification clears the extension-host document flag. */
export function nativeDirty(document: vscode.TextDocument): boolean {
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText
    && tab.input.uri.toString() === document.uri.toString());
  return document.isDirty || tabs.some(tab => tab.isDirty);
}

/** A clean source can follow VS Code's native file reload without changing the owner's editor permissions. */
export async function writeCleanQueryOwner(document: vscode.TextDocument, version: string, output: string,
  willWrite: () => void): Promise<void> {
  const encoding = document.encoding;
  const before = document.getText();
  const [original, replacement] = await Promise.all([
    vscode.workspace.encode(before, { encoding }), vscode.workspace.encode(output, { encoding }),
  ]);
  const disk = await vscode.workspace.fs.readFile(document.uri);
  if (document.isClosed || nativeDirty(document) || String(document.version) !== version || document.encoding !== encoding
    || !Buffer.from(disk).equals(original)) throw new ExplorerError("sourceChanged");

  let changed!: () => void;
  const reloaded = new Promise<void>(resolve => { changed = resolve; });
  const changes = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document === document && event.contentChanges.length) changed();
  });
  const closed = vscode.workspace.onDidCloseTextDocument(value => { if (value === document) changed(); });
  const waitForChange = async (milliseconds: number) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([reloaded, new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); })]);
    } finally { clearTimeout(timer); }
  };
  const awaitingReload = () => !document.isClosed && String(document.version) === version;
  try {
    willWrite();
    await vscode.workspace.fs.writeFile(document.uri, replacement);
    if (awaitingReload()) await waitForChange(750);
    if (awaitingReload() && !nativeDirty(document)) {
      // An excluded file may never produce a watcher event. Resolving a native view reloads a clean model.
      // VS Code preserves concurrent dirty edits when resolving the view and keeps focus in the query.
      const priorTabs = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs));
      const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
      try {
        if (awaitingReload()) await waitForChange(10_000);
      } finally {
        const group = vscode.window.tabGroups.all.find(group => group.viewColumn === editor.viewColumn);
        const temporary = group?.tabs.find(tab => !priorTabs.has(tab) && tab.input instanceof vscode.TabInputText
          && tab.input.uri.toString() === document.uri.toString());
        if (temporary && !temporary.isDirty && !document.isDirty && vscode.window.activeTextEditor !== editor) {
          await vscode.window.tabGroups.close(temporary, true);
        }
      }
    }
    if (document.isClosed || document.isDirty || document.getText() !== output) throw new ExplorerError("sourceChanged");
  } finally {
    changes.dispose();
    closed.dispose();
  }
}

/** Resolve the active module through backend source roles; the adapter never infers a BSL owner from its filename. */
export async function bslQueryOwner(tree: MetadataTree, document: vscode.TextDocument): Promise<QueryOwnerView> {
  const version = document.version;
  for (let attempt = 0; attempt < 3; attempt++) {
    await tree.synchronizeInputs();
    const revealed = await revealFile(tree, document.uri.fsPath);
    if (!revealed) throw new ExplorerError("sourceMissing");
    const entry = "target" in revealed ? revealed.owner : revealed;
    const generation = entry.project.info.generation, sequence = entry.project.info.eventSequence;
    try {
      // metadata/source drains native events again. If that invalidates the lazy module,
      // repeat reverse navigation rather than retrying its now-unmaterialized node ID.
      const result = await tree.request(entry.project, "metadata/source", { node: entry.node.id });
      if (!Array.isArray(result.sources)) throw new ExplorerError("protocolInvalid");
      for (const value of result.sources) {
        if (!isRecord(value) || !isRecord(value.role) || value.role.kind !== "module" || !isWirePath(value.path)) continue;
        const path = await existingSource(entry.project.info.sourcePath, value.path);
        if (vscode.Uri.file(path).toString() !== document.uri.toString()) continue;
        if (document.isClosed || document.version !== version) throw new ExplorerError("sourceChanged");
        return { entry, source: value.path, path, document };
      }
      throw new ExplorerError("sourceMissing");
    } catch (error) {
      if (!document.isClosed && document.version === version
        && (generation !== entry.project.info.generation || sequence !== entry.project.info.eventSequence)
        && error instanceof ExplorerError && (error.code === "sourceChanged" || error.domain === "unknown_node" || error.domain === "stale_generation")) {
        if (attempt === 2) throw new ExplorerError("sourceChanged");
        continue;
      }
      throw error;
    }
  }
  throw new ExplorerError("sourceChanged");
}
