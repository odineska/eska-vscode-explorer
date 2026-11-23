import * as vscode from "vscode";
import { dirname, isAbsolute, join, sep } from "node:path";
import { Status } from "./git-status.js";
import type { GitRepository } from "./git-api.js";
import { parseScmSnapshot, type ScmMonitorSnapshot } from "./scm-monitor.js";
import { isRecord, MAX_RESPONSE } from "./protocol.js";
import { nativePath, sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import { findTool } from "./tooling/inspect.js";
import { runtimeJson } from "./runtime-tools.js";
import type { MessageKey } from "./messages.js";

export const SCM_SCHEME = "eska-scm";
type Text = (key: MessageKey, ...values: string[]) => string;
type Revision = "head" | "index" | "base" | "ours" | "theirs";

/** Never interpret human output or invoke a shell for repository operations. */
export async function scmBridge(executable: string, root: string, operation: string, args: string[] = [], signal?: AbortSignal, input?: unknown): Promise<Record<string, unknown>> {
  const value = await runtimeJson(executable, ["--project-dir", root, "__bridge", operation, ...args], { timeout: 30_000, maxOutputBytes: MAX_RESPONSE, signal, input });
  if (!isRecord(value) || value.schema_version !== 1 || value.operation !== operation.replaceAll("-", "_")
    || value.error !== null || !isRecord(value.data)) throw new Error("Invalid SCM bridge response");
  return value.data;
}

/** Discover the Git root through a read-only backend capability probe. */
export async function discoverScmRoot(projectRoot: string, projectExecutable: string, signal?: AbortSignal): Promise<{ root: string; executable: string; mutationsAvailable: boolean } | undefined> {
  try {
    const executable = await findTool("eska-vcs", "eska-vcs", dirname(projectExecutable));
    if (!executable || signal?.aborted) return;
    const data = await scmBridge(executable, projectRoot, "scm-root", [], signal);
    if (typeof data.root !== "string" || !["utf-8", "percent", "utf-16-percent"].includes(String(data.root_encoding))) return;
    const root = nativePath({ value: data.root, encoding: data.root_encoding as "utf-8" | "percent" | "utf-16-percent" });
    if (!isAbsolute(root) || sourceKey(root) !== sourceKey(projectRoot) && !relativeFile(root, projectRoot)) return;
    return { root, executable, mutationsAvailable: data.mutations_available === true };
  } catch { return; }
}

export class EskaRepository implements GitRepository, vscode.Disposable {
  readonly scmProvider = "eska";
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
  private draft = "";
  private readonly inputChanged = new vscode.EventEmitter<string>();
  readonly onDidChangeInput = this.inputChanged.event;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly abort = new AbortController();
  private readonly closed = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.closed.event;
  private current: ScmMonitorSnapshot | undefined;
  private pending: Promise<void> | undefined;
  private deferred: ScmMonitorSnapshot | undefined;
  private writing = false;
  private mutation: Promise<void> | undefined;
  private readonly blobs = new Map<string, Promise<Uint8Array>>();
  private cachedBytes = 0;
  private stamp = Date.now();
  get contentVersion(): number { return this.stamp; }
  readonly state: GitRepository["state"];
  constructor(root: string, readonly executable: string, private readonly text: Text, readonly mutationsAvailable = true) {
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
    this.blobs.clear(); this.cachedBytes = 0;
    this.stamp = Math.max(Date.now(), this.stamp + 1);
    this.current = snapshot; this.changed.fire();
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
    } catch (cause) { throw new Error(this.text("scmFailed"), { cause }); }
  }
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
    this.path(uri);
    const revision = revisionForRef(ref);
    return uri.with({ scheme: SCM_SCHEME, query: JSON.stringify({ root: this.rootUri.fsPath, revision }), fragment: "" });
  }
  readBlob(uri: vscode.Uri, revision: Revision): Promise<Uint8Array> {
    const path = this.path(uri), key = `${revision}:${path}`;
    const existing = this.blobs.get(key);
    if (existing) return existing;
    if (this.blobs.size >= 64) { this.blobs.clear(); this.cachedBytes = 0; }
    const request = this.request("scm-blob", ["--revision", revision, "--", path]).then(data => {
      if (data.content === null) return new Uint8Array();
      if (typeof data.content !== "string" || data.content.length > 44_739_244 || data.content.length % 4 !== 0) throw new Error(this.text("scmFailed"));
      // Native decoding plus canonical re-encoding is linear and has no regexp backtracking stack.
      const bytes = Buffer.from(data.content, "base64");
      if (bytes.length > 33_554_432 || bytes.toString("base64") !== data.content) throw new Error(this.text("scmFailed"));
      if (this.blobs.get(key) === request) {
        this.cachedBytes += bytes.length;
        if (this.cachedBytes > 33_554_432) {
          this.blobs.clear(); this.cachedBytes = bytes.length; this.blobs.set(key, request);
        }
      }
      return bytes;
    });
    this.blobs.set(key, request);
    void request.catch(() => { if (this.blobs.get(key) === request) this.blobs.delete(key); });
    return request;
  }
  dispose(): void {
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
    default: throw new Error("Unsupported SCM revision");
  }
}

/** Raw bytes preserve BOMs, legacy encodings and binary files in the normal diff editor. */
export class EskaScmFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  private readonly repositories = new Map<EskaRepository, { subscription: vscode.Disposable; uris: Map<string, vscode.Uri> }>();
  constructor(private readonly resolve: (root: string) => EskaRepository | undefined) {}
  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  private target(uri: vscode.Uri): { repository: EskaRepository; revision: Revision; file: vscode.Uri } {
    try {
      if (uri.scheme !== SCM_SCHEME || uri.fragment) throw new Error();
      const query: unknown = JSON.parse(uri.query);
      if (!isRecord(query) || typeof query.root !== "string" || !["head", "index", "base", "ours", "theirs"].includes(String(query.revision))) throw new Error();
      const repository = this.resolve(query.root);
      if (!repository || sourceKey(repository.rootUri.fsPath) !== sourceKey(query.root)) throw new Error();
      const file = uri.with({ scheme: "file", query: "", fragment: "" });
      if (!relativeFile(repository.rootUri.fsPath, file.fsPath)) throw new Error();
      let watched = this.repositories.get(repository);
      if (!watched) {
        const uris = new Map<string, vscode.Uri>();
        const changed = repository.state.onDidChange(() => {
          this.changes.fire([...uris.values()].map(uri => ({ type: vscode.FileChangeType.Changed, uri })));
        });
        const closed = repository.onDidDispose(() => {
          this.repositories.delete(repository); changed.dispose();
          this.changes.fire([...uris.values()].map(uri => ({ type: vscode.FileChangeType.Deleted, uri })));
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
    const { repository, revision, file } = this.target(uri);
    return repository.readBlob(file, revision);
  }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { repository, revision, file } = this.target(uri);
    const content = await repository.readBlob(file, revision);
    return { type: vscode.FileType.File, ctime: 0, mtime: repository.contentVersion, size: content.length, permissions: vscode.FilePermission.Readonly };
  }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): never { throw vscode.FileSystemError.NoPermissions(); }
  writeFile(): never { throw vscode.FileSystemError.NoPermissions(); }
  delete(): never { throw vscode.FileSystemError.NoPermissions(); }
  rename(): never { throw vscode.FileSystemError.NoPermissions(); }
  dispose(): void { for (const { subscription } of this.repositories.values()) subscription.dispose(); this.repositories.clear(); this.changes.dispose(); }
}
