import type * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
const history: string[] = [];

/** Keep only trusted, localized stage captions; clocks and raw tool output are never logged. */
export function operationHistory(api: typeof vscode, line: string): void {
  channel ??= api.window.createOutputChannel?.("ESKA Operations");
  if (!channel) return;
  history.push(line);
  if (history.length > 300) {
    // Trim in batches so long native-object streams do not rewrite the window for every line.
    history.splice(0, 100);
    channel.replace(history.join("\n") + "\n");
  } else channel.appendLine(line);
}
