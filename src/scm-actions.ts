import type { MessageKey } from "./messages.js";
import type { ChangeGroup } from "./scm-model.js";

export const fileActions = ["open", "diff", "head", "stage", "unstage", "discard", "ignore", "revealOs", "revealExplorer", "compareWorkspace"] as const;
export type FileAction = typeof fileActions[number];
export const groupCommands = {
  stageAll: "git.stageAll", stageAllTracked: "git.stageAllTracked", stageAllUntracked: "git.stageAllUntracked", stageAllMerge: "git.stageAllMerge",
  unstageAll: "git.unstageAll", discardAll: "git.cleanAll", discardAllTracked: "git.cleanAllTracked", discardAllUntracked: "git.cleanAllUntracked",
  openAll: "git.viewChanges", openAllStaged: "git.viewStagedChanges", openAllUntracked: "git.viewUntrackedChanges",
} as const;
export type GroupAction = keyof typeof groupCommands;
export type ScmAction = FileAction | GroupAction | "openChange" | "commit" | "refresh";

const details: Record<FileAction | GroupAction | "commit" | "refresh", readonly [MessageKey, string]> = {
  open: ["scmOpen", "go-to-file"], diff: ["scmDiff", "compare-changes"], head: ["scmHead", "file"],
  stage: ["scmStage", "add"], unstage: ["scmUnstage", "remove"], discard: ["scmDiscard", "discard"], ignore: ["scmIgnore", "exclude"],
  revealOs: ["scmRevealOs", "folder"], revealExplorer: ["scmRevealExplorer", "files"], compareWorkspace: ["scmCompareWorkspace", "compare-changes"],
  stageAll: ["scmStageAll", "add"], stageAllTracked: ["scmStageAllTracked", "add"], stageAllUntracked: ["scmStageAllUntracked", "add"], stageAllMerge: ["scmStageAllMerge", "add"],
  unstageAll: ["scmUnstageAll", "remove"], discardAll: ["scmDiscardAll", "discard"], discardAllTracked: ["scmDiscardAllTracked", "discard"], discardAllUntracked: ["scmDiscardAllUntracked", "discard"],
  openAll: ["scmOpenAll", "diff-multiple"], openAllStaged: ["scmOpenAllStaged", "diff-multiple"], openAllUntracked: ["scmOpenAllUntracked", "diff-multiple"],
  commit: ["scmCommit", "check"], refresh: ["scmRefresh", "refresh"],
};

export function button(action: Exclude<ScmAction, "openChange">, text: (key: MessageKey) => string) {
  const [label, icon] = details[action]; return { id: action, title: text(label), icon };
}

export function isFileAction(value: string): value is FileAction { return (fileActions as readonly string[]).includes(value); }
export function isGroupAction(value: string): value is GroupAction { return Object.hasOwn(groupCommands, value); }

/** Mirror stock Git's resource menus; file paths and operations remain owned by its public API. */
export function fileMenu(group: ChangeGroup, worktree: boolean, local: boolean, canDiscard: boolean): FileAction[] {
  const menu: FileAction[] = group === "merge" ? ["open", "stage"] : group === "index" ? ["diff", "open", "head", "unstage"]
    : ["diff", "open", "head", ...(canDiscard ? ["discard" as const] : []), "stage", "ignore"];
  if (group !== "untracked") { if (local) menu.push("revealOs"); menu.push("revealExplorer"); }
  if (worktree && (group === "index" || group === "working")) menu.push("compareWorkspace");
  return menu;
}

export function fileInline(group: ChangeGroup, showOpen: boolean, openDiff: boolean, canDiscard: boolean): FileAction[] {
  return [...(showOpen ? [openDiff ? "open" as const : "diff" as const] : []),
    ...(group === "index" ? ["unstage" as const] : group === "merge" ? ["stage" as const]
      : [...(canDiscard ? ["discard" as const] : []), "stage" as const])];
}

export function groupActions(group: ChangeGroup, mixed: boolean): GroupAction[] {
  switch (group) {
    case "merge": return ["stageAllMerge"];
    case "index": return ["openAllStaged", "unstageAll"];
    case "working": return ["openAll", mixed ? "discardAll" : "discardAllTracked", mixed ? "stageAll" : "stageAllTracked"];
    case "untracked": return ["openAllUntracked", "discardAllUntracked", "stageAllUntracked"];
  }
}
