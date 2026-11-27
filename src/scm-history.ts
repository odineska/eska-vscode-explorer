import * as vscode from "vscode";
import { basename } from "node:path";
import type { GitRepositories } from "./git-api.js";
import type { MessageKey } from "./messages.js";
import { ScmHistoryView } from "./scm-history-view.js";

const viewId = "eska.explorer.scmHistory";

export function registerScmHistory(extensionUri: vscode.Uri, git: GitRepositories, text: (key: MessageKey) => string): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const snapshot = () => git.historyRepositories.map(repo => ({ repo, commit: repo.state.HEAD?.commit, branch: repo.state.HEAD?.name }));
  let previous = snapshot();
  const setVisible = (visible: boolean) => vscode.commands.executeCommand("setContext", "eska.hasAutonomousScm", visible);
  void setVisible(previous.length > 0);
  const subscription = git.onDidChange(repository => {
    const current = snapshot();
    if (!!previous.length !== !!current.length) void setVisible(current.length > 0);
    const different = current.length !== previous.length || current.some(({ repo, commit, branch }, index) =>
      previous[index]?.repo !== repo || previous[index]?.commit !== commit || previous[index]?.branch !== branch);
    previous = current;
    // Native toolbar operations can move a tag or remote ref without moving HEAD.
    if (different || !repository && current.length > 0) changed.fire();
  });
  const view = new ScmHistoryView(extensionUri, {
    onDidChange: changed.event,
    repositories: () => {
      const roots = git.historyRepositories.map(repo => repo.rootUri.fsPath);
      const counts = new Map<string, number>();
      for (const root of roots) counts.set(basename(root), (counts.get(basename(root)) ?? 0) + 1);
      return roots.map(id => ({ id, label: counts.get(basename(id)) === 1 ? basename(id) : id }));
    },
    history: async (id, cursor, signal) => {
      const owner = git.historyRepositories.find(repo => repo.rootUri.fsPath === id);
      if (!owner || !vscode.workspace.isTrusted) throw new Error(text("scmRepositoryUnavailable"));
      return owner.history(cursor, signal);
    },
  }, {
    title: text("scmHistoryTitle"), repository: text("scmRepository"),
    loadMore: text("scmHistoryMore"), loading: text("scmHistoryLoading"), empty: text("scmHistoryEmpty"),
    noRepositories: text("scmHistoryNoRepositories"), retry: text("scmHistoryRetry"),
    commit: text("scmHistoryCommit"), author: text("scmHistoryAuthor"), date: text("scmHistoryDate"),
    hash: text("scmHistoryHash"), parents: text("scmHistoryParents"),
  });
  return vscode.Disposable.from(view, changed, subscription, vscode.window.registerWebviewViewProvider(viewId, view),
    vscode.commands.registerCommand(`${viewId}.refresh`, () => view.refresh()), new vscode.Disposable(() => { void setVisible(false); }));
}
