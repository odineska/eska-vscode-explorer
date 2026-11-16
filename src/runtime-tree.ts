import { message, type MessageKey } from "./messages.js";
import type { ProjectTree } from "./tree.js";

const actions = [
  ["runTest", "runtimeRunTest", "play"],
  ["debugLaunch", "runtimeDebugLaunch", "debug-start"],
  ["debugAttach", "runtimeDebugAttach", "plug"],
  ["applyTest", "runtimeApplyTest", "sync"],
  ["applyAndRunTest", "runtimeApplyThenRun", "run-all"],
  ["applyAndDebugTest", "runtimeApplyThenDebug", "debug-rerun"],
] as const satisfies ReadonlyArray<readonly [string, MessageKey, string]>;

export interface RuntimeGroup {
  runtimeKind: "group";
  key: string;
  project: ProjectTree;
}
export interface RuntimeAction { command: string; title: MessageKey; icon: string }
export interface RuntimeCommand extends RuntimeAction {
  runtimeKind: "command";
  key: string;
  project: ProjectTree;
  parent: RuntimeGroup;
}
export type RuntimeEntry = RuntimeGroup | RuntimeCommand;

/** Keep each action bound to its tree project instead of the active editor or a global selection. */
export function runtimeGroup(project: ProjectTree): RuntimeGroup {
  return { runtimeKind: "group", key: `runtime:${project.key}`, project };
}

export function runtimeCommands(parent: RuntimeGroup): RuntimeCommand[] {
  return actions.map(([command, title, icon]) => ({ runtimeKind: "command", key: `${parent.key}:${command}`,
    parent, project: parent.project, command: `eska.explorer.${command}`, title, icon }));
}

/** Both native views use the same command identities, order, icons and translations. */
export function runtimeActions(): RuntimeAction[] {
  return actions.map(([command, title, icon]) => ({ command: `eska.explorer.${command}`, title, icon }));
}

export function runtimeLabel(entry: RuntimeEntry, language: string): string {
  return message(language, entry.runtimeKind === "group" ? "runtimeGroup" : entry.title);
}
