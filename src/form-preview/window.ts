import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

const MOVE = "workbench.action.moveEditorToNewWindow";
const COMPACT = "workbench.action.enableCompactAuxiliaryWindow";

/** Resolve the known panel, including a new auxiliary group that has not taken focus yet. */
function panelTab(panel: vscode.WebviewPanel): vscode.Tab | undefined {
  if (panel.viewColumn === undefined || panel.viewColumn <= 0) return;
  const group = vscode.window.tabGroups.all.find(candidate => candidate.viewColumn === panel.viewColumn);
  const tab = group?.activeTab;
  if (tab?.label === panel.title && tab.input instanceof vscode.TabInputWebview
    && [panel.viewType, `mainThreadWebview-${panel.viewType}`].includes(tab.input.viewType)) return tab;
}

/** A freshly created panel reports active before its editor has finished opening. */
function activeTab(panel: vscode.WebviewPanel): vscode.Tab | undefined {
  const tab = panelTab(panel);
  if (panel.active && tab?.group === vscode.window.tabGroups.activeTabGroup) return tab;
}

/** Wait for the native tab model with bounded cancellation and no polling. */
function waitForPanel(panel: vscode.WebviewPanel, matches: () => boolean): Promise<boolean> {
  if (matches()) return Promise.resolve(true);
  return new Promise(resolve => {
    const subscriptions: vscode.Disposable[] = [];
    let finished = false;
    const finish = (result: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      resolve(result);
    };
    const check = () => { if (matches()) finish(true); };
    const timer = setTimeout(() => finish(false), 3000);
    subscriptions.push(panel.onDidChangeViewState(check), panel.onDidDispose(() => finish(false)),
      vscode.window.tabGroups.onDidChangeTabGroups(check), vscode.window.tabGroups.onDidChangeTabs(check));
    check();
  });
}

/** Native window focus can lag both public panel/tab events after a move. */
function focusedWebview(panel: vscode.WebviewPanel): Promise<boolean> {
  const token = randomUUID();
  return new Promise(resolve => {
    const subscriptions: vscode.Disposable[] = [];
    let finished = false;
    const finish = (focused: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const subscription of subscriptions) subscription.dispose();
      resolve(focused);
    };
    const request = () => { void Promise.resolve(panel.webview.postMessage({ type: "focusPreviewWindow", token })).catch(() => finish(false)); };
    const timer = setTimeout(() => finish(false), 3000);
    subscriptions.push(panel.onDidDispose(() => finish(false)), panel.webview.onDidReceiveMessage(value => {
      if (value?.type === "previewWindowFocused" && value.token === token) finish(true);
      // Moving a webview can recreate its document. Retry only its ready event,
      // never re-reveal the panel or poll while waiting for that document to load.
      else if (value?.type === "ready") request();
    }));
    request();
  });
}

/** Move only the verified preview; a focus change falls back to its ordinary editor tab. */
export async function movePreviewToNewWindow(panel: vscode.WebviewPanel): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(MOVE)) return false;
  panel.reveal(undefined, false);
  if (!await waitForPanel(panel, () => activeTab(panel) !== undefined)) return false;
  const tab = activeTab(panel);
  if (!tab) return false;
  // The native move command also accepts focused list selections. Focus the editor
  // first so that an old Explorer/Open Editors selection cannot choose another tab.
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  if (activeTab(panel) !== tab) return false;
  const group = tab.group;
  await vscode.commands.executeCommand(MOVE);
  // Moving an editor can briefly return focus to the original group. Reveal the
  // verified moved panel once, as part of this explicit detach action. Existing
  // windows are never moved or compacted again when merely revealed/restored.
  const moved = () => { const candidate = panelTab(panel); return candidate !== undefined && candidate.group !== group; };
  if (await waitForPanel(panel, moved) && (await vscode.commands.getCommands(true)).includes(COMPACT) && moved()) {
    panel.reveal(undefined, false);
    if (await waitForPanel(panel, () => panel.active && moved()) && await focusedWebview(panel)) {
      // VS Code can retain the old global activeTabGroup after moving an already
      // active tab. The panel focus event follows the actual webview focus; combine
      // it with the verified new group instead of trusting that stale group flag.
      const current = panelTab(panel);
      if (panel.active && current && current.group !== group) await vscode.commands.executeCommand(COMPACT);
    }
  }
  return true;
}
