import * as vscode from "vscode";

const MOVE = "workbench.action.moveEditorToNewWindow";

/** A freshly created panel reports active before its editor has finished opening. */
function activeTab(panel: vscode.WebviewPanel): vscode.Tab | undefined {
  const group = vscode.window.tabGroups.activeTabGroup, tab = group.activeTab;
  if (panel.active && panel.viewColumn !== undefined && panel.viewColumn > 0
    && group.viewColumn === panel.viewColumn && tab?.label === panel.title
    && tab.input instanceof vscode.TabInputWebview
    && [panel.viewType, `mainThreadWebview-${panel.viewType}`].includes(tab.input.viewType)) return tab;
}

/** Wait for the native tab model, with bounded cancellation and no polling or repeated focus changes. */
function activated(panel: vscode.WebviewPanel): Promise<boolean> {
  if (activeTab(panel)) return Promise.resolve(true);
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
    const check = () => { if (activeTab(panel)) finish(true); };
    const timer = setTimeout(() => finish(false), 3000);
    subscriptions.push(panel.onDidChangeViewState(check), panel.onDidDispose(() => finish(false)),
      vscode.window.tabGroups.onDidChangeTabGroups(check), vscode.window.tabGroups.onDidChangeTabs(check));
    check();
  });
}

/** Move only the verified preview; a focus change falls back to its ordinary editor tab. */
export async function movePreviewToNewWindow(panel: vscode.WebviewPanel): Promise<boolean> {
  if (!(await vscode.commands.getCommands(true)).includes(MOVE)) return false;
  panel.reveal(undefined, false);
  if (!await activated(panel)) return false;
  const tab = activeTab(panel);
  if (!tab) return false;
  // The native move command also accepts focused list selections. Focus the editor
  // first so that an old Explorer/Open Editors selection cannot choose another tab.
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  if (activeTab(panel) !== tab) return false;
  await vscode.commands.executeCommand(MOVE);
  return true;
}
