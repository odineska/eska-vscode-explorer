import * as vscode from "vscode";
import { sourceKey } from "./source.js";

// Public subset of vscode.git API v1; never depend on its internal Resource implementation.
export interface GitChange { readonly uri: vscode.Uri; readonly originalUri: vscode.Uri; readonly renameUri?: vscode.Uri; readonly status: number }
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly kind?: "repository" | "submodule" | "worktree";
  readonly inputBox: { value: string };
  readonly state: { readonly HEAD?: { readonly commit?: string; readonly name?: string }; readonly indexChanges: readonly GitChange[]; readonly workingTreeChanges: readonly GitChange[];
    readonly mergeChanges: readonly GitChange[]; readonly untrackedChanges?: readonly GitChange[]; readonly onDidChange: vscode.Event<void>; readonly worktrees?: readonly { readonly main: boolean; readonly path: string }[] };
  status(): Promise<void>;
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  clean(paths: string[]): Promise<void>;
}
export interface GitApi {
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidCloseRepository: vscode.Event<GitRepository>;
  getRepository(uri: vscode.Uri): GitRepository | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}
interface GitExtension { enabled: boolean; onDidChangeEnablement: vscode.Event<boolean>; getAPI(version: 1): GitApi }

/** One optional built-in Git connection shared by metadata decorations and the SCM view. */
export class GitRepositories implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private apiSubscriptions: vscode.Disposable[] = [];
  private readonly watched = new Map<string, { repository: GitRepository; subscription: vscode.Disposable }>();
  private disposed = false;
  api: GitApi | undefined;

  constructor() { void this.attach(); }

  /** Public Git API getters create new wrappers; keep one handle per open repository lifetime. */
  get repositories(): readonly GitRepository[] { return [...this.watched.values()].map(value => value.repository); }

  private async attach(): Promise<void> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
      if (!extension) return;
      const git = await extension.activate();
      if (this.disposed) return;
      const enable = (): void => {
        this.clear();
        this.api = git.enabled ? git.getAPI(1) : undefined;
        if (this.api) {
          for (const repository of this.api.repositories) this.watch(repository);
          this.apiSubscriptions.push(this.api.onDidOpenRepository(repository => { this.watch(repository); this.changed.fire(); }));
          this.apiSubscriptions.push(this.api.onDidCloseRepository(repository => {
            const key = sourceKey(repository.rootUri.fsPath);
            this.watched.get(key)?.subscription.dispose(); this.watched.delete(key); this.changed.fire();
          }));
        }
        this.changed.fire();
      };
      this.subscriptions.push(git.onDidChangeEnablement(enable));
      enable();
    } catch { /* Git is optional; metadata stays available when it cannot activate. */ }
  }

  private watch(repository: GitRepository): void {
    const key = sourceKey(repository.rootUri.fsPath);
    if (!this.watched.has(key)) this.watched.set(key, { repository, subscription: repository.state.onDidChange(() => this.changed.fire()) });
  }

  private clear(): void {
    for (const subscription of this.apiSubscriptions.splice(0)) subscription.dispose();
    for (const value of this.watched.values()) value.subscription.dispose();
    this.watched.clear(); this.api = undefined;
  }

  dispose(): void {
    this.disposed = true; this.clear();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.changed.dispose();
  }
}
