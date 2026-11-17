import * as vscode from "vscode";
import { basename } from "node:path";
import { lstat } from "node:fs/promises";
import { GitRepositories, type GitChange, type GitRepository } from "./git-api.js";
import { gitStatus } from "./git-status.js";
import { changeCaption, changeGroups, changeIdentity, changes, insideRepository, permits, type ChangeAction, type ChangeGroup } from "./scm-model.js";
import { message, type MessageKey } from "./messages.js";
import { isRecord, isWirePath, projectEnabled } from "./protocol.js";
import { hasDirtySource, nativePath, resolveSourcePath, sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import type { MetadataTree, ProjectTree } from "./tree.js";

interface RepositoryEntry { kind: "repository"; key: string; repository: GitRepository; groups: GroupEntry[] }
interface GroupEntry { kind: "group"; key: string; parent: RepositoryEntry; group: ChangeGroup; entries: ChangeEntry[] }
export interface ChangeEntry { kind: "change"; key: string; parent: GroupEntry; change: GitChange; label: string }
type Entry = RepositoryEntry | GroupEntry | ChangeEntry;
interface ProjectContext { tree: MetadataTree; project: ProjectTree; root: string; source: string }
const groupLabels: Record<ChangeGroup, MessageKey> = { merge: "scmMerge", index: "scmIndex", working: "scmWorking", untracked: "scmUntracked" };
const prefix = "eska.explorer.scm";

/** Metadata captions over the built-in Git state, with no second repository or staging engine. */
export class MetadataChanges implements vscode.TreeDataProvider<Entry>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly view: vscode.TreeView<Entry>;
  private trees: readonly MetadataTree[] = [];
  private roots: RepositoryEntry[] | undefined;
  private readonly entries = new Map<string, Entry>();
  private revision = 0;
  private pending: Promise<RepositoryEntry[]> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private busy = false;

  constructor(private readonly git: GitRepositories, private readonly language: () => string,
    private readonly ensureTree: () => Promise<void>, private readonly log: (text: string) => void) {
    this.view = vscode.window.createTreeView(prefix, { treeDataProvider: this, canSelectMany: true, showCollapseAll: true });
    this.subscriptions.push(this.view, git.onDidChange(() => this.invalidate()),
      this.view.onDidChangeVisibility(({ visible }) => { if (visible) void this.connect(); }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("eska.explorer.treeLanguage") || event.affectsConfiguration("git.openDiffOnClick")) this.invalidate();
      }));
    for (const action of ["open", "diff", "stage", "unstage", "discard"] as const) {
      this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${action}`, (entry?: Entry, selected?: Entry[]) => this.execute(action, entry, selected)));
    }
    this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.openChange`, (entry?: ChangeEntry) =>
      this.execute(vscode.workspace.getConfiguration("git", entry?.change.uri).get<boolean>("openDiffOnClick", true) ? "diff" : "open", entry)));
    this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.refresh`, () => this.refresh()));
    if (this.view.visible) void this.connect();
  }

  /** Reuse already managed primary/additional workspace sessions, never discover projects separately. */
  setTrees(trees: readonly MetadataTree[]): void {
    if (trees.length === this.trees.length && trees.every((tree, index) => tree === this.trees[index])) return;
    this.trees = [...trees]; this.invalidate();
  }

  invalidate(): void {
    if (this.disposed) return;
    this.revision++; this.roots = undefined; this.pending = undefined;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.fire(undefined), 75);
  }

  private async connect(): Promise<void> {
    if (this.trees.length || this.disposed) return;
    try { await this.ensureTree(); } catch (error) { this.log(String(error)); }
  }

  getTreeItem(entry: Entry): vscode.TreeItem {
    if (entry.kind === "repository") {
      const item = new vscode.TreeItem(basename(entry.repository.rootUri.fsPath), vscode.TreeItemCollapsibleState.Expanded);
      item.id = entry.key; item.tooltip = entry.repository.rootUri.fsPath; item.iconPath = new vscode.ThemeIcon("repo"); return item;
    }
    if (entry.kind === "group") {
      const item = new vscode.TreeItem(this.text(groupLabels[entry.group]), vscode.TreeItemCollapsibleState.Expanded);
      item.id = entry.key; item.description = String(entry.entries.length); item.contextValue = `eskaScmGroup:${entry.group}`; return item;
    }
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    const status = gitStatus(entry.change.status);
    item.id = entry.key; item.resourceUri = entry.change.uri;
    item.description = relativeFile(entry.parent.parent.repository.rootUri.fsPath, entry.change.uri.fsPath) ?? "";
    item.tooltip = [entry.label, entry.change.originalUri.fsPath !== entry.change.uri.fsPath ? entry.change.originalUri.fsPath : undefined,
      entry.change.uri.fsPath, status && this.text(status.message)].filter(Boolean).join("\n");
    item.iconPath = new vscode.ThemeIcon(entry.parent.group === "merge" ? "warning" : "file", status && new vscode.ThemeColor(`gitDecoration.${status.color}`));
    item.contextValue = `eskaScmChange:${entry.parent.group}`;
    item.command = { command: `${prefix}.openChange`, title: this.text("scmDiff"), arguments: [entry] };
    return item;
  }

  getParent(entry: Entry): Entry | undefined { return entry.kind === "repository" ? undefined : entry.parent; }

  async getChildren(entry?: Entry): Promise<Entry[]> {
    if (entry) return entry.kind === "repository" ? entry.groups : entry.kind === "group" ? entry.entries : [];
    if (this.disposed) return [];
    if (this.roots) return this.roots;
    if (this.pending) return this.pending;
    const revision = this.revision;
    const pending = this.load(revision);
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = undefined; }
  }

  private contexts(): ProjectContext[] {
    const seen = new Set<string>(), contexts: ProjectContext[] = [];
    for (const tree of this.trees) for (const project of tree.projects) {
      if (!projectEnabled(project.info)) continue;
      try {
        const root = nativePath(project.info.rootPath), source = nativePath(project.info.sourcePath), key = sourceKey(source);
        if (!seen.has(key)) { seen.add(key); contexts.push({ tree, project, root, source }); }
      } catch { /* Unrepresentable native paths cannot be addressed by the editor either. */ }
    }
    return contexts.sort((a, b) => b.source.length - a.source.length);
  }

  private relevant(repository: GitRepository, contexts = this.contexts()): boolean {
    return repository.rootUri.scheme === "file" && contexts.some(context => sourceKey(context.root) === sourceKey(repository.rootUri.fsPath)
      || relativeFile(repository.rootUri.fsPath, context.root) !== undefined
      || relativeFile(context.root, repository.rootUri.fsPath) !== undefined);
  }

  private async load(revision: number): Promise<RepositoryEntry[]> {
    const contexts = this.contexts(), api = this.git.api;
    const roots: RepositoryEntry[] = [];
    if (api) for (const repository of this.git.repositories) {
      if (!this.relevant(repository, contexts)) continue;
      const root: RepositoryEntry = { kind: "repository", key: repository.rootUri.toString(), repository, groups: [] };
      for (const group of changeGroups) {
        const parent: GroupEntry = { kind: "group", key: `${root.key}:${group}`, parent: root, group, entries: [] };
        const seen = new Set<string>();
        for (const change of changes(repository, group)) {
          if (!insideRepository(repository, change)) continue;
          const identity = changeIdentity(change, group);
          if (seen.has(identity)) continue;
          seen.add(identity);
          parent.entries.push({ kind: "change", key: `${root.key}:${identity}`, parent, change, label: basename(change.uri.fsPath) });
        }
        if (parent.entries.length) root.groups.push(parent);
      }
      if (root.groups.length) roots.push(root);
    }
    const rows = roots.flatMap(root => root.groups.flatMap(group => group.entries));
    const labels = await this.labels(rows, contexts, revision);
    if (revision !== this.revision || this.disposed) return [];
    this.entries.clear();
    for (const root of roots) {
      this.entries.set(root.key, root);
      for (const group of root.groups) {
        this.entries.set(group.key, group);
        for (const entry of group.entries) { entry.label = changeCaption(entry.change, labels); this.entries.set(entry.key, entry); }
        group.entries.sort((a, b) => a.label.localeCompare(b.label, this.language()) || a.key.localeCompare(b.key));
      }
    }
    const notice = !api ? this.text("scmGitUnavailable") : !contexts.length ? this.text("scmConnect") : !rows.length ? this.text("scmNoChanges") : undefined;
    if (notice) this.view.message = notice; else delete this.view.message;
    this.roots = roots;
    return roots;
  }

  /** Only changed paths are sent, in bounded batches; removed files need no XML or filesystem read. */
  private async labels(entries: ChangeEntry[], contexts: ProjectContext[], revision: number): Promise<Map<string, string>> {
    const result = new Map<string, string>(), requests = new Map<ProjectContext, Set<string>>();
    for (const entry of entries) for (const uri of [entry.change.uri, entry.change.originalUri]) {
      const context = contexts.find(context => relativeFile(context.source, uri.fsPath) !== undefined);
      if (!context) continue;
      const state = context.tree.connection.state;
      if (state.kind !== "ready" || !state.sourceLabels) continue;
      const path = relativeFile(context.source, uri.fsPath);
      if (!path) continue;
      const paths = requests.get(context) ?? new Set<string>();
      paths.add(path); requests.set(context, paths);
    }
    for (const [context, paths] of requests) {
      const names = [...paths];
      for (let offset = 0; offset < names.length; offset += 512) {
        if (revision !== this.revision || this.disposed) return result;
        const batch = names.slice(offset, offset + 512);
        try {
          const response = await context.tree.request(context.project, "metadata/sourceLabels", { paths: batch.map(value => ({ value, encoding: "utf-8" })) });
          if (revision !== this.revision || this.disposed || !this.trees.includes(context.tree)) return result;
          if (!Array.isArray(response.labels) || response.labels.length !== batch.length) throw new Error("Invalid source labels response");
          const captions = new Map<string, string>();
          for (let index = 0; index < batch.length; index++) {
            const item = response.labels[index];
            if (!isRecord(item) || !isWirePath(item.path) || nativePath(item.path) !== batch[index]) throw new Error("Invalid source label path");
            if (item.translations === null) continue;
            if (!isRecord(item.translations) || typeof item.translations["ru-RU"] !== "string" || typeof item.translations["en-US"] !== "string") throw new Error("Invalid source label caption");
            const file = resolveSourcePath(context.project.info.sourcePath, item.path);
            captions.set(sourceKey(file), item.translations[this.language().startsWith("ru") ? "ru-RU" : "en-US"] as string);
          }
          for (const [file, caption] of captions) result.set(file, caption);
        } catch (error) { this.log(`scm_source_labels_failed: ${String(error)}`); }
      }
    }
    return result;
  }

  private selected(entry: Entry | undefined, selection: Entry[] | undefined, action: ChangeAction): ChangeEntry[] {
    const values = entry && selection?.includes(entry) ? selection : entry ? [entry] : [];
    const result = new Map<string, ChangeEntry>();
    for (const value of values) {
      if (this.entries.get(value.key) !== value) throw new Error(this.text("scmChanged"));
      const rows = value.kind === "change" ? [value] : value.kind === "group" ? value.entries : [];
      for (const row of rows) if (permits(row.parent.group, action)) result.set(row.key, row);
    }
    return [...result.values()];
  }

  /** Re-resolve repository and status before every action; never act on a stale displayed row. */
  private validate(entry: ChangeEntry): GitRepository {
    const repository = entry.parent.parent.repository, api = this.git.api;
    const selectedRepository = api?.getRepository(entry.change.uri);
    if (!this.git.repositories.includes(repository) || !this.relevant(repository) || !insideRepository(repository, entry.change)
      || !selectedRepository || sourceKey(selectedRepository.rootUri.fsPath) !== sourceKey(repository.rootUri.fsPath)
      || !changes(repository, entry.parent.group).some(change => changeIdentity(change, entry.parent.group) === changeIdentity(entry.change, entry.parent.group))) {
      throw new Error(this.text("scmChanged"));
    }
    return repository;
  }

  private async execute(action: ChangeAction, entry?: Entry, selection?: Entry[]): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      const rows = this.selected(entry, selection, action);
      if (!rows.length) return;
      if (action === "open" || action === "diff") {
        for (const row of rows) { this.validate(row); await this.open(row, action === "diff"); }
        return;
      }
      if (!vscode.workspace.isTrusted) throw new Error(this.text("scmUntrusted"));
      const repositories = new Map<GitRepository, ChangeEntry[]>();
      for (const row of rows) { const repository = this.validate(row); repositories.set(repository, [...(repositories.get(repository) ?? []), row]); }
      for (const repository of repositories.keys()) await repository.status();
      for (const row of rows) this.validate(row);
      const head = [...repositories].map(([repository]) => JSON.stringify(repository.state.HEAD));
      const paths = rows.flatMap(row => [row.change.uri.fsPath, row.change.originalUri.fsPath]);
      const before = action === "discard" ? await fileSnapshot(paths) : undefined;
      if (action === "discard") {
        if (await hasDirtySource(paths, vscode.workspace.textDocuments)) throw new Error(this.text("scmDirty"));
        const confirm = this.text("scmDiscard");
        if (await vscode.window.showWarningMessage(this.text("scmDiscardConfirm", String(rows.length)),
          { modal: true, detail: rows.map(row => `${row.label}\n${row.change.uri.fsPath}`).join("\n\n") }, confirm) !== confirm) return;
      } else if (action === "stage" && rows.some(row => row.parent.group === "merge")) {
        const confirm = this.text("scmStage");
        if (await vscode.window.showWarningMessage(this.text("scmConflictConfirm"), { modal: true }, confirm) !== confirm) return;
      }
      for (const repository of repositories.keys()) await repository.status();
      for (const row of rows) this.validate(row);
      if ([...repositories].some(([repository], index) => JSON.stringify(repository.state.HEAD) !== head[index])) throw new Error(this.text("scmChanged"));
      if (action === "discard" && (await fileSnapshot(paths) !== before || await hasDirtySource(paths, vscode.workspace.textDocuments))) throw new Error(this.text("scmChanged"));
      for (const [repository, entries] of repositories) {
        for (const row of entries) this.validate(row);
        const files = [...new Set(entries.flatMap(row => action === "unstage" && row.change.status === 3
          ? [row.change.uri.fsPath, row.change.originalUri.fsPath] : [row.change.uri.fsPath]))];
        if (action === "stage") await repository.add(files);
        else if (action === "unstage") await repository.revert(files);
        else await repository.clean(files);
      }
    } catch (error) { this.log(String(error)); void vscode.window.showErrorMessage(error instanceof Error ? error.message : this.text("scmFailed")); }
    finally { this.busy = false; this.invalidate(); }
  }

  private async open(entry: ChangeEntry, diff: boolean): Promise<void> {
    const { change } = entry, api = this.git.api;
    if (!api) return;
    if (!diff && change.status !== 2 && change.status !== 6) { await vscode.commands.executeCommand("vscode.open", change.uri); return; }
    if (entry.parent.group !== "index") {
      if (change.status === 7 || change.status === 9) await vscode.commands.executeCommand("vscode.open", change.uri);
      else await vscode.commands.executeCommand("git.openChange", change.uri);
      return;
    }
    const current = api.toGitUri(change.uri, change.status === 2 ? "HEAD" : "");
    const title = `${entry.label} (${this.text("scmIndex")})`;
    if (change.status === 0 || change.status === 3) await vscode.commands.executeCommand("vscode.diff", api.toGitUri(change.originalUri, "HEAD"), current, title);
    else await vscode.commands.executeCommand("vscode.open", current, {}, title);
  }

  private async refresh(): Promise<void> {
    await this.connect();
    try { for (const repository of this.git.repositories) if (this.relevant(repository)) await repository.status(); }
    catch (error) { this.log(String(error)); }
    this.invalidate();
  }

  private text(key: MessageKey, ...values: string[]): string { return message(vscode.env.language, key, ...values); }

  dispose(): void {
    this.disposed = true; this.revision++; clearTimeout(this.timer);
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.entries.clear(); this.roots = undefined; this.changed.dispose();
  }
}

/** Detect replacement or external edits while a destructive confirmation dialog is open. */
async function fileSnapshot(paths: string[]): Promise<string> {
  return JSON.stringify(await Promise.all([...new Set(paths)].map(async path => {
    try { const value = await lstat(path, { bigint: true }); return [sourceKey(path), String(value.dev), String(value.ino), String(value.size), String(value.mtimeNs), String(value.ctimeNs)]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return [sourceKey(path), null]; throw error; }
  })));
}
