import { basename } from "node:path";
import { sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import type { GitChange, GitRepository } from "./git-api.js";
import type { ScmMonitorSnapshot } from "./scm-monitor.js";
import { Status } from "./git-status.js";

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
  const matched = matchChanges(repository, group, files);
  if (!matched.size) return files;
  const result = new Map<string, GitChange>();
  for (const file of files) {
    const change = matched.get(changeIdentity(file, group)) ?? file;
    result.set(changeIdentity(change, group), change);
  }
  return [...result.values()];
}

/** Identify paths claimed by a single change. An ambiguous endpoint cannot justify a rename. */
function indexPath(index: Map<string, GitChange | null>, path: string, change: GitChange): void {
  const key = sourceKey(path);
  if (!index.has(key)) index.set(key, change);
  else if (index.get(key) !== change) index.set(key, null);
}

/** Both rendering and actions use the same native detail for the selected monitor paths. */
export function matchChanges(repository: GitRepository, group: ChangeGroup, available: readonly GitChange[],
  owns?: (path: string) => boolean): Map<string, GitChange> {
  const matches = new Map<string, GitChange>();
  const changesInGroup = changes(repository, group);
  if (!available.length || !changesInGroup.length) return matches;
  const identities = new Set(available.map(change => changeIdentity(change, group)));
  const byPath = new Map<string, GitChange | null>();
  for (const change of available) indexPath(byPath, change.uri.fsPath, change);

  const native = changesInGroup.filter(change => insideRepository(repository, change, owns));
  const nativePaths = new Map<string, GitChange | null>();
  for (const change of native) {
    for (const uri of changeUris(change)) indexPath(nativePaths, uri.fsPath, change);
  }
  const plain = (key: string): GitChange | undefined => {
    const change = byPath.get(key);
    return change && sourceKey(change.originalUri.fsPath) === key
      && (!change.renameUri || sourceKey(change.renameUri.fsPath) === key) ? change : undefined;
  };
  for (const change of native) {
    const identity = changeIdentity(change, group);
    if (identities.has(identity)) { matches.set(identity, change); continue; }
    const oldKey = sourceKey(change.originalUri.fsPath), newKey = sourceKey(change.uri.fsPath);
    if (nativePaths.get(oldKey) !== change || nativePaths.get(newKey) !== change
      || (change.renameUri && sourceKey(change.renameUri.fsPath) !== newKey)) continue;
    const current = plain(newKey);
    if (!current) continue;
    if (oldKey === newKey) {
      if (group === "merge" && current.status === Status.BothModified
        && change.status >= Status.AddedByUs && change.status <= Status.BothModified) {
        matches.set(changeIdentity(current, group), change);
      }
      continue;
    }
    const old = plain(oldKey);
    const indexRename = group === "index" && change.status === Status.IndexRenamed
      && old?.status === Status.IndexDeleted && current.status === Status.IndexAdded;
    const workingRename = group === "working" && change.status === Status.IntentToRename
      && old?.status === Status.Deleted && (current.status === Status.Untracked || current.status === Status.IntentToAdd);
    if (old && (indexRename || workingRename)) {
      matches.set(changeIdentity(old, group), change);
      matches.set(changeIdentity(current, group), change);
    }
  }
  return matches;
}

function changeUris(change: GitChange) {
  return [change.uri, change.originalUri, ...(change.renameUri ? [change.renameUri] : [])];
}

export function changeIdentity(change: GitChange, group: ChangeGroup): string {
  return JSON.stringify([group, sourceKey(change.uri.fsPath), sourceKey(change.originalUri.fsPath),
    change.renameUri ? sourceKey(change.renameUri.fsPath) : null, change.status]);
}

/** Do not route a malformed or cross-repository change into a mutating Git API call. */
export function insideRepository(repository: GitRepository, change: GitChange, owns?: (path: string) => boolean): boolean {
  return repository.rootUri.scheme === "file" && changeUris(change).every(uri => uri.scheme === "file"
    && relativeFile(repository.rootUri.fsPath, uri.fsPath) !== undefined && (!owns || owns(uri.fsPath)));
}

export function permits(group: ChangeGroup, action: ChangeAction): boolean {
  return action === "stage" ? group !== "index" : action === "unstage" ? group === "index"
    : action === "discard" ? group === "working" || group === "untracked" : true;
}

/** Names are presentation only; the actual Git URIs are never replaced with synthetic paths. */
export function changeCaption(change: GitChange, labels: ReadonlyMap<string, string>): string {
  const title = (path: string): string => labels.get(sourceKey(path)) ?? basename(path);
  const current = title(change.uri.fsPath);
  return (change.status === Status.IndexRenamed || change.status === Status.IntentToRename) && sourceKey(change.uri.fsPath) !== sourceKey(change.originalUri.fsPath)
    ? `${title(change.originalUri.fsPath)} → ${current}` : current;
}
