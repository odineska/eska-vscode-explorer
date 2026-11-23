import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { isRecord, MAX_RESPONSE, ExplorerError } from "./protocol.js";
import { nativePath, resolveSourcePath, sourceKey } from "./source.js";
import { findTool } from "./tooling/inspect.js";
import { Status } from "./git-status.js";
import type { GitChange } from "./git-api.js";

export interface ScmMonitorSnapshot {
  readonly branch: string | undefined;
  readonly mergeChanges: readonly GitChange[];
  readonly indexChanges: readonly GitChange[];
  readonly workingTreeChanges: readonly GitChange[];
  readonly untrackedChanges: readonly GitChange[];
}
export interface ScmMonitorTarget { readonly root: string; readonly projectExecutable: string }
const kinds = new Set<unknown>(["added", "modified", "deleted", "type_changed", "untracked", "intent_to_add", "conflict"]);
const pathEncodings = new Set<unknown>(["utf-8", "percent"]);
const rootEncodings = new Set<unknown>([...pathEncodings, "utf-16-percent"]);
const heads = new Set<unknown>(["attached", "detached", "unborn"]);
const invalid = (): never => { throw new Error("Invalid SCM monitor response"); };

/** Validate the complete snapshot before exposing any paths to SCM commands. */
export function parseScmSnapshot(value: unknown, root: string): ScmMonitorSnapshot {
  if (!isRecord(value) || value.schema_version !== 1 || value.kind !== "snapshot" || !isRecord(value.repository) || !Array.isArray(value.changes)) return invalid();
  const repository = value.repository;
  if (typeof repository.root !== "string" || !rootEncodings.has(repository.root_encoding)
    || !heads.has(repository.head)
    || !(repository.commit === null || typeof repository.commit === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(repository.commit))) return invalid();
  const nativeRoot = nativePath({ value: repository.root, encoding: repository.root_encoding as "utf-8" | "percent" | "utf-16-percent" });
  if (!isAbsolute(nativeRoot) || sourceKey(nativeRoot) !== sourceKey(root)) return invalid();
  let branch: string | undefined;
  if (repository.branch === null) { if (repository.branch_encoding !== null || repository.head === "attached") return invalid(); }
  else {
    if (typeof repository.branch !== "string" || !pathEncodings.has(repository.branch_encoding) || repository.head === "detached") return invalid();
    try { branch = nativePath({ value: repository.branch, encoding: repository.branch_encoding as "utf-8" | "percent" }); }
    catch (error) { if (!(error instanceof ExplorerError && error.code === "unsupportedPath")) throw error; }
  }
  const mergeChanges: GitChange[] = [], indexChanges: GitChange[] = [], workingTreeChanges: GitChange[] = [], untrackedChanges: GitChange[] = [];
  for (const change of value.changes) {
    if (!isRecord(change) || typeof change.path !== "string" || !pathEncodings.has(change.path_encoding)
      || !(change.index === null || kinds.has(change.index)) || !(change.worktree === null || kinds.has(change.worktree))
      || change.index === null && change.worktree === null) return invalid();
    let path: string;
    try { path = resolveSourcePath({ value: nativeRoot, encoding: "utf-8" }, { value: change.path, encoding: change.path_encoding as "utf-8" | "percent" }); }
    catch (error) { if (error instanceof ExplorerError && error.code === "unsupportedPath") continue; throw error; }
    const uri = vscode.Uri.file(path);
    const add = (items: GitChange[], status: number): void => { items.push({ uri, originalUri: uri, status }); };
    if (change.index === "conflict" || change.worktree === "conflict") { add(mergeChanges, Status.BothModified); continue; }
    if (change.index !== null) add(indexChanges, change.index === "added" || change.index === "intent_to_add" ? Status.IndexAdded : change.index === "deleted" ? Status.IndexDeleted : Status.IndexModified);
    if (change.worktree === "untracked") add(untrackedChanges, Status.Untracked);
    else if (change.worktree !== null) add(workingTreeChanges, change.worktree === "deleted" ? Status.Deleted : change.worktree === "type_changed" ? Status.TypeChanged
      : change.worktree === "added" || change.worktree === "intent_to_add" ? Status.IntentToAdd : Status.Modified);
  }
  return { branch, mergeChanges, indexChanges, workingTreeChanges, untrackedChanges };
}

