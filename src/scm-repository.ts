import * as vscode from "vscode";
import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { Status } from "./git-status.js";
import { SCM_EMPTY } from "./scm-actions.js";
import type { GitRepository } from "./git-api.js";
import { parseHistoryPage, type HistoryPage } from "./scm-history-page.js";
import { parseScmSnapshot, type ScmMonitorSnapshot } from "./scm-monitor.js";
import { isRecord, MAX_RESPONSE } from "./protocol.js";
import { nativePath, sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import { findTool } from "./tooling/inspect.js";
import { runtimeJson } from "./runtime-tools.js";
import type { MessageKey } from "./messages.js";
import { parseBranchRefs, type BranchRef, type BranchAction } from "./scm-branch-model.js";

export const SCM_SCHEME = "eska-scm";
export const SCM_CHECKOUT = "eska.explorer.scm.checkout";
type Text = (key: MessageKey, ...values: string[]) => string;
type Revision = "head" | "index" | "base" | "ours" | "theirs" | "empty";
export interface ScmStageLinesRequest {
  schema_version: 1;
  index_sha256: string;
  worktree_sha256: string;
  side: "index" | "worktree";
  ranges: readonly { start: number; end: number }[];
}
export interface BranchSwitchResult { saved: boolean; restored: boolean }
class ScmBridgeError extends Error {
  constructor(readonly code: string) { super(code); }
}
const bridgeErrorMessages: Readonly<Record<string, MessageKey | undefined>> = {
  git_unavailable: "scmBranchGitUnavailable", branch_invalid: "scmBranchInvalid", branch_not_found: "scmBranchMissing",
  branch_exists: "scmBranchExists",
  references: "scmBranchReferences", checkout_failed: "scmBranchCheckoutFailed",
};
const switchErrorMessages: Readonly<Record<string, MessageKey | undefined>> = {
  ...bridgeErrorMessages,
  "branch-invalid": "scmBranchInvalid", "branch-missing": "scmBranchMissing",
  "target-checked-out": "scmBranchOccupied", command: "scmBranchCheckoutFailed", locked: "scmBranchLocked",
  "in-progress": "scmBranchOperation", detached: "scmBranchShelfOwner", unborn: "scmBranchShelfOwner",
  "invalid-shelf": "scmBranchShelfBlocked", "shelf-exists": "scmBranchShelfBlocked", "shelf-missing": "scmBranchShelfBlocked",
  "wrong-branch": "scmBranchShelfBlocked", "moved-branch": "scmBranchShelfBlocked", collision: "scmBranchShelfBlocked",
  incomplete: "scmBranchShelfBlocked", dirty: "scmBranchShelfBlocked", "unsupported-index": "scmBranchShelfBlocked",
};
const lineStageErrors: Readonly<Record<string, MessageKey | undefined>> = {
  stale_status: "scmLineStageChanged", path: "scmLineStageChanged", ignored: "scmLineStageChanged",
  empty_selection: "scmLineStageEmpty", ambiguous_lines: "scmLineStageUneven", unsupported_text: "scmLineStageUnsupported",
  conflict: "scmLineStageConflict", index_locked: "scmLineStageLocked", oversize: "scmLineStageSize",
  input_limit: "scmLineStageSize",
};

/** Never interpret human output or invoke a shell for repository operations. */
export async function scmBridge(executable: string, root: string, operation: string, args: string[] = [], signal?: AbortSignal, input?: unknown, timeout = 30_000): Promise<Record<string, unknown>> {
  const value = await runtimeJson(executable, ["--project-dir", root, "__bridge", operation, ...args], { timeout, maxOutputBytes: MAX_RESPONSE, signal, input, resultExitCodes: [1] });
  if (!isRecord(value) || value.schema_version !== 1 || value.operation !== operation.replaceAll("-", "_")) throw new Error("Invalid SCM bridge response");
  if (typeof value.error === "string") throw new ScmBridgeError(value.error);
  if (value.error !== null || !isRecord(value.data)) throw new Error("Invalid SCM bridge response");
  return value.data;
}

/** Discover the Git root through a read-only backend capability probe. */
export async function discoverScmRoot(projectRoot: string, projectExecutable: string, signal?: AbortSignal): Promise<{
  root: string; executable: string; mutationsAvailable: boolean; branchesAvailable: boolean; lineStagingAvailable: boolean; branchActionsAvailable: boolean;
  safeSwitchAvailable: boolean; historyAvailable: boolean;
} | undefined> {
  try {
    const executable = await findTool("eska-vcs", "eska-vcs", dirname(projectExecutable));
    if (!executable || signal?.aborted) return;
    const data = await scmBridge(executable, projectRoot, "scm-root", [], signal);
    if (typeof data.root !== "string" || !["utf-8", "percent", "utf-16-percent"].includes(String(data.root_encoding))) return;
    const root = nativePath({ value: data.root, encoding: data.root_encoding as "utf-8" | "percent" | "utf-16-percent" });
    if (!isAbsolute(root) || sourceKey(root) !== sourceKey(projectRoot) && !relativeFile(root, projectRoot)) return;
    return { root, executable, mutationsAvailable: data.mutations_available === true,
      branchesAvailable: data.branches_available === true, lineStagingAvailable: data.line_staging_available === true,
      branchActionsAvailable: data.branch_actions_available === true, safeSwitchAvailable: data.safe_switch_available === true,
      historyAvailable: data.history_available === true };
  } catch { return; }
}

export class EskaRepository implements GitRepository, vscode.Disposable {
  readonly scmProvider = "eska";
  kind?: NonNullable<GitRepository["kind"]>;
  historyAvailable = false;
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
  private draft = "";
  private readonly inputChanged = new vscode.EventEmitter<string>();
  readonly onDidChangeInput = this.inputChanged.event;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly abort = new AbortController();
  get isDisposed(): boolean { return this.abort.signal.aborted; }
  private readonly closed = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.closed.event;
  private current: ScmMonitorSnapshot | undefined;
  private sourceControl: vscode.SourceControl | undefined;
  get branchStatusEnabled(): boolean { return this.sourceControl !== undefined; }
  private pending: Promise<void> | undefined;
  private deferred: ScmMonitorSnapshot | undefined;
  private writing = false;
  private mutation: Promise<void> | undefined;
  private readonly blobs = new Map<string, Promise<Uint8Array>>();
  private cachedBytes = 0;
  private stamp = Date.now();
  get contentVersion(): number { return this.stamp; }
  readonly state: GitRepository["state"];
  constructor(root: string, readonly executable: string, private readonly text: Text, readonly mutationsAvailable = true, readonly branchesAvailable = false,
    private readonly cacheBlobs = true, readonly lineStagingAvailable = false, readonly branchActionsAvailable = false,
    readonly safeSwitchAvailable = false) {
    this.rootUri = vscode.Uri.file(root);
    const owner = this;
    this.inputBox = { get value() { return owner.draft; }, set value(value: string) {
      if (owner.draft === value) return;
      owner.draft = value; owner.inputChanged.fire(value);
    } };
    this.state = {
      get HEAD() { return owner.current ? { ...(owner.current.branch ? { name: owner.current.branch } : {}),
        ...(owner.current.commit ? { commit: owner.current.commit } : {}) } : {}; },
      get indexChanges() { return owner.current?.indexChanges ?? []; },
      get workingTreeChanges() {
        const snapshot = owner.current;
        if (!snapshot) return [];
        return owner.untrackedMode === "mixed" ? [...snapshot.workingTreeChanges, ...snapshot.untrackedChanges] : snapshot.workingTreeChanges;
      },
      get mergeChanges() { return owner.current?.mergeChanges ?? []; },
      get untrackedChanges() { return owner.untrackedMode === "separate" ? owner.current?.untrackedChanges ?? [] : []; },
      onDidChange: this.changed.event,
    };
  }
  /** Let VS Code select the active repository's status without another file watcher. */
  setBranchStatus(enabled: boolean): void {
    if (!enabled || this.abort.signal.aborted) {
      this.sourceControl?.dispose(); this.sourceControl = undefined; return;
    }
    if (!this.sourceControl) {
      this.sourceControl = vscode.scm.createSourceControl("eska", `ESKA: ${basename(this.rootUri.fsPath)}`, this.rootUri);
      this.sourceControl.inputBox.visible = false;
    }
    this.updateBranchStatus();
  }
  private updateBranchStatus(): void {
    if (!this.sourceControl) return;
    const snapshot = this.current;
    this.sourceControl.statusBarCommands = snapshot ? [{
      command: SCM_CHECKOUT,
      title: snapshot.branch ? `$(git-branch) ${snapshot.branch}` : `$(git-commit) ${snapshot.commit?.slice(0, 7) ?? this.text("scmBranchUnborn")}`,
      tooltip: `${this.text("scmCheckout")} — ${this.rootUri.fsPath}`,
      arguments: [this.rootUri.fsPath],
    }] : [];
  }
  async history(cursor: string | undefined, signal: AbortSignal): Promise<HistoryPage> {
    if (!this.historyAvailable) throw new Error(this.text("scmHistoryUpdateRequired"));
    const scope = AbortSignal.any([signal, this.abort.signal]);
    try {
      const args = cursor ? ["--cursor", cursor] : [];
      const data = await scmBridge(this.executable, this.rootUri.fsPath, "scm-history", args, scope, undefined, 0);
      scope.throwIfAborted();
      return parseHistoryPage(data);
    } catch (cause) {
      scope.throwIfAborted();
      if (cause instanceof ScmBridgeError && cause.code === "stale_cursor") {
        throw Object.assign(new Error(this.text("scmHistoryChanged")), { code: cause.code });
      }
      throw new Error(this.text("scmHistoryFailed"), { cause });
    }
  }
  async branches(): Promise<string[]> {
    if (!this.branchesAvailable) throw new Error(this.text("scmBranchUpdateRequired"));
    const data = await this.request("scm-branches");
    if (!Array.isArray(data.branches)) throw new Error(this.text("scmFailed"));
    const names: string[] = [];
    const seen = new Set<string>();
    for (const branch of data.branches) {
      if (!isRecord(branch) || typeof branch.name !== "string" || !["utf-8", "percent"].includes(String(branch.name_encoding))) throw new Error(this.text("scmFailed"));
      // Git permits non-UTF-8 refs on Unix, but checkout's argument is UTF-8.
      if (branch.name_encoding !== "utf-8") continue;
      if (!branch.name || /[\x00-\x20\x7f]/.test(branch.name) || seen.has(branch.name)) throw new Error(this.text("scmFailed"));
      seen.add(branch.name); names.push(branch.name);
    }
    return names;
  }
  async checkout(branch: string, validate?: () => void): Promise<BranchSwitchResult> {
    return this.switchBranch(async () => {
      const value = await runtimeJson(this.executable, ["--project-dir", this.rootUri.fsPath, "switch", "--format", "json", "--", branch],
        { timeout: 0, maxOutputBytes: MAX_RESPONSE });
      if (isRecord(value) && value.schema_version === 1 && value.status === "error" && isRecord(value.error)
        && typeof value.error.code === "string") throw this.switchFailure(value.error.code);
      if (!isRecord(value) || value.schema_version !== 1 || value.operation !== "switch" || value.dry_run !== false || value.branch !== branch
        || !(value.saved === null || isRecord(value.saved)) || !(value.restored === null || isRecord(value.restored))) {
        throw new Error(this.text("scmFailed"));
      }
      return { saved: value.saved !== null, restored: value.restored !== null };
    }, validate);
  }
  async branchRefs(): Promise<BranchRef[]> {
    if (!this.branchActionsAvailable) throw new Error(this.text("scmBranchUpdateRequired"));
    return parseBranchRefs(await this.request("scm-refs"));
  }
  async branchAction(action: BranchAction, validate?: () => void): Promise<BranchSwitchResult> {
    if (!this.branchActionsAvailable) throw new Error(this.text("scmBranchUpdateRequired"));
    if (action.target.kind === "local" && action.branch === undefined && !action.detached) return this.checkout(action.target.name, validate);
    const args = ["--kind", action.target.kind,
      ...(action.branch === undefined ? [] : ["--branch", action.branch]),
      ...(action.detached ? ["--detached"] : []), "--", action.target.name];
    return this.switchBranch(async () => {
      try {
        const data = await scmBridge(this.executable, this.rootUri.fsPath, "scm-switch", args, undefined, undefined, 0);
        return { saved: data.saved === true, restored: data.restored === true };
      } catch (cause) {
        if (cause instanceof ScmBridgeError) throw this.switchFailure(cause.code);
        throw new Error(this.text("scmFailed"), { cause });
      }
    }, validate);
  }
  private switchFailure(code: string): Error {
    const message = Object.hasOwn(switchErrorMessages, code) ? switchErrorMessages[code] : undefined;
    return new Error(this.text(message ?? "scmFailed"), { cause: new ScmBridgeError(code) });
  }
  private async switchBranch(run: () => Promise<BranchSwitchResult>, validate?: () => void): Promise<BranchSwitchResult> {
    if (!this.safeSwitchAvailable) throw new Error(this.text("scmBranchUpdateRequired"));
    if (!this.branchesAvailable) throw new Error(this.text("scmBranchGitUnavailable"));
    if (this.pending) await this.pending;
    if (this.writing || this.isDisposed) throw new Error(this.text("scmChanged"));
    validate?.();
    this.writing = true;
    let outcome: BranchSwitchResult = { saved: false, restored: false };
    const task = async (): Promise<void> => {
      try {
        // Let the checkout and its shelf transaction finish even if the view closes.
        outcome = await run();
      } finally {
        try { if (!this.isDisposed) await this.refreshStatus(); }
        catch { /* The resident monitor can refresh independently of the completed transaction. */ }
        this.writing = false; this.mutation = undefined;
      }
    };
    this.mutation = task();
    await this.mutation;
    return outcome;
  }
  private get untrackedMode(): string {
    return vscode.workspace.getConfiguration("git", this.rootUri).get<string>("untrackedChanges", "mixed");
  }
  accept(snapshot: ScmMonitorSnapshot): void {
    if (this.abort.signal.aborted) return;
    if (this.pending || this.writing) { this.deferred = snapshot; return; }
    this.publish(snapshot);
  }
  private publish(snapshot: ScmMonitorSnapshot): void {
    if (this.abort.signal.aborted || snapshot === this.current) return;
    this.current = snapshot; this.updateBranchStatus(); this.invalidateContent();
  }
  invalidateContent(): void {
    if (this.abort.signal.aborted) return;
    this.blobs.clear(); this.cachedBytes = 0;
    this.stamp = Math.max(Date.now(), this.stamp + 1); this.changed.fire();
  }
  status(): Promise<void> {
    return this.mutation ?? this.refreshStatus();
  }
  private refreshStatus(): Promise<void> {
    if (this.pending) return this.pending;
    // A resident update received while a request is in flight must not disappear.
    // Reconcile once after that event, never loop under continuous file activity.
    this.deferred = undefined;
    const request = async (): Promise<void> => {
      try {
        let snapshot = parseScmSnapshot(await this.request("scm-status"), this.rootUri.fsPath);
        if (this.deferred) {
          this.deferred = undefined;
          snapshot = parseScmSnapshot(await this.request("scm-status"), this.rootUri.fsPath);
        }
        this.publish(this.deferred ?? snapshot);
      } catch (error) {
        if (this.deferred) this.publish(this.deferred);
        throw error;
      } finally { this.deferred = undefined; }
    };
    this.pending = request().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  add(paths: string[]): Promise<void> { return this.files("stage", paths); }
  revert(paths: string[]): Promise<void> { return this.files("unstage", paths); }
  clean(paths: string[]): Promise<void> { return this.files("discard", paths); }
  async stageLines(uri: vscode.Uri, selection: ScmStageLinesRequest, validate: () => void): Promise<void> {
    if (!this.lineStagingAvailable) throw new Error(this.text("scmLineStageChanged"));
    const path = this.path(uri);
    if (this.pending) await this.pending;
    if (this.writing) throw new Error(this.text("scmBusy"));
    validate();
    this.writing = true;
    const task = async (): Promise<void> => {
      try {
        try { await this.request("scm-stage-lines", ["--", path], selection); }
        catch (cause) {
          if (cause instanceof Error && cause.cause instanceof ScmBridgeError && cause.cause.code === "stale_status") {
            try { await this.refreshStatus(); } catch { /* Preserve the stale selection error. */ }
          }
          throw cause;
        }
        await this.refreshStatus();
      } finally { this.writing = false; this.mutation = undefined; }
    };
    this.mutation = task();
    await this.mutation;
  }
  private path(uri: vscode.Uri): string {
    const path = uri.scheme === "file" ? relativeFile(this.rootUri.fsPath, uri.fsPath) : undefined;
    if (!path || path.includes("\0")) throw new Error(this.text("scmChanged"));
    return path.split(sep).join("/");
  }
  private async files(action: string, paths: string[]): Promise<void> {
    if (!this.mutationsAvailable) throw new Error(this.text("scmFailed"));
    const relative = [...new Set(paths.map(path => this.path(vscode.Uri.file(path))))];
    if (!relative.length) return;

    // Drain a pre-existing status before writing so it cannot serve as the post-write refresh.
    if (this.pending) await this.pending;
    if (this.writing) throw new Error(this.text("scmChanged"));
    const batches = this.fileBatches(action, relative);
    this.writing = true;
    const task = async (): Promise<void> => {
      let completed = 0;
      try {
        try {
          for (const batch of batches) {
            await this.request("scm-files", [action, "--paths-stdin"], batch);
            completed++;
          }
        } catch (cause) {
          // A later batch may fail after earlier writes. Refresh once and preserve the failure.
          try { await this.refreshStatus(); } catch { /* The original mutation error is actionable. */ }
          if (completed > 0) throw new Error(this.text("scmPartialFiles"), { cause });
          throw cause;
        }
        await this.refreshStatus();
      } finally { this.writing = false; this.mutation = undefined; }
    };
    this.mutation = task();
    await this.mutation;
  }
  private fileBatches(action: string, paths: string[]): string[][] {
    if (paths.length <= 2048 && Buffer.byteLength(JSON.stringify(paths), "utf8") <= 262_144) return [paths];
    const keyOf = (path: string): string => sourceKey(join(this.rootUri.fsPath, path));
    const remaining = new Map(paths.map(path => [keyOf(path), path]));
    const partners = new Map<string, string>();
    if (action === "unstage") {
      // Snapshot validation guarantees unique, disjoint rename pairs. The backend
      // expands either endpoint, so selected partners must not land in another batch.
      for (const change of this.current?.indexChanges ?? []) {
        if (change.status !== Status.IndexRenamed) continue;
        const from = sourceKey(change.originalUri.fsPath), to = sourceKey(change.uri.fsPath);
        partners.set(from, to); partners.set(to, from);
      }
    }
    const batches: string[][] = [];
    let batch: string[] = [], bytes = 2;
    for (const path of paths) {
      const key = keyOf(path);
      if (!remaining.delete(key)) continue;
      const group = [path], partner = partners.get(key), selected = partner === undefined ? undefined : remaining.get(partner);
      if (selected !== undefined) { group.push(selected); remaining.delete(partner!); }
      const encoded = group.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value), "utf8") + 1, 0);
      if (encoded + 1 > 262_144) throw new Error(this.text("scmFailed"));
      if (batch.length && (batch.length + group.length > 2048 || bytes + encoded - 1 > 262_144)) {
        batches.push(batch); batch = []; bytes = 2;
      }
      batch.push(...group); bytes += encoded;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  private async request(operation: string, args: string[] = [], input?: unknown): Promise<Record<string, unknown>> {
    if (this.abort.signal.aborted) throw new Error(this.text("scmChanged"));
    try {
      const data = await scmBridge(this.executable, this.rootUri.fsPath, operation, args, this.abort.signal, input);
      if (this.abort.signal.aborted) throw new Error(this.text("scmChanged"));
      return data;
    } catch (cause) {
      const messages = operation === "scm-stage-lines" ? lineStageErrors : bridgeErrorMessages;
      const key = cause instanceof ScmBridgeError && Object.hasOwn(messages, cause.code) ? messages[cause.code] : undefined;
      throw new Error(this.text(key ?? "scmFailed"), { cause });
    }
  }
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
    this.path(uri);
    const revision = revisionForRef(ref);
    return uri.with({ scheme: SCM_SCHEME, query: JSON.stringify({ root: this.rootUri.fsPath, revision }), fragment: "" });
  }
  readBlob(uri: vscode.Uri, revision: Revision): Promise<Uint8Array> {
    const path = this.path(uri), key = `${revision}:${path}`;
    if (revision === "empty") return Promise.resolve(new Uint8Array());
    const existing = this.blobs.get(key);
    if (existing) return existing;
    if (this.blobs.size >= 64) { this.blobs.clear(); this.cachedBytes = 0; }
    const request = this.request("scm-blob", ["--revision", revision, "--", path]).then(data => {
      if (data.content === null) return new Uint8Array();
      if (typeof data.content !== "string" || data.content.length > 44_739_244 || data.content.length % 4 !== 0) throw new Error(this.text("scmFailed"));
      // Native decoding plus canonical re-encoding is linear and has no regexp backtracking stack.
      const bytes = Buffer.from(data.content, "base64");
      if (bytes.length > 33_554_432 || bytes.toString("base64") !== data.content) throw new Error(this.text("scmFailed"));
      if (this.cacheBlobs && this.blobs.get(key) === request) {
        this.cachedBytes += bytes.length;
        if (this.cachedBytes > 33_554_432) {
          this.blobs.clear(); this.cachedBytes = bytes.length; this.blobs.set(key, request);
        }
      }
      return bytes;
    });
    this.blobs.set(key, request);
    const remove = (): void => { if (this.blobs.get(key) === request) this.blobs.delete(key); };
    void request.then(() => { if (!this.cacheBlobs) remove(); }, remove);
    return request;
  }
  dispose(): void {
    this.setBranchStatus(false);
    this.abort.abort(); this.blobs.clear(); this.closed.fire(); this.closed.dispose();
    this.changed.dispose(); this.inputChanged.dispose();
  }
}

