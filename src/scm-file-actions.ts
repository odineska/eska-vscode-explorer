import * as vscode from "vscode";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { GitApi, GitChange, GitRepository } from "./git-api.js";
import { Status } from "./git-status.js";
import { isFileMutation, type FileAction } from "./scm-actions.js";
import type { MessageKey } from "./messages.js";
import { relativeFile } from "./reveal.js";
import { hasDirtySource, sourceKey } from "./source.js";

export interface ScmFileEntry {
  readonly group: "merge" | "index" | "working" | "untracked";
  readonly change: GitChange;
  readonly label: string;
}

export interface ScmFileActionsContext {
  readonly api: GitApi;
  readonly repository: GitRepository;
  readonly entries: readonly ScmFileEntry[];
  readonly text: (key: MessageKey, ...values: string[]) => string;
  readonly validate: () => void;
  readonly statusFresh?: boolean;
}

export async function executeFileAction(action: FileAction, context: ScmFileActionsContext): Promise<void> {
  if (!context.entries.length) return;
  context.validate();
  if (!context.statusFresh && isFileMutation(action)) {
    await context.repository.status();
    context.validate();
  }
  switch (action) {
    case "stage": await stage(context); break;
    case "unstage": {
      const paths = context.entries.filter(entry => entry.group === "index").flatMap(({ change }) =>
        change.status === Status.IndexRenamed ? [change.originalUri.fsPath, change.uri.fsPath] : [change.uri.fsPath]);
      if (paths.length) await context.repository.revert([...new Set(paths)]);
      break;
    }
    case "discard": await discard(context); break;
    case "ignore": await ignore(context); break;
    default:
      for (const entry of context.entries) {
        context.validate();
        await open(action, entry, context);
      }
  }
}

function modifiedEntries(context: ScmFileActionsContext): readonly ScmFileEntry[] {
  return context.entries.filter(entry => entry.group === "working" || entry.group === "untracked");
}

function filePaths(entries: readonly ScmFileEntry[]): string[] {
  return [...new Set(entries.flatMap(({ change }) => [change.uri.fsPath, change.originalUri.fsPath,
    ...(change.renameUri ? [change.renameUri.fsPath] : [])]))];
}