/** Byte-bounded NDJSON framing, including when a chunk contains several complete lines. */
export class ScmMonitorLines {
  private parts: Buffer[] = [];
  private size = 0;
  constructor(private readonly line: (value: unknown) => void, private readonly limit = MAX_RESPONSE) {}
  push(chunk: Buffer): void {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start), stop = end < 0 ? chunk.length : end;
      const part = chunk.subarray(start, stop);
      this.size += part.length;
      if (this.size > this.limit) throw new Error("SCM monitor response limit");
      if (part.length) this.parts.push(part);
      if (end < 0) return;
      const bytes = Buffer.concat(this.parts, this.size);
      this.parts = []; this.size = 0;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      this.line(JSON.parse(text));
      start = end + 1;
    }
  }
}
interface Session {
  target: ScmMonitorTarget; child?: ChildProcessWithoutNullStreams; snapshot?: ScmMonitorSnapshot;
  flushTimer?: NodeJS.Timeout; reconcileTimer?: NodeJS.Timeout;
  paths: Set<string>; pathBytes: number; refresh: boolean; blocked: boolean;
}
const newSession = (target: ScmMonitorTarget): Session => ({ target, paths: new Set(), pathBytes: 0, refresh: false, blocked: false });

/** Failed sessions stay dormant until an explicit refresh or target change. */
export class ScmMonitors implements vscode.Disposable {
  private readonly sessions = new Map<string, Session>();
  private disposed = false;
  private events: vscode.Disposable[] = [];
  constructor(private readonly changed: (root: string) => void, private readonly log: (message: string) => void) {}
  synchronize(targets: readonly ScmMonitorTarget[]): void {
    if (this.disposed) return;
    const wanted = new Map(targets.map(target => [sourceKey(target.root), target]));
    for (const [key, session] of this.sessions) {
      if (wanted.get(key)?.projectExecutable === session.target.projectExecutable) continue;
      this.sessions.delete(key); this.stop(session);
    }
    for (const [key, target] of wanted) if (!this.sessions.has(key)) {
      const session = newSession(target); this.sessions.set(key, session); void this.start(key, session);
    }
    this.synchronizeEvents();
  }
  get(root: string): ScmMonitorSnapshot | undefined { return this.sessions.get(sourceKey(root))?.snapshot; }
  restart(root: string): void {
    const key = sourceKey(root), old = this.sessions.get(key);
    if (!old || this.disposed) return;
    const session = newSession(old.target);
    this.sessions.set(key, session); this.stop(old); this.changed(root); void this.start(key, session);
  }
  /** A string glob reuses VS Code's existing workspace watch instead of adding a recursive root. */
  private synchronizeEvents(): void {
    if (this.sessions.size && !this.events.length) {
      const watcher = vscode.workspace.createFileSystemWatcher("**/*");
      const forward = (uri: vscode.Uri): void => this.observe(uri);
      this.events = [watcher, watcher.onDidCreate(forward), watcher.onDidChange(forward), watcher.onDidDelete(forward),
        vscode.workspace.onDidSaveTextDocument(document => forward(document.uri)),
        vscode.workspace.onDidCreateFiles(event => event.files.forEach(forward)),
        vscode.workspace.onDidDeleteFiles(event => event.files.forEach(forward)),
        vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => { forward(file.oldUri); forward(file.newUri); }))];
    } else if (!this.sessions.size) { for (const event of this.events) event.dispose(); this.events = []; }
  }
  private observe(uri: vscode.Uri): void {
    if (uri.scheme !== "file") return;
    for (const session of this.sessions.values()) {
      if (!session.child) continue;
      const path = relative(session.target.root, uri.fsPath);
      if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) continue;
      if (!path) session.refresh = true;
      else if (!session.refresh) {
        const normalized = path.split(sep).join("/");
        if (normalized.startsWith(".git/") && normalized !== ".git/index" && normalized !== ".git/HEAD"
          && normalized !== ".git/packed-refs" && normalized !== ".git/config" && !normalized.startsWith(".git/refs/")) continue;
        if (!session.paths.has(normalized)) {
          session.paths.add(normalized);
          session.pathBytes += Buffer.byteLength(JSON.stringify(normalized)) + 1;
        }
        // Bound the actual serialized record (including escaping), in linear total time.
        if (session.paths.size > 1024 || session.pathBytes + 40 > 65_536) session.refresh = true;
      }
      if (session.refresh) { session.paths.clear(); session.pathBytes = 0; }
      this.schedule(session);
    }
  }
  private schedule(session: Session): void {
    if (session.blocked || session.flushTimer || !session.child) return;
    session.flushTimer = setTimeout(() => { delete session.flushTimer; this.flush(session); }, 75);
  }
  private flush(session: Session): void {
    const child = session.child;
    if (!child || session.blocked || !session.refresh && !session.paths.size) return;
    const message = session.refresh ? { schema_version: 1, refresh: true } : { schema_version: 1, paths: [...session.paths] };
    session.refresh = false; session.paths.clear(); session.pathBytes = 0;
    session.blocked = !child.stdin.write(JSON.stringify(message) + "\n");
  }
  private async start(key: string, session: Session): Promise<void> {
    const current = (): boolean => !this.disposed && this.sessions.get(key) === session;
    const fail = (reason: string): void => {
      if (!current()) return;
      this.stop(session); delete session.snapshot;
      this.log(`SCM monitor: ${reason}`); this.changed(session.target.root);
    };
    try {
      const executable = await findTool("eska-vcs", "eska-vcs", dirname(session.target.projectExecutable));
      if (!current()) return;
      if (!executable) { fail("unavailable"); return; }
      const child = spawn(executable, ["--project-dir", session.target.root, "monitor", "--events-stdin", "--format", "json"], { cwd: session.target.root, shell: false, windowsHide: true });
      session.child = child;
      const active = (): boolean => current() && session.child === child;
      // The view can use its existing Git state while a large checkout's first status is read.
      const lines = new ScmMonitorLines(value => {
        if (!active()) return;
        if (isRecord(value) && value.schema_version === 1 && value.kind === "error" && typeof value.code === "string") throw new Error("SCM monitor terminal error");
        const snapshot = parseScmSnapshot(value, session.target.root);
        session.snapshot = snapshot; this.changed(session.target.root);
      });
      child.stdout.on("data", (chunk: Buffer) => { if (active()) try { lines.push(chunk); } catch { fail("invalid stream"); } });
      let stderrBytes = 0;
      child.stderr.on("data", (chunk: Buffer) => { if (active()) { stderrBytes += chunk.length; if (stderrBytes > 65_536) fail("stderr limit"); } });
      child.on("error", () => { if (active()) fail("process error"); });
      child.on("close", () => { if (active()) fail("process closed"); });
      child.stdin.on("error", () => { if (active()) fail("input stream error"); });
      child.stdin.on("drain", () => { if (active()) {
        session.blocked = false; this.schedule(session);
      } });
      // Fixed cadence: continuous file events must never postpone recovery of missed events.
      session.reconcileTimer = setInterval(() => {
        if (active()) {
          session.refresh = true; session.paths.clear(); session.pathBytes = 0; this.flush(session);
        }
      }, 30_000);
    } catch { fail("startup failed"); }
  }
  private stop(session: Session): void {
    if (session.flushTimer) clearTimeout(session.flushTimer); delete session.flushTimer;
    if (session.reconcileTimer) clearInterval(session.reconcileTimer); delete session.reconcileTimer;
    session.paths.clear(); session.pathBytes = 0; session.refresh = false;
    const child = session.child; delete session.child;
    if (child) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.kill(); }
  }
  dispose(): void { this.disposed = true; for (const session of this.sessions.values()) this.stop(session); this.sessions.clear(); this.synchronizeEvents(); }
}
