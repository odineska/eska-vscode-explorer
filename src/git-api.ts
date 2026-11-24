import * as vscode from "vscode";
import { relative, isAbsolute } from "node:path";
import type { MessageKey } from "./messages.js";
import { discoverScmRoot, EskaRepository, EskaScmFileSystemProvider, SCM_SCHEME, SCM_CHECKOUT } from "./scm-repository.js";
import { ScmMonitors } from "./scm-monitor.js";
import { sourceKey } from "./source.js";

// Public subset of vscode.git API v1; never depend on its internal Resource implementation.
export interface GitChange { readonly uri: vscode.Uri; readonly originalUri: vscode.Uri; readonly renameUri?: vscode.Uri; readonly status: number }
export interface GitRepository {
  readonly scmProvider?: "eska";
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
interface GitExtension { enabled: boolean; onDidChangeEnablement: vscode.Event<boolean>; getAPI(version: 1): GitApi & { openRepository(root: vscode.Uri): Promise<GitRepository | null> } }

export type ScmMode = "eska" | "vscode" | "both";
export interface ScmProject { root: string; projectExecutable: string; mode: ScmMode }
interface ScmCheckout { root: string; executable: string; mutationsAvailable: boolean; branchesAvailable: boolean; supported: boolean; projects: ScmProject[] }
type Text = (key: MessageKey, ...values: string[]) => string;
const RECOVERY_KEY = "eska.scm.closedRepositories.v1";
export function containsScmRoot(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value);
}
/** A stable facade joins optional native Git with repositories owned by ESKA. */
export class GitRepositories implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<GitRepository | undefined>();
  readonly onDidChange = this.changed.event;
  private readonly opened = new vscode.EventEmitter<GitRepository>();
  private readonly closed = new vscode.EventEmitter<GitRepository>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private nativeSubscriptions: vscode.Disposable[] = [];
  private native: ReturnType<GitExtension["getAPI"]> | undefined;
  private readonly natives = new Map<string, GitRepository>();
  private readonly own = new Map<string, EskaRepository>();
  private readonly watches = new Map<GitRepository, vscode.Disposable>();
  private visible = new Map<string, GitRepository>();
  private projects: readonly ScmProject[] = [];
  private modes = new Map<string, ScmMode>();
  private projectsConfigured = false;
  private readonly discoveries = new Map<string, Awaited<ReturnType<typeof discoverScmRoot>>>();
  private context: vscode.ExtensionContext | undefined;
  private text: Text = key => key;
  private log: (message: string) => void = () => {};
  private recovery = new Set<string>();
  private readonly drafts = new Map<string, string>();
  private readonly monitors: ScmMonitors;
  private readonly monitorWaiters = new Map<string, (ready: boolean) => void>();
  private readonly failedMonitors = new Set<string>();
  private generation = 0;
  private abort = new AbortController();
  private pending: Promise<void> = Promise.resolve();
  private storagePending: Promise<void> = Promise.resolve();
  private signature = "";
  private releasing = false;
  private disposed = false;
  readonly api: GitApi;
  constructor() {
    this.monitors = new ScmMonitors(root => {
      const key = sourceKey(root), snapshot = this.monitors.get(root);
      if (snapshot) { this.own.get(key)?.accept(snapshot); this.monitorWaiters.get(key)?.(true); }
      else { this.failedMonitors.add(key); this.monitorWaiters.get(key)?.(false); this.schedule(); }
    }, message => this.log(message));
    const owner = this;
    this.api = {
      get repositories() { return owner.repositories; }, onDidOpenRepository: this.opened.event, onDidCloseRepository: this.closed.event,
      getRepository(uri) { return owner.repositories.filter(repository => containsScmRoot(repository.rootUri.fsPath, uri.fsPath))
        .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0] ?? null; },
      toGitUri(uri, ref) {
        const repository = owner.api.getRepository(uri);
        if (repository instanceof EskaRepository) return repository.toGitUri(uri, ref);
        if (owner.native) return owner.native.toGitUri(uri, ref);
        throw new Error(owner.text("scmChanged"));
      },
    };
    void this.attach();
  }
  get repositories(): readonly GitRepository[] { return [...this.visible.values()]; }
  configureScm(context: vscode.ExtensionContext, text: Text, log: (message: string) => void): void {
    this.context = context; this.text = text; this.log = log;
    const recovery = context.workspaceState.get<unknown[]>(RECOVERY_KEY, []);
    for (const value of recovery) {
      if (typeof value === "string") this.recovery.add(value);
      else if (value && typeof value === "object" && "root" in value && typeof value.root === "string") {
        this.recovery.add(value.root);
        if ("draft" in value && typeof value.draft === "string") this.drafts.set(sourceKey(value.root), value.draft);
      }
    }
    const provider = new EskaScmFileSystemProvider(root => this.own.get(sourceKey(root)));
    this.subscriptions.push(provider, vscode.workspace.registerFileSystemProvider(SCM_SCHEME, provider, { isReadonly: true, isCaseSensitive: process.platform !== "win32" }),
      vscode.commands.registerCommand(SCM_CHECKOUT, (root: unknown) => this.checkout(root)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("git.enabled") || event.affectsConfiguration("git.ignoredRepositories")) this.schedule();
      }), vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.schedule()));
    this.schedule();
  }
  private async checkout(root: unknown): Promise<void> {
    if (typeof root !== "string") return;
    const key = sourceKey(root), repository = this.own.get(key), generation = this.generation;
    const active = (): boolean => !this.disposed && !this.releasing && generation === this.generation && vscode.workspace.isTrusted !== false
      && this.own.get(key) === repository && this.visible.get(key) === repository && this.modes.get(key) === "eska"
      && repository?.branchStatusEnabled === true;
    if (!repository || !active()) return;
    try {
      const branches = await repository.branches();
      if (!active()) return;
      if (!branches.length) { void vscode.window.showInformationMessage(this.text("scmBranchEmpty")); return; }
      const branch = await vscode.window.showQuickPick(branches.map(name => ({ label: name, name,
        ...(name === repository.state.HEAD?.name ? { description: this.text("scmBranchCurrent") } : {}) })), {
        title: `${this.text("scmCheckout")} — ${repository.rootUri.fsPath}`,
        placeHolder: this.text("scmBranchSelect"),
      });
      // A picker can outlive its repository or an ownership/mode transition.
      if (!branch || !active() || !branches.includes(branch.name)) return;
      if (branch.name === repository.state.HEAD?.name) return;
      const dirty = vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === "file"
        && containsScmRoot(repository.rootUri.fsPath, document.uri.fsPath));
      if (dirty) { void vscode.window.showWarningMessage(this.text("scmBranchDirty")); return; }
      await repository.checkout(branch.name);
    } catch (error) {
      this.log(String(error instanceof Error && error.cause ? error.cause : error));
      if (active()) void vscode.window.showErrorMessage(!repository.branchesAvailable ? this.text("scmBranchUpdateRequired")
        : error instanceof Error ? error.message : this.text("scmFailed"));
    }
  }
  setScmProjects(projects: readonly ScmProject[]): void {
    const signature = JSON.stringify(projects);
    if (this.projectsConfigured && signature === this.signature) return;
    this.projectsConfigured = true;
    this.failedMonitors.clear(); this.signature = signature; this.projects = projects.map(project => ({ ...project }));
    const retained = new Set(projects.map(project => this.discoveryKey(project)));
    for (const key of this.discoveries.keys()) if (!retained.has(key)) this.discoveries.delete(key);
    this.schedule();
  }
  modeFor(root: string): ScmMode | undefined { return this.modes.get(sourceKey(root)); }
  /** Explicit refresh retries terminal sessions and tools installed at an unchanged path. */
  retryScm(): void {
    if (!this.projectsConfigured) return;
    this.failedMonitors.clear(); this.discoveries.clear(); this.schedule();
  }
  private discoveryKey(project: ScmProject): string { return JSON.stringify([sourceKey(project.root), project.projectExecutable]); }
  private schedule(): void {
    if (this.disposed || this.releasing) return;
    const generation = ++this.generation;
    this.abort.abort(); this.abort = new AbortController();
    this.pending = this.pending.catch(error => this.log(String(error))).then(() => this.reconcile(generation)).catch(error => this.log(String(error)));
  }
  private persist(): Promise<void> {
    const values = [...this.recovery].map(root => ({ root, draft: this.own.get(sourceKey(root))?.inputBox.value ?? this.drafts.get(sourceKey(root)) ?? "" }));
    this.storagePending = this.storagePending.catch(error => this.log(String(error))).then(async () => {
      await this.context?.workspaceState.update(RECOVERY_KEY, values);
    });
    return this.storagePending;
  }
  private allowed(root: string): boolean {
    if (vscode.workspace.isTrusted === false) return false;
    const config = vscode.workspace.getConfiguration("git", vscode.Uri.file(root));
    if (config.get<boolean>("enabled", true) === false) return false;
    const ignored = vscode.workspace.getConfiguration("git").get<string[]>("ignoredRepositories", []);
    return !ignored.some(path => isAbsolute(path) ? sourceKey(path) === sourceKey(root)
      : (vscode.workspace.workspaceFolders ?? []).some(folder => sourceKey(vscode.Uri.joinPath(folder.uri, path).fsPath) === sourceKey(root)));
  }
  private async restore(root: string, draft?: string): Promise<void> {
    if (!this.recovery.has(root) || !this.native || !this.allowed(root)) return;
    const uri = vscode.Uri.file(root);
    let repository = await this.native.openRepository(uri);
    if (!repository) {
      // VS Code 1.109's API keeps the closed marker. The targeted command takes
      // a filesystem path and explicitly reopens that one checkout without a picker.
      await vscode.commands.executeCommand("git.openRepository", root);
      repository = this.native?.getRepository(uri) ?? null;
    }
    if (!repository || sourceKey(repository.rootUri.fsPath) !== sourceKey(root)) return;
    const message = draft ?? this.drafts.get(sourceKey(root));
    if (message !== undefined) repository.inputBox.value = message;
    this.recovery.delete(root); await this.persist();
  }
  private async collectCheckouts(generation: number): Promise<Map<string, ScmCheckout> | undefined> {
    const requested = vscode.workspace.isTrusted === false ? [] : this.projects;
    const roots = new Map<string, ScmCheckout>();
    for (const project of requested) {
      const discoveryKey = this.discoveryKey(project);
      let target = this.discoveries.get(discoveryKey);
      // Native-only mode never requires the ESKA CLI, including mode transitions.
      if (project.mode !== "vscode" && !this.discoveries.has(discoveryKey)) {
        target = await discoverScmRoot(project.root, project.projectExecutable, this.abort.signal);
        if (generation !== this.generation || this.releasing) return undefined;
        this.discoveries.set(discoveryKey, target);
      }
      // Older CLI versions still use the native repository, but only its exact owner
      // is associated with this configured project (never unrelated nested checkouts).
      const nativeOwner = [...this.natives.values()].filter(repository => containsScmRoot(repository.rootUri.fsPath, project.root))
        .sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
      const rememberedRoot = [...this.recovery].filter(root => containsScmRoot(root, project.root)).sort((a, b) => b.length - a.length)[0];
      const root = target?.root ?? nativeOwner?.rootUri.fsPath ?? rememberedRoot;
      if (!root) continue;
      const key = sourceKey(root), entry = roots.get(key);
      if (entry) {
        entry.projects.push(project);
        if (target) { entry.supported = true; entry.executable = target.executable; entry.mutationsAvailable = target.mutationsAvailable; entry.branchesAvailable = target.branchesAvailable; }
      } else roots.set(key, { root, executable: target?.executable ?? project.projectExecutable,
        mutationsAvailable: target?.mutationsAvailable ?? false, branchesAvailable: target?.branchesAvailable ?? false, supported: target !== undefined, projects: [project] });
    }
    return roots;
  }
  private checkoutModes(roots: ReadonlyMap<string, ScmCheckout>): Map<string, ScmMode> {
    const modes = new Map<string, ScmMode>();
    const knownRoots = [...roots.values()].map(target => target.root);
    knownRoots.push(...[...this.natives.values(), ...this.own.values()].map(repository => repository.rootUri.fsPath));
    for (const target of this.discoveries.values()) if (target) knownRoots.push(target.root);
    for (const [key, target] of roots) {
      const modesRequested = new Set(target.projects.map(project => project.mode));
      const shared = (vscode.workspace.workspaceFolders ?? []).some(folder => {
        const owner = knownRoots.filter(root => containsScmRoot(root, folder.uri.fsPath)).sort((a, b) => b.length - a.length)[0];
        return owner !== undefined && sourceKey(owner) === key
          && !target.projects.some(project => sourceKey(project.root) === sourceKey(folder.uri.fsPath) && project.mode === "eska");
      });
      const requestedMode = target.projects[0]?.mode ?? "both";
      modes.set(key, modesRequested.size === 1 && (requestedMode === "vscode" || !shared) ? requestedMode : "both");
    }
    return modes;
  }
  private async reconcile(generation: number): Promise<void> {
    if (!this.context || !this.projectsConfigured || generation !== this.generation || this.releasing) return;
    const roots = await this.collectCheckouts(generation);
    if (!roots || generation !== this.generation || this.releasing) return;
    const modes = this.checkoutModes(roots);
    const autonomous = (key: string): boolean => roots.get(key)?.supported === true
      && (!this.natives.has(key) || modes.get(key) === "eska" && roots.get(key)?.mutationsAvailable === true);
    this.monitors.synchronize([...roots.values()].filter(target => modes.get(sourceKey(target.root)) !== "vscode"
      && autonomous(sourceKey(target.root)) && !this.failedMonitors.has(sourceKey(target.root)))
      .map(target => ({ root: target.root, projectExecutable: target.projects[0]?.projectExecutable ?? target.executable })));
    const desired = new Set<string>();
    for (const [key, target] of roots) {
      if (generation !== this.generation || this.releasing) return;
      const mode = modes.get(key);
      if (mode === "vscode" || this.failedMonitors.has(key) || !autonomous(key)) continue;
      // Git opt-outs affect native recovery/takeover, never independent ESKA SCM.
      const native = this.natives.get(key);
      let repository = this.own.get(key);
      if (repository && (repository.executable !== target.executable || repository.mutationsAvailable !== target.mutationsAvailable
        || repository.branchesAvailable !== target.branchesAvailable)) { repository.dispose(); this.own.delete(key); repository = undefined; }
      if (!repository) {
        repository = new EskaRepository(target.root, target.executable, this.text, target.mutationsAvailable, target.branchesAvailable);
        repository.onDidChangeInput(value => {
          this.drafts.set(key, value);
          if (this.recovery.has(target.root)) void this.persist().catch(error => this.log(String(error)));
        });
        repository.inputBox.value = this.drafts.get(key) ?? "";
        this.own.set(key, repository);
        const ready = await this.monitorReady(target.root, repository, this.abort.signal);
        if (!ready || generation !== this.generation || this.releasing) {
          if (this.own.get(key) === repository) this.own.delete(key); repository.dispose();
          if (generation !== this.generation || this.releasing) return;
          continue;
        }
      }
      desired.add(key);
      if (native && mode === "eska" && target.mutationsAvailable && this.allowed(target.root)) {
        repository.inputBox.value = native.inputBox.value;
        // Mark before closing: a reload between these operations must remain recoverable.
        this.recovery.add(target.root); await this.persist();
        if (generation !== this.generation || this.releasing) return;
        const current = this.native?.getRepository(vscode.Uri.file(target.root));
        if (!current || sourceKey(current.rootUri.fsPath) !== key) {
          this.recovery.delete(target.root); await this.persist(); continue;
        }
        try { await vscode.commands.executeCommand("git.close", vscode.Uri.file(target.root)); }
        catch (error) { this.log(String(error)); }
        if (this.natives.has(key)) { this.recovery.delete(target.root); await this.persist(); }
      } else if (mode === "both") await this.restore(target.root, repository.inputBox.value);
    }
    if (generation !== this.generation || this.releasing) return;
    this.modes = modes;
    for (const root of [...this.recovery]) {
      const key = sourceKey(root);
      if (!desired.has(key) || modes.get(key) !== "eska") await this.restore(root, this.own.get(key)?.inputBox.value);
    }
    for (const [key, repository] of this.own) if (!desired.has(key)) { this.own.delete(key); repository.dispose(); }
    this.publish();
  }
  private monitorReady(root: string, repository: EskaRepository, signal: AbortSignal): Promise<boolean> {
    const snapshot = this.monitors.get(root);
    if (snapshot) { repository.accept(snapshot); return Promise.resolve(true); }
    if (signal.aborted || this.failedMonitors.has(sourceKey(root))) return Promise.resolve(false);
    return new Promise(resolve => {
      const key = sourceKey(root);
      const finish = (ready: boolean): void => {
        clearTimeout(timer); signal.removeEventListener("abort", cancel); this.monitorWaiters.delete(key); resolve(ready);
      };
      const cancel = (): void => finish(false);
      const timer = setTimeout(() => { this.failedMonitors.add(key); finish(false); this.schedule(); }, 30_000);
      this.monitorWaiters.set(key, finish); signal.addEventListener("abort", cancel, { once: true });
    });
  }
  private publish(): void {
    if (this.disposed) return;
    const next = new Map(this.natives);
    for (const [key, repository] of this.own) if (!next.has(key)) next.set(key, repository);
    for (const [key, previous] of this.visible) if (next.get(key) !== previous) {
      this.watches.get(previous)?.dispose(); this.watches.delete(previous); this.closed.fire(previous);
    }
    this.visible = next;
    for (const [key, repository] of this.own) repository.setBranchStatus(!this.releasing && this.modes.get(key) === "eska" && next.get(key) === repository);
    for (const repository of next.values()) if (!this.watches.has(repository)) {
      this.watches.set(repository, repository.state.onDidChange(() => this.changed.fire(repository))); this.opened.fire(repository);
    }
    this.changed.fire(undefined);
  }
  private async attach(): Promise<void> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
      if (!extension) return;
      const git = await extension.activate();
      if (this.disposed) return;
      const enable = (): void => {
        for (const subscription of this.nativeSubscriptions.splice(0)) subscription.dispose();
        this.natives.clear(); this.native = git.enabled ? git.getAPI(1) : undefined;
        if (this.native) {
          for (const repository of this.native.repositories) this.natives.set(sourceKey(repository.rootUri.fsPath), repository);
          this.nativeSubscriptions.push(this.native.onDidOpenRepository(repository => {
            const key = sourceKey(repository.rootUri.fsPath);
            if (this.natives.has(key)) return;
            this.natives.set(key, repository);
            // A newly initialized Git checkout can make a previous negative probe valid.
            for (const project of this.projects) {
              const discoveryKey = this.discoveryKey(project);
              if (containsScmRoot(repository.rootUri.fsPath, project.root) && this.discoveries.has(discoveryKey)
                && !this.discoveries.get(discoveryKey)) this.discoveries.delete(discoveryKey);
            }
            this.publish(); this.schedule();
          }), this.native.onDidCloseRepository(repository => {
            this.natives.delete(sourceKey(repository.rootUri.fsPath)); this.publish(); this.schedule();
          }));
        }
        this.publish(); this.schedule();
      };
      this.subscriptions.push(git.onDidChangeEnablement(enable)); enable();
    } catch (error) { this.log(String(error)); }
  }
  async releaseScm(): Promise<void> {
    this.releasing = true; this.generation++; this.abort.abort(); this.monitors.dispose();
    for (const repository of this.own.values()) repository.setBranchStatus(false);
    await this.pending.catch(error => this.log(String(error)));
    for (const root of [...this.recovery]) {
      try { await this.restore(root, this.own.get(sourceKey(root))?.inputBox.value); } catch (error) { this.log(String(error)); }
    }
    await this.storagePending.catch(error => this.log(String(error)));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++; this.abort.abort(); this.monitors.dispose();
    for (const subscription of [...this.subscriptions, ...this.nativeSubscriptions, ...this.watches.values()]) subscription.dispose();
    for (const repository of this.own.values()) repository.dispose();
    this.changed.dispose(); this.opened.dispose(); this.closed.dispose();
  }
}
