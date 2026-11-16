import * as vscode from "vscode";
import { message } from "./messages.js";
import { runtimeActions, type RuntimeAction } from "./runtime-tree.js";
import type { WorkspaceProjects } from "./workspace-projects.js";

/** Listing actions never opens metadata, validates settings or starts a debug session. */
export class RunDebugView implements vscode.TreeDataProvider<RuntimeAction>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly projects: WorkspaceProjects) {
    this.subscription = projects.onDidChange(() => this.changed.fire());
  }

  async getChildren(): Promise<RuntimeAction[]> {
    await this.projects.settled();
    return this.projects.folders.length ? runtimeActions() : [];
  }

  getTreeItem(action: RuntimeAction): vscode.TreeItem {
    const title = message(vscode.env.language, action.title);
    const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
    item.id = action.command;
    item.iconPath = new vscode.ThemeIcon(action.icon);
    item.command = { command: action.command, title };
    return item;
  }

  dispose(): void { this.subscription.dispose(); this.changed.dispose(); }
}
