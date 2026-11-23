import { basename } from "node:path";
import { sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import type { GitChange, GitRepository } from "./git-api.js";
import type { ScmMonitorSnapshot } from "./scm-monitor.js";

export type ChangeGroup = "merge" | "index" | "working" | "untracked";
export const changeGroups: readonly ChangeGroup[] = ["merge", "index", "working", "untracked"];
export type ChangeAction = "open" | "diff" | "stage" | "unstage" | "discard";

/** Preserve independent HEAD→index and index→worktree rows for the same physical file. */
export function changes(repository: GitRepository, group: ChangeGroup): readonly GitChange[] {
  return group === "merge" ? repository.state.mergeChanges : group === "index" ? repository.state.indexChanges
    : group === "working" ? repository.state.workingTreeChanges : repository.state.untrackedChanges ?? [];
}

/** Use native rename endpoints and conflict detail only when the monitored paths still agree. */
export function monitoredChanges(repository: GitRepository, group: ChangeGroup, snapshot: ScmMonitorSnapshot,
  untracked: string): readonly GitChange[] {
  const files = group === "merge" ? snapshot.mergeChanges : group === "index" ? snapshot.indexChanges
    : group === "working" ? untracked === "mixed" ? [...snapshot.workingTreeChanges, ...snapshot.untrackedChanges] : snapshot.workingTreeChanges
      : untracked === "separate" ? snapshot.untrackedChanges : [];
  const paths = new Map(files.map(file => [sourceKey(file.uri.fsPath), file]));
  for (const change of changes(repository, group)) {
    const key = sourceKey(change.uri.fsPath);
    const current = paths.get(key);
    if (!current || !insideRepository(repository, change)) continue;
    const original = sourceKey(change.originalUri.fsPath);
    if (original === key) {
      if (change.status === current.status || group === "merge" && change.status >= 12 && change.status <= 18) paths.set(key, change);
      continue;
    }
    const previous = paths.get(original);
    if (group === "index" && change.status === 3 && previous?.status === 2 && current.status === 1
      || group === "working" && change.status === 10 && previous?.status === 6 && (current.status === 7 || current.status === 9)) {
      paths.delete(original);
      paths.set(key, change);
    }
  }
  return [...paths.values()];
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
