import * as vscode from "vscode";
import { sep } from "node:path";
import { isRecord, isWirePath } from "./protocol.js";
import { nativePath, isFormPayload } from "./source.js";
import { relativeFile } from "./reveal.js";
import { message } from "./messages.js";
import { gitStatus, type GitStatus } from "./git-status.js";
import { GitRepositories } from "./git-api.js";
import type { FormSource } from "./forms.js";
import { nodeKey, type MetadataTree, type ProjectTree, type TreeEntry } from "./tree.js";

type Entry = TreeEntry | FormSource;
interface Snapshot { files: Map<string, GitStatus>; names: Set<string>; sortedPaths?: string[] }

/** Compare paths using the same host rules as source navigation. */
function comparable(value: string): string { return process.platform === "win32" ? value.toLowerCase() : value; }

/** Decorate only private tree URIs, never other explorers, tabs or language providers. */
export class GitDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  support: ((entry: TreeEntry) => vscode.FileDecoration | undefined) | undefined;
  private readonly changed = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly entries = new Map<string, WeakRef<Entry>>();
  private readonly snapshots = new Map<ProjectTree, Snapshot>();
  private results = new Map<string, Promise<vscode.FileDecoration | undefined>>();
  private readonly resolved = new Map<string, vscode.FileDecoration | undefined>();
  private readonly git: GitRepositories;
  private tree: MetadataTree | undefined;
  private epoch = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(git?: GitRepositories) {
    this.git = git ?? new GitRepositories();
    if (!git) this.subscriptions.push(this.git);
    this.subscriptions.push(this.git.onDidChange(() => this.invalidate()));
    this.subscriptions.push(vscode.window.registerFileDecorationProvider(this));
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("git.decorations.enabled")) this.invalidate();
    }));
  }

  /** Drop obsolete identities when the connection changes. */
  setTree(tree: MetadataTree | undefined): void {
    if (tree !== this.tree) this.entries.clear();
    this.tree = tree;
    this.invalidate();
  }

  /** Coalesce Git and metadata events, and reject any already running stale result. */
  invalidate(): void {
    if (this.disposed) return;
    this.epoch++;
    this.snapshots.clear();
    this.results = new Map();
    this.resolved.clear();
    for (const [key, reference] of this.entries) {
      const entry = reference.deref();
      const owner = entry && ("owner" in entry ? entry.owner : entry);
      if (!owner || owner.project.nodes.get(nodeKey(owner.node.id)) !== owner) this.entries.delete(key);
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.changed.fire(undefined); }, 100);
  }

  /** Painting registers an identity only; no IO or backend request runs in getTreeItem. */
  resource(entry: Entry): vscode.Uri {
    const key = "owner" in entry ? `${entry.owner.key}:source:${entry.target}` : entry.key;
    this.entries.set(key, new WeakRef(entry));
    return vscode.Uri.from({ scheme: "eska-decoration", path: "/" + encodeURIComponent(key) });
  }

  /** Resolve only requested visible decorations; serialize reads to protect the backend queue. */
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | Promise<vscode.FileDecoration | undefined> | undefined {
    if (uri.scheme !== "eska-decoration" || !this.tree || this.disposed) return undefined;
    const key = decodeURIComponent(uri.path.slice(1));
    const entry = this.entries.get(key)?.deref();
    if (!entry) return undefined;
    const support = this.support?.("owner" in entry ? entry.owner : entry);
    if (!this.git.api || !vscode.workspace.getConfiguration("git").get<boolean>("decorations.enabled", true)) return support;
    if (this.resolved.has(key)) return this.resolved.get(key);
    const cached = this.results.get(key);
    if (cached) return support ?? cached;
    const tree = this.tree;
    const epoch = this.epoch;
    const result = this.serial.then(async () => {
      if (epoch !== this.epoch || this.disposed) return undefined;
      try {
        const decoration = await this.resolve(tree, entry, epoch);
        if (epoch !== this.epoch || this.disposed) return undefined;
        if (support) return new vscode.FileDecoration(support.badge, [support.tooltip, decoration && `${decoration.badge}: ${decoration.tooltip}`].filter(Boolean).join(" · "), decoration?.color);
        return decoration;
      } catch { return epoch === this.epoch && !this.disposed ? support : undefined; } // Git failures must not hide support diagnostics.
    });
    this.serial = result;
    this.results.set(key, result);
    void result.then(decoration => {
      if (epoch !== this.epoch || this.disposed) return;
      this.resolved.set(key, decoration);
      if (support) this.changed.fire([uri]);
    });
    return support ?? result;
  }

  /** Index only Git's changed paths once per project snapshot, never scan source directories. */
  private snapshot(project: ProjectTree): Snapshot {
    const cached = this.snapshots.get(project);
    if (cached) return cached;
    const files = new Map<string, GitStatus>();
    const root = nativePath(project.info.sourcePath);
    for (const repository of this.git.api?.repositories ?? []) {
      const state = repository.state;
      for (const change of [...state.indexChanges, ...state.workingTreeChanges, ...(state.untrackedChanges ?? []), ...state.mergeChanges]) {
        const status = gitStatus(change.status);
        if (!status) continue;
        const uris = change.status === 3 || change.status === 10 ? [change.uri, change.originalUri] : [change.uri];
        for (const uri of uris) {
          if (uri.scheme !== "file") continue;
          const path = relativeFile(root, uri.fsPath);
          if (!path) continue;
          const key = comparable(path);
          const previous = files.get(key);
          if (!previous || previous.priority <= status.priority) files.set(key, status);
        }
      }
    }
    const snapshot: Snapshot = { files, names: new Set() };
    for (const path of files.keys()) for (const part of path.split(sep)) snapshot.names.add(part.replace(/\.xml$/i, ""));
    this.snapshots.set(project, snapshot);
    return snapshot;
  }

  /** Use server-provided source paths for exact files and descriptor-owned directories. */
  private async resolve(tree: MetadataTree, entry: Entry, epoch: number): Promise<vscode.FileDecoration | undefined> {
    await tree.synchronizeInputs();
    if (epoch !== this.epoch) return undefined;
    const owner = "owner" in entry ? entry.owner : entry;
    const snapshot = this.snapshot(owner.project);
    if (!snapshot.files.size) return undefined;
    if (!owner.node.parent) return this.descendant();
    if (!("owner" in entry) && owner.node.id.kind === "collection") {
      for (const child of await tree.children(owner)) {
        if (epoch !== this.epoch) return undefined;
        try { if (await this.resolve(tree, child, epoch)) return this.descendant(); }
        catch { /* One unavailable source must not hide changes in its siblings. */ }
      }
      return undefined;
    }
    const nameOwner = owner.node.id.kind === "module" ? tree.parent(tree.parent(owner) ?? owner) : owner;
    if (nameOwner?.node.parent && nameOwner.node.label.kind === "name" && !snapshot.names.has(comparable(nameOwner.node.label.text))) return undefined;
    // A file event can invalidate backend nodes before the native tree repaints its still-visible rows.
    // Reuse cached parents, expanding only invalidated ancestry before requesting the selected source.
    const parents: TreeEntry[] = [];
    for (let parent = tree.parent(owner); parent; parent = tree.parent(parent)) parents.push(parent);
    for (const parent of parents.reverse()) {
      await tree.children(parent);
      if (epoch !== this.epoch) return undefined;
    }
    const result = await tree.request(owner.project, "metadata/source", { node: owner.node.id });
    if (!Array.isArray(result.sources)) return undefined;
    const exact: GitStatus[] = [];
    let descendants = false;
    for (const source of result.sources) {
      if (!isRecord(source) || !isWirePath(source.path) || !isRecord(source.role)) continue;
      if ("owner" in entry && !(entry.target === "form" ? isFormPayload(source) : source.role.kind === "module" && source.role.role === "module")) continue;
      const path = comparable(nativePath(source.path));
      const status = snapshot.files.get(path);
      if (status) exact.push(status);
      if (!("owner" in entry) && owner.node.id.kind === "object" && source.role.kind === "descriptor" && path.endsWith(".xml")) {
        // Exact-file decorations need no ordering. Build this shared index only for an object query.
        const paths = snapshot.sortedPaths ??= [...snapshot.files.keys()].sort();
        const prefix = path.slice(0, -4) + sep;
        let low = 0, high = paths.length;
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (paths[middle]! < prefix) low = middle + 1;
          else high = middle;
        }
        descendants ||= paths[low]?.startsWith(prefix) ?? false;
      }
    }
    const status = exact.sort((a, b) => b.priority - a.priority)[0];
    return status ? new vscode.FileDecoration(status.badge, message(vscode.env.language, status.message), new vscode.ThemeColor(`gitDecoration.${status.color}`))
      : descendants ? this.descendant() : undefined;
  }

  /** Parent markers deliberately describe changed files, not a semantic change to every child. */
  private descendant(): vscode.FileDecoration {
    return new vscode.FileDecoration("•", message(vscode.env.language, "gitDescendants"), new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
  }

  /** Stop listeners and queued work when the extension shuts down. */
  dispose(): void {
    this.disposed = true; this.epoch++;
    clearTimeout(this.timer);
    for (const subscription of this.subscriptions) subscription.dispose();
    this.entries.clear(); this.snapshots.clear(); this.results.clear(); this.resolved.clear();
    this.changed.dispose();
  }
}
