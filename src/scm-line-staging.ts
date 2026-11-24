import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { GitRepositories } from "./git-api.js";
import type { MessageKey } from "./messages.js";
import { SCM_EMPTY } from "./scm-actions.js";
import { EskaRepository, SCM_SCHEME, type ScmStageLinesRequest } from "./scm-repository.js";
import { hasDirtySource } from "./source.js";
import { relativeFile } from "./reveal.js";

type Text = (key: MessageKey) => string;
const contentLimit = 8 * 1024 * 1024;

function target(git: GitRepositories) {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  const editor = vscode.window.activeTextEditor;
  if (!vscode.workspace.isTrusted || !editor || !(input instanceof vscode.TabInputTextDiff) || input.original.scheme !== SCM_SCHEME) return;
  const deleted = input.modified.scheme === SCM_SCHEME;
  if (!deleted && input.modified.scheme !== "file") return;
  const file = deleted ? input.modified.with({ scheme: "file", query: "", fragment: "" }) : input.modified;
  const repository = git.api.getRepository(file);
  if (!(repository instanceof EskaRepository) || repository.isDisposed || !repository.lineStagingAvailable
    || !relativeFile(repository.rootUri.fsPath, file.fsPath)) return;
  const original = input.original.toString(), modified = input.modified.toString();
  if (repository.toGitUri(file, "~").toString() !== original
    || (deleted && repository.toGitUri(file, SCM_EMPTY).toString() !== modified)) return;
  const active = editor.document.uri.toString();
  if (active !== original && (deleted || active !== modified)) return;
  return { tab, editor, input, repository, file, deleted, side: active === original ? "index" as const : "worktree" as const };
}

/** Only expose the action in a working diff belonging to the active ESKA provider. */
export function watchScmLineStageContext(git: GitRepositories, log: (error: string) => void): vscode.Disposable {
  let enabled = false;
  const update = () => {
    const next = target(git) !== undefined;
    if (next === enabled) return;
    enabled = next;
    void vscode.commands.executeCommand("setContext", "eska.scmCanStageLines", enabled).then(undefined, error => log(String(error)));
  };
  const subscription = vscode.Disposable.from(vscode.window.onDidChangeActiveTextEditor(update),
    vscode.window.tabGroups.onDidChangeTabs(update), vscode.window.tabGroups.onDidChangeTabGroups(update), git.onDidChange(update));
  update();
  return subscription;
}

function selectedLines(editor: vscode.TextEditor): ScmStageLinesRequest["ranges"] {
  const document = editor.document;
  // VS Code includes a final empty line after a newline; Git ranges count real lines.
  const last = document.lineCount - (document.lineAt(document.lineCount - 1).text === "" ? 1 : 0);
  const ranges = editor.selections.map(selection => ({ start: selection.start.line,
    end: Math.min(last, selection.end.line + (selection.isEmpty || selection.end.character > 0 ? 1 : 0)) }))
    .filter(range => range.start < range.end).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }
  return merged;
}

function sameText(document: vscode.TextDocument, bytes: Uint8Array): boolean {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n/g, "\n") === document.getText().replace(/\r\n/g, "\n");
}

export async function stageSelectedLines(git: GitRepositories, text: Text): Promise<void> {
  const current = target(git);
  if (!current) throw new Error(text("scmLineStageChanged"));
  const { tab, repository, editor, input, file, deleted, side } = current;
  const ranges = selectedLines(editor);
  if (!ranges.length) throw new Error(text("scmLineStageEmpty"));
  if (ranges.length > 2048) throw new Error(text("scmLineStageSize"));
  const model = (uri: vscode.Uri): vscode.TextDocument | undefined =>
    vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
  const index = model(input.original), worktree = model(input.modified);
  if (!index || !worktree) throw new Error(text("scmLineStageChanged"));
  const indexVersion = index.version, worktreeVersion = worktree.version;
  if (await hasDirtySource([file.fsPath], vscode.workspace.textDocuments)) throw new Error(text("scmLineStageDirty"));
  const read = async (uri: vscode.Uri): Promise<Uint8Array> => {
    if ((await vscode.workspace.fs.stat(uri)).size > contentLimit) throw new Error(text("scmLineStageSize"));
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.length > contentLimit) throw new Error(text("scmLineStageSize"));
    return bytes;
  };
  const missing = async () => {
    try { await vscode.workspace.fs.stat(file); }
    catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return new Uint8Array();
      throw error;
    }
    throw new Error(text("scmLineStageChanged"));
  };
  const [indexBytes, worktreeBytes] = await Promise.all([read(input.original), deleted ? missing() : read(file)]);
  let matches: boolean;
  try { matches = sameText(index, indexBytes) && sameText(worktree, worktreeBytes); }
  catch { throw new Error(text("scmLineStageUnsupported")); }
  if (!matches) throw new Error(text("scmLineStageChanged"));
  const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
  await repository.stageLines(file, { schema_version: 1, index_sha256: hash(indexBytes), worktree_sha256: hash(worktreeBytes), side, ranges }, () => {
    const next = target(git);
    if (!next || next.tab !== tab || next.repository !== repository || next.editor !== editor
      || index.isClosed || worktree.isClosed || indexVersion !== index.version || worktreeVersion !== worktree.version
      || worktree.isDirty || JSON.stringify(selectedLines(editor)) !== JSON.stringify(ranges)) throw new Error(text("scmLineStageChanged"));
  });
}
