import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

import type { HistoryCommit, HistoryPage } from "./scm-history-page.js";

export interface HistoryRepository { id: string; label: string }
export interface HistoryProvider {
  repositories(): readonly HistoryRepository[];
  history(repositoryId: string, cursor: string | undefined, signal: AbortSignal): Promise<HistoryPage>;
  readonly onDidChange: vscode.Event<void>;
}
export type HistoryLabel = "title" | "repository" | "loadMore" | "loading" | "empty" | "noRepositories" | "retry" | "commit" | "author" | "date" | "hash" | "parents";
export type HistoryLabels = Record<HistoryLabel, string>;

/** A read-only graph remains independent of proposed VS Code SCM graph APIs. */
export class ScmHistoryView implements vscode.WebviewViewProvider, vscode.Disposable {
  private panel: vscode.WebviewView | undefined;
  private readonly subscription: vscode.Disposable;
  private panelSubscriptions: vscode.Disposable[] = [];
  private repository: string | undefined;
  private readonly seen = new Set<string>();
  private cursor: string | null = null;
  private generation = 0;
  private busy = false;
  private controller: AbortController | undefined;
  private disposed = false;
  private error: string | undefined;
  private pendingReset = true;

  constructor(private readonly extensionUri: vscode.Uri, private readonly provider: HistoryProvider, private readonly labels: HistoryLabels) {
    this.subscription = provider.onDidChange(() => this.refresh());
  }

  resolveWebviewView(panel: vscode.WebviewView): void {
    if (this.disposed) return;
    this.generation++; this.controller?.abort();
    for (const subscription of this.panelSubscriptions.splice(0)) subscription.dispose();
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out")] };
    this.panel = panel;
    const nonce = randomBytes(16).toString("hex");
    const resource = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "out", file));
    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; form-action 'none'"><link rel="stylesheet" href="${resource("scm-history.css")}"></head><body><main id="root" class="history-root"></main><script nonce="${nonce}" src="${resource("scm-history.js")}"></script></body></html>`;
    this.panelSubscriptions = [panel.onDidChangeVisibility(() => {
      if (this.panel !== panel) return;
      if (panel.visible) this.refresh();
      else { this.generation++; this.controller?.abort(); this.busy = false; }
    }), panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.panel = undefined; this.generation++; this.controller?.abort(); this.busy = false;
      for (const subscription of this.panelSubscriptions.splice(0)) subscription.dispose();
    }), panel.webview.onDidReceiveMessage((value: unknown) => {
      if (!value || typeof value !== "object" || !("type" in value)) return;
      const request = value as { type: unknown; repository?: unknown };
      if (request.type === "ready" || request.type === "refresh") this.refresh();
      else if (request.type === "more" && this.cursor && !this.busy) void this.load(this.cursor);
      else if (request.type === "repository" && typeof request.repository === "string" && this.provider.repositories().some(repo => repo.id === request.repository)) {
        this.repository = request.repository; this.refresh();
      }
    })];
  }

  refresh(): void {
    if (this.disposed || !this.panel?.visible) return;
    this.generation++; this.controller?.abort();
    const repositories = this.provider.repositories();
    if (!repositories.some(repo => repo.id === this.repository)) this.repository = repositories[0]?.id;
    this.pendingReset = true;
    this.seen.clear(); this.cursor = null; this.error = undefined; this.busy = false;
    if (this.repository) void this.load(undefined); else this.publish();
  }

  private async load(cursor: string | undefined): Promise<void> {
    const repository = this.repository;
    if (!repository || !this.panel?.visible || this.disposed) return;
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    const generation = ++this.generation;
    this.busy = true; this.error = undefined; this.publish();
    let added: HistoryCommit[] | undefined;
    try {
      const page = await this.provider.history(repository, cursor, controller.signal);
      if (this.disposed || generation !== this.generation || !this.panel) return;
      added = page.commits.filter(commit => {
        if (this.seen.has(commit.id)) return false;
        this.seen.add(commit.id);
        return true;
      });
      this.cursor = page.next_cursor;
    } catch (error) {
      if (this.disposed || generation !== this.generation || !this.panel) return;
      if (cursor && error instanceof Error && "code" in error && error.code === "stale_cursor") { this.refresh(); return; }
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.disposed && generation === this.generation && this.panel) { this.busy = false; this.publish(added); }
    }
  }

  private publish(append?: HistoryCommit[]): void {
    const reset = this.pendingReset; this.pendingReset = false;
    void this.panel?.webview.postMessage({ type: "state", reset, ...(append ? { append } : {}), labels: this.labels, repositories: this.provider.repositories(), repository: this.repository,
      more: this.cursor !== null, busy: this.busy, error: this.error });
  }

  dispose(): void {
    this.disposed = true; this.generation++; this.controller?.abort(); this.subscription.dispose(); this.panel = undefined;
    for (const subscription of this.panelSubscriptions.splice(0)) subscription.dispose();
  }
}
