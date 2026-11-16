import type { MessageKey } from "./messages.js";

const actions = [
  ["runTest", "runtimeRunTest", "play"],
  ["debugLaunch", "runtimeDebugLaunch", "debug-start"],
  ["debugAttach", "runtimeDebugAttach", "plug"],
  ["applyTest", "runtimeApplyTest", "sync"],
  ["applyAndRunTest", "runtimeApplyThenRun", "run-all"],
  ["applyAndDebugTest", "runtimeApplyThenDebug", "debug-rerun"],
] as const satisfies ReadonlyArray<readonly [string, MessageKey, string]>;

export interface RuntimeAction { command: string; title: MessageKey; icon: string }

/** Stable command identities, order, icons and translations for the Run and Debug view. */
export function runtimeActions(): RuntimeAction[] {
  return actions.map(([command, title, icon]) => ({ command: `eska.explorer.${command}`, title, icon }));
}
