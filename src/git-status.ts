// Status values belong to the built-in Git API v1.
export const Status = {
  IndexModified: 0, IndexAdded: 1, IndexDeleted: 2, IndexRenamed: 3, IndexCopied: 4,
  Modified: 5, Deleted: 6, Untracked: 7, Ignored: 8, IntentToAdd: 9, IntentToRename: 10, TypeChanged: 11,
  AddedByUs: 12, AddedByThem: 13, DeletedByUs: 14, DeletedByThem: 15, BothAdded: 16, BothDeleted: 17, BothModified: 18,
} as const;

/** Stable status values from the built-in vscode.git API v1. */
export interface GitStatus { badge: string; color: string; message: "gitModified" | "gitAdded" | "gitDeleted" | "gitRenamed" | "gitConflict"; priority: number }

/** Preserve native Git theme colors, with conflicts winning over other states. */
export function gitStatus(status: number): GitStatus | undefined {
  if (status >= Status.AddedByUs && status <= Status.BothModified) return { badge: "!", color: "conflictingResourceForeground", message: "gitConflict", priority: 5 };
  switch (status) {
    case Status.IndexModified: return { badge: "M", color: "stageModifiedResourceForeground", message: "gitModified", priority: 2 };
    case Status.IndexAdded: case Status.IndexCopied: return { badge: "A", color: "addedResourceForeground", message: "gitAdded", priority: 1 };
    case Status.IndexDeleted: return { badge: "D", color: "stageDeletedResourceForeground", message: "gitDeleted", priority: 4 };
    case Status.IndexRenamed: case Status.IntentToRename: return { badge: "R", color: "renamedResourceForeground", message: "gitRenamed", priority: 3 };
    case Status.Modified: case Status.TypeChanged: return { badge: "M", color: "modifiedResourceForeground", message: "gitModified", priority: 2 };
    case Status.Deleted: return { badge: "D", color: "deletedResourceForeground", message: "gitDeleted", priority: 4 };
    case Status.Untracked: case Status.IntentToAdd: return { badge: "U", color: "untrackedResourceForeground", message: "gitAdded", priority: 1 };
    default: return undefined;
  }
}