export function revisionForRef(ref: string): Revision {
  switch (ref) {
    case "HEAD": return "head";
    case "": case "~": return "index";
    case "~1": return "base";
    case "~2": return "ours";
    case "~3": return "theirs";
    case SCM_EMPTY: return "empty";
    default: throw new Error("Unsupported SCM revision");
  }
}

/** Raw bytes preserve BOMs, legacy encodings and binary files in the normal diff editor. */
export class EskaScmFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  private readonly repositories = new Map<EskaRepository, { subscription: vscode.Disposable; uris: Map<string, vscode.Uri> }>();
  constructor(private readonly resolve: (root: string) => EskaRepository | undefined | Promise<EskaRepository | undefined>) {}
  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  private async target(uri: vscode.Uri): Promise<{ repository: EskaRepository; revision: Revision; file: vscode.Uri }> {
    try {
      if (uri.scheme !== SCM_SCHEME || uri.fragment) throw new Error();
      const query: unknown = JSON.parse(uri.query);
      if (!isRecord(query) || typeof query.root !== "string" || !isAbsolute(query.root) || query.root.includes("\0")
        || !["head", "index", "base", "ours", "theirs", "empty"].includes(String(query.revision))) throw new Error();
      const file = uri.with({ scheme: "file", query: "", fragment: "" });
      if (!relativeFile(query.root, file.fsPath)) throw new Error();
      const repository = await this.resolve(query.root);
      if (!repository || sourceKey(repository.rootUri.fsPath) !== sourceKey(query.root)) throw new Error();
      if (repository.isDisposed) return { repository, revision: query.revision as Revision, file };
      let watched = this.repositories.get(repository);
      if (!watched) {
        const uris = new Map<string, vscode.Uri>();
        const changed = repository.state.onDidChange(() => {
          this.changes.fire([...uris.values()].map(uri => ({ type: vscode.FileChangeType.Changed, uri })));
        });
        const closed = repository.onDidDispose(() => {
          this.repositories.delete(repository); changed.dispose();
          // Ownership can change while the saved URI still names a real Git blob.
          this.changes.fire([...uris.values()].map(uri => ({ type: vscode.FileChangeType.Changed, uri })));
        });
        watched = { uris, subscription: { dispose() { closed.dispose(); changed.dispose(); } } };
        this.repositories.set(repository, watched);
      }
      const key = `${query.revision}:${file.fsPath}`;
      if (watched.uris.size >= 128 && !watched.uris.has(key)) watched.uris.delete(watched.uris.keys().next().value!);
      watched.uris.set(key, uri);
      return { repository, revision: query.revision as Revision, file };
    } catch { throw vscode.FileSystemError.FileNotFound(uri); }
  }
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return (await this.content(uri)).content;
  }
  private async content(uri: vscode.Uri): Promise<{ repository: EskaRepository; content: Uint8Array }> {
    const { repository, revision, file } = await this.target(uri);
    try { return { repository, content: await repository.readBlob(file, revision) }; }
    catch (error) {
      if (!repository.isDisposed) throw error;
      // A mode transition may close the hot owner while the saved blob is still valid.
      const next = await this.target(uri);
      return { repository: next.repository, content: await next.repository.readBlob(next.file, next.revision) };
    }
  }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { repository, content } = await this.content(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: repository.contentVersion, size: content.length, permissions: vscode.FilePermission.Readonly };
  }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): never { throw vscode.FileSystemError.NoPermissions(); }
  writeFile(): never { throw vscode.FileSystemError.NoPermissions(); }
  delete(): never { throw vscode.FileSystemError.NoPermissions(); }
  rename(): never { throw vscode.FileSystemError.NoPermissions(); }
  dispose(): void { for (const { subscription } of this.repositories.values()) subscription.dispose(); this.repositories.clear(); this.changes.dispose(); }
}