async function stat(path: string) {
  try { return await lstat(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function snapshot(paths: readonly string[], root: string, text: ScmFileActionsContext["text"]): Promise<string> {
  const canonicalRoot = await realpath(root);
  return JSON.stringify(await Promise.all(paths.map(async path => {
    const value = await stat(path);
    if (!value) return undefined;
    // Keep symlink entries themselves actionable, but never traverse a symlinked directory outside Git.
    const canonicalParent = await realpath(dirname(path));
    if (sourceKey(canonicalParent) !== sourceKey(canonicalRoot) && !relativeFile(canonicalRoot, canonicalParent)) {
      throw new Error(text("scmChanged"));
    }
    return [canonicalParent, String(value.dev), String(value.ino), String(value.size), String(value.mtimeNs), String(value.ctimeNs)];
  })));
}

async function destructivePreflight(context: ScmFileActionsContext, paths: readonly string[]): Promise<() => Promise<void>> {
  if (await hasDirtySource(paths, vscode.workspace.textDocuments)) throw new Error(context.text("scmDirty"));
  const head = JSON.stringify(context.repository.state.HEAD);
  const { fsPath: root } = context.repository.rootUri;
  const before = await snapshot(paths, root, context.text);
  return async () => {
    await context.repository.status();
    context.validate();
    if (head !== JSON.stringify(context.repository.state.HEAD) || before !== await snapshot(paths, root, context.text)
      || await hasDirtySource(paths, vscode.workspace.textDocuments)) throw new Error(context.text("scmChanged"));
  };
}

async function discard(context: ScmFileActionsContext): Promise<void> {
  const entries = modifiedEntries(context);
  if (!entries.length) return;
  const check = await destructivePreflight(context, filePaths(entries));
  const restoring = entries.every(({ change }) => change.status === Status.Deleted);
  const untracked = entries.filter(({ change }) => change.status === Status.Untracked || change.status === Status.Ignored).length;
  const confirm = context.text(restoring ? "scmRestore" : "scmDiscard");
  const prompt = restoring ? "scmRestoreConfirm" : untracked === entries.length ? "scmDeleteConfirm"
    : untracked ? "scmDiscardMixedConfirm" : "scmDiscardConfirm";
  const message = context.text(prompt, String(entries.length));
  if (await vscode.window.showWarningMessage(message, {
    modal: true, detail: entries.map(({ label, change }) => `${label}\n${change.uri.fsPath}`).join("\n\n"),
  }, confirm) !== confirm) return;
  await check();
  await context.repository.clean([...new Set(entries.map(({ change }) => change.uri.fsPath))]);
}

async function stage(context: ScmFileActionsContext): Promise<void> {
  const entries = context.entries.filter(entry => entry.group !== "index");
  if (!entries.length) return;
  const merge = entries.filter(entry => entry.group === "merge");
  const deletions = merge.filter(({ change }) => change.status === Status.DeletedByUs || change.status === Status.DeletedByThem);
  const paths = filePaths(merge);
  const check = merge.length ? await destructivePreflight(context, paths) : undefined;
  const unresolved = await Promise.all(merge.filter(entry => !deletions.includes(entry)).map(async ({ change }) => {
    if (change.status !== Status.BothModified && change.status !== Status.BothAdded) return true;
    const value = await stat(change.uri.fsPath);
    if (!value?.isFile()) return true;
    return /^<{7}\s|^={7}\r?$|^>{7}\s/m.test(await readFile(change.uri.fsPath, "utf8"));
  }));
  const deleting = new Set<ScmFileEntry>();
  if (unresolved.some(Boolean)) {
    const confirm = context.text("scmStage");
    if (await vscode.window.showWarningMessage(context.text("scmConflictConfirm"), { modal: true }, confirm) !== confirm) return;
  }
  for (const entry of deletions) {
    const keep = context.text(entry.change.status === Status.DeletedByUs ? "scmKeepTheirs" : "scmKeepOurs");
    const remove = context.text("scmDeleteFile");
    const selected = await vscode.window.showWarningMessage(context.text("scmDeletionConflict", entry.label), {
      modal: true, detail: entry.change.uri.fsPath,
    }, keep, remove);
    if (selected === remove) deleting.add(entry);
    else if (selected !== keep) return;
  }
  const root = context.repository.rootUri.fsPath;
  const targets = await Promise.all(deletions.map(async entry => {
    const { uri } = entry.change;
    const paths = filePaths([entry]);
    const fingerprint = await snapshot(paths, root, context.text);
    const target = await stat(uri.fsPath);
    const remove = deleting.has(entry);
    if ((!target && !remove) || (target && !target.isFile() && !target.isSymbolicLink())) {
      throw new Error(context.text("scmChanged"));
    }
    return { uri, paths, fingerprint, remove, exists: Boolean(target) };
  }));
  if (check) await check();
  const staged = new Set<string>();
  let movedToTrash = false;
  try {
    for (const { uri, paths, fingerprint, remove, exists } of targets) {
      if (fingerprint !== await snapshot(paths, root, context.text)) throw new Error(context.text("scmChanged"));
      if (await hasDirtySource(paths, vscode.workspace.textDocuments)) throw new Error(context.text("scmDirty"));
      if (remove && exists) {
        await vscode.workspace.fs.delete(uri, { useTrash: true });
        movedToTrash = true;
      }
      await context.repository.add([uri.fsPath]);
      staged.add(uri.fsPath);
    }
    const remaining = [...new Set(entries.map(({ change }) => change.uri.fsPath))].filter(path => !staged.has(path));
    if (remaining.length) await context.repository.add(remaining);
  } catch (error) {
    if (movedToTrash || staged.size) throw new Error(context.text("scmPartialStage"), { cause: error });
    throw error;
  }
}

async function ignore(context: ScmFileActionsContext): Promise<void> {
  const entries = modifiedEntries(context);
  if (!entries.length) return;
  const root = context.repository.rootUri.fsPath;
  const patterns = [...new Set(entries.map(({ change }) => {
    const path = relativeFile(root, change.uri.fsPath);
    if (!path || /[\r\n]/.test(path)) throw new Error(context.text("scmIgnoreUnsupported"));
    return `/${path.split(sep).join("/").replace(/[\\*?[\] ]/g, "\\$&")}`;
  }))];
  const uri = vscode.Uri.file(join(root, ".gitignore"));
  const value = await stat(uri.fsPath);
  const before = await snapshot([uri.fsPath], root, context.text);
  if (value && !value.isFile()) throw new Error(context.text("scmIgnoreUnsupported"));
  if (await hasDirtySource([uri.fsPath], vscode.workspace.textDocuments)) throw new Error(context.text("scmDirty"));
  const document = await vscode.workspace.openTextDocument(value ? uri : uri.with({ scheme: "untitled" }));
  await vscode.window.showTextDocument(document);
  context.validate();
  if (document.isDirty) throw new Error(context.text("scmDirty"));
  if (before !== await snapshot([uri.fsPath], root, context.text)) throw new Error(context.text("scmChanged"));
  const current = document.getText();
  const lines = new Set(current.split(/\r?\n/));
  const additions = patterns.filter(pattern => !lines.has(pattern));
  if (!additions.length) return;
  const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const prefix = current && !current.endsWith("\n") ? newline : "";
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(current.length), `${prefix}${additions.join(newline)}${newline}`);
  if (!await vscode.workspace.applyEdit(edit) || !await document.save()) throw new Error(context.text("scmFailed"));
}

/** Open a group in one changes editor, including one-sided additions and deletions. */
export function openGroupChanges(entries: readonly ScmFileEntry[], api: GitApi, repository: GitRepository, title: string): Thenable<void> {
  const resources = entries.map(entry => {
    const { uri, status } = entry.change;
    if (status === Status.Deleted || status === Status.IndexDeleted) {
      return [uri, api.toGitUri(uri, status === Status.Deleted ? "~" : "HEAD"), undefined];
    }
    const { left, right } = diffUris(entry, { api, repository });
    return [uri, left, right];
  });
  return vscode.commands.executeCommand("vscode.changes", title, resources);
}

function diffUris(entry: ScmFileEntry, { api, repository }: Pick<ScmFileActionsContext, "api" | "repository">): {
  left?: vscode.Uri; right?: vscode.Uri;
} {
  const { change, group } = entry;
  const { uri, originalUri, status } = change;
  switch (status) {
    case Status.IndexModified:
    case Status.IndexRenamed: return { left: api.toGitUri(originalUri, "HEAD"), right: api.toGitUri(uri, "") };
    case Status.IndexAdded:
    case Status.IndexCopied: return { right: api.toGitUri(uri, "") };
    case Status.IndexDeleted:
    case Status.Deleted: return { right: api.toGitUri(uri, "HEAD") };
    case Status.DeletedByUs: return { left: api.toGitUri(uri, "~1"), right: api.toGitUri(uri, "~3") };
    case Status.DeletedByThem: return { left: api.toGitUri(uri, "~1"), right: api.toGitUri(uri, "~2") };
  }
  const right = repository.state.indexChanges.find(index => index.renameUri
    && sourceKey(index.uri.fsPath) === sourceKey(uri.fsPath))?.renameUri ?? uri;
  if (status === Status.Modified) return { left: api.toGitUri(uri, "~"), right };
  if (status === Status.IntentToRename || status === Status.TypeChanged) return { left: api.toGitUri(originalUri, "HEAD"), right };
  if (group === "merge" && status !== Status.BothAdded && status !== Status.BothModified) return {};
  return { right };
}

function headUri(entry: ScmFileEntry, { api, repository }: ScmFileActionsContext): vscode.Uri | undefined {
  if (!repository.state.HEAD?.commit || entry.group === "untracked") return;
  const { change } = entry;
  const path = sourceKey(change.uri.fsPath);
  const staged = entry.group === "working" ? repository.state.indexChanges.find(item =>
    sourceKey((item.renameUri ?? item.uri).fsPath) === path || sourceKey(item.uri.fsPath) === path) : undefined;
  const tracked = staged ?? change;
  if ([Status.IndexAdded, Status.IndexCopied, Status.IntentToAdd, Status.Untracked, Status.Ignored]
    .some(status => status === tracked.status)) return;
  return api.toGitUri(tracked.originalUri, "HEAD");
}

async function open(action: "open" | "diff" | "head" | "revealOs" | "revealExplorer" | "compareWorkspace",
  entry: ScmFileEntry, context: ScmFileActionsContext): Promise<void> {
  const { uri, status } = entry.change;
  if (action === "revealOs" || action === "revealExplorer") {
    await vscode.commands.executeCommand(action === "revealOs" ? "revealFileInOS" : "revealInExplorer", uri);
    return;
  }
  if (action === "head" || action === "open" && (status === Status.IndexDeleted || status === Status.Deleted)) {
    const target = headUri(entry, context);
    if (target) await vscode.commands.executeCommand("vscode.open", target, { preview: false }, `${entry.label} (HEAD)`);
    else void vscode.window.showWarningMessage(context.text("scmHeadUnavailable", entry.label));
    return;
  }
  if (action === "open") {
    await vscode.commands.executeCommand("vscode.open", uri, {
      preserveFocus: true, preview: false, viewColumn: vscode.ViewColumn.Active,
      ...(status === Status.BothModified ? { override: false } : {}),
    });
    return;
  }
  if (context.repository.scmProvider === "eska" && entry.group === "merge" && action === "diff") {
    await vscode.commands.executeCommand("vscode.diff", context.api.toGitUri(uri, "~2"),
      context.api.toGitUri(uri, "~3"), entry.label);
    return;
  }
  let { left, right } = diffUris(entry, context);
  if (action === "compareWorkspace") {
    const main = context.repository.state.worktrees?.find(worktree => worktree.main);
    const path = relativeFile(context.repository.rootUri.fsPath, uri.fsPath);
    if (context.repository.kind === "worktree") left = undefined;
    if (main && path) {
      const candidate = join(main.path, path);
      left = await stat(candidate) ? vscode.Uri.file(candidate) : undefined;
    }
  }
  if (!right) return;
  if (left) {
    await vscode.commands.executeCommand("vscode.diff", left, right, entry.label);
  } else if ((status === Status.BothAdded || status === Status.BothModified)
    && context.repository.scmProvider !== "eska"
    && vscode.workspace.getConfiguration("git", uri).get("mergeEditor", false)) {
    await vscode.commands.executeCommand("git.openMergeEditor", right);
  } else {
    await vscode.commands.executeCommand("vscode.open", right, status === Status.BothModified ? { override: false } : {}, entry.label);
  }
}
