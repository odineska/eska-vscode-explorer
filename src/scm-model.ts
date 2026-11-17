import { basename } from "node:path";
import { sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import type { GitChange, GitRepository } from "./git-api.js";

export type ChangeGroup = "merge" | "index" | "working" | "untracked";
export const changeGroups: readonly ChangeGroup[] = ["merge", "index", "working", "untracked"];
export type ChangeAction = "open" | "diff" | "stage" | "unstage" | "discard";

/** Preserve independent HEAD→index and index→worktree rows for the same physical file. */
export function changes(repository: GitRepository, group: ChangeGroup): readonly GitChange[] {
  return group === "merge" ? repository.state.mergeChanges : group === "index" ? repository.state.indexChanges
    : group === "working" ? repository.state.workingTreeChanges : repository.state.untrackedChanges ?? [];
}

export function changeIdentity(change: GitChange, group: ChangeGroup): string {
  return JSON.stringify([group, sourceKey(change.uri.fsPath), sourceKey(change.originalUri.fsPath),
    change.renameUri ? sourceKey(change.renameUri.fsPath) : null, change.status]);
}

/** Do not route a malformed or cross-repository change into a mutating Git API call. */
export function insideRepository(repository: GitRepository, change: GitChange): boolean {
  return repository.rootUri.scheme === "file" && [change.uri, change.originalUri, ...(change.renameUri ? [change.renameUri] : [])]
    .every(uri => uri.scheme === "file" && relativeFile(repository.rootUri.fsPath, uri.fsPath) !== undefined);
}

export function permits(group: ChangeGroup, action: ChangeAction): boolean {
  return action === "stage" ? group !== "index" : action === "unstage" ? group === "index"
    : action === "discard" ? group === "working" || group === "untracked" : true;
}

/** Names are presentation only; the actual Git URIs are never replaced with synthetic paths. */
export function changeCaption(change: GitChange, labels: ReadonlyMap<string, string>): string {
  const title = (path: string): string => labels.get(sourceKey(path)) ?? basename(path);
  const current = title(change.uri.fsPath);
  return (change.status === 3 || change.status === 10) && sourceKey(change.uri.fsPath) !== sourceKey(change.originalUri.fsPath)
    ? `${title(change.originalUri.fsPath)} → ${current}` : current;
}
