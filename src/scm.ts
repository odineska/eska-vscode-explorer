import * as vscode from "vscode";
import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { GitRepositories, type GitRepository } from "./git-api.js";
import { gitStatus } from "./git-status.js";
import { changeCaption, changeGroups, changeIdentity, changes, insideRepository, type ChangeGroup } from "./scm-model.js";
import { button, fileActions, fileInline, fileMenu, groupActions, groupCommands, isFileAction, isGroupAction, type FileAction, type ScmAction } from "./scm-actions.js";
import { executeFileAction } from "./scm-file-actions.js";
import { message, type MessageKey } from "./messages.js";
import { isRecord, isWirePath, projectEnabled } from "./protocol.js";
import { nativePath, resolveSourcePath, sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import type { MetadataTree, ProjectTree } from "./tree.js";

interface RepositoryEntry { kind: "repository"; key: string; repository: GitRepository; groups: GroupEntry[] }
interface GroupEntry { kind: "group"; key: string; parent: RepositoryEntry; group: ChangeGroup; entries: ChangeEntry[] }
export interface ChangeEntry { kind: "change"; key: string; parent: GroupEntry; change: import("./git-api.js").GitChange; label: string }
type Entry = RepositoryEntry | GroupEntry | ChangeEntry;
interface ProjectContext { tree: MetadataTree; project: ProjectTree; root: string; source: string }
const groupLabels: Record<ChangeGroup, MessageKey> = { merge: "scmMerge", index: "scmIndex", working: "scmWorking", untracked: "scmUntracked" };
const prefix = "eska.explorer.scm";

/** One semantic view over the existing Git connection, input box and repository operations. */
export class MetadataChanges implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private viewSubscriptions: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private trees: readonly MetadataTree[] = [];
  private roots: RepositoryEntry[] | undefined;
  private readonly entries = new Map<string, Entry>();
  private readonly draftAcks = new WeakMap<GitRepository, number>();
  private readonly commitAcks = new WeakMap<GitRepository, number>();
  private revision = 0;
  private readonly repositoryTokens = new WeakMap<GitRepository, string>();
  private readonly deferredDrafts = new Map<GitRepository, { value: string; editId: number }>();
  private pending: Promise<RepositoryEntry[]> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private busy = false;
  private ready = false;
  private notice: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitRepositories, private readonly language: () => string,
    private readonly ensureTree: () => Promise<void>, private readonly log: (text: string) => void) {
    this.subscriptions.push(vscode.window.registerWebviewViewProvider(prefix, this), git.onDidChange(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("eska.explorer.treeLanguage") || event.affectsConfiguration("git")) this.invalidate();
      }));
    for (const action of [...fileActions, ...Object.keys(groupCommands), "openChange", "commit"] as ScmAction[]) {
      this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${action}`, (entry?: unknown, selected?: unknown) => this.execute(action, entry, selected)));
    }
    for (const alias of ["revealWindows", "revealMac", "revealLinux"]) {
      this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${alias}`, (entry?: unknown) => this.execute("revealOs", entry)));
    }
    this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.refresh`, () => this.refresh()),
      vscode.commands.registerCommand(`${prefix}.compareRevisions`, () => this.compareRevisions()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    for (const subscription of this.viewSubscriptions.splice(0)) subscription.dispose();
    this.view = view; this.ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out"),
      vscode.Uri.joinPath(this.context.extensionUri, "resources", "shared")] };
    this.viewSubscriptions.push(view.webview.onDidReceiveMessage(value => { void this.receive(value); }),
      view.onDidChangeVisibility(() => { if (view.visible) { void this.connect(); void this.publish(); } }),
      view.onDidDispose(() => { if (this.view === view) { this.view = undefined; this.ready = false; } }));
    const nonce = randomBytes(16).toString("hex");
    const uri = (...parts: string[]) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts));
    view.webview.html = `<!doctype html><html lang="${vscode.env.language.startsWith("ru") ? "ru" : "en"}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'none'">
      <link rel="stylesheet" href="${uri("resources", "shared", "ui.css")}"><link rel="stylesheet" href="${uri("out", "scm-view.css")}">
      </head><body><main id="root"></main><script nonce="${nonce}" src="${uri("out", "scm-view.js")}"></script></body></html>`;
  }

  setTrees(trees: readonly MetadataTree[]): void {
    if (trees.length === this.trees.length && trees.every((tree, index) => tree === this.trees[index])) return;
    this.trees = [...trees]; this.invalidate();
  }

  invalidate(): void {
    if (this.disposed) return;
    this.revision++; this.roots = undefined; this.pending = undefined;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.publish(); }, 75);
  }

  private async connect(): Promise<void> {
    if (this.trees.length || this.disposed) return;
    try { await this.ensureTree(); } catch (error) { this.log(String(error)); }
  }

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
      roots.push(root);
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
    this.notice = notice;
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

  private validRepository(root: RepositoryEntry): GitRepository {
    const repository = root.repository, current = this.git.api?.getRepository(repository.rootUri);
    if (!this.git.repositories.includes(repository) || !this.relevant(repository) || !current
      || sourceKey(current.rootUri.fsPath) !== sourceKey(repository.rootUri.fsPath)) throw new Error(this.text("scmChanged"));
    return repository;
  }

  private validate(entry: ChangeEntry): GitRepository {
    const repository = this.validRepository(entry.parent.parent), selected = this.git.api?.getRepository(entry.change.uri);
    if (!insideRepository(repository, entry.change) || !selected || sourceKey(selected.rootUri.fsPath) !== sourceKey(repository.rootUri.fsPath)
      || !changes(repository, entry.parent.group).some(change => changeIdentity(change, entry.parent.group) === changeIdentity(entry.change, entry.parent.group))) {
      throw new Error(this.text("scmChanged"));
    }
    return repository;
  }

  private resolve(value: unknown): Entry {
    if (!isRecord(value) || (value.webview !== undefined && value.webview !== prefix)) throw new Error(this.text("scmChanged"));
    if (value.kind === undefined && (!Number.isSafeInteger(value.eskaScmRevision) || value.eskaScmRevision !== this.revision)) throw new Error(this.text("scmChanged"));
    const key = typeof value.eskaScmKey === "string" ? value.eskaScmKey : typeof value.key === "string" ? value.key : undefined;
    const entry = key === undefined ? undefined : this.entries.get(key);
    if (!entry || (value.kind !== undefined && !Object.is(value, entry))) throw new Error(this.text("scmChanged"));
    return entry;
  }

  private token(repository: GitRepository): string {
    let token = this.repositoryTokens.get(repository);
    if (!token) { token = randomBytes(16).toString("hex"); this.repositoryTokens.set(repository, token); }
    return token;
  }

  private options(root: RepositoryEntry) {
    const configuration = vscode.workspace.getConfiguration("git", root.repository.rootUri);
    return { mixed: configuration.get<string>("untrackedChanges", "mixed") === "mixed",
      showOpen: configuration.get<boolean>("showInlineOpenFileAction", true), openDiff: configuration.get<boolean>("openDiffOnClick", true),
      worktree: root.repository.kind === "worktree", local: !vscode.env.remoteName };
  }

  private async publish(): Promise<void> {
    if (!this.view || !this.ready || this.disposed) return;
    const revision = this.revision, roots = await this.getChildren();
    if (revision !== this.revision || !this.view || !this.ready || this.disposed) return;
    const text = (key: MessageKey) => this.text(key);
    const repositories = (roots as RepositoryEntry[]).map(root => {
      const options = this.options(root), repository = root.repository;
      const context = { webviewSection: "scmRepository", eskaScmKey: root.key };
      return { key: root.key, label: basename(repository.rootUri.fsPath), description: repository.rootUri.fsPath,
        repositoryToken: this.token(repository), branch: repository.state.HEAD?.name, message: this.deferredDrafts.get(repository)?.value ?? repository.inputBox.value, acknowledgedEditId: this.draftAcks.get(repository) ?? 0,
        acknowledgedCommitId: this.commitAcks.get(repository) ?? 0, busy: this.busy || !vscode.workspace.isTrusted,
        actions: [button("refresh", text)], context, groups: root.groups.map(group => {
          const common = { eskaScmGroup: group.group, eskaScmUntrackedMixed: options.mixed };
          return { key: group.key, kind: group.group, label: this.text(groupLabels[group.group]),
            actions: groupActions(group.group, options.mixed).map(action => button(action, text)),
            context: { ...common, webviewSection: "scmGroup", eskaScmKey: group.key },
            rows: group.entries.map(row => {
              const status = gitStatus(row.change.status), canDiscard = group.group === "working" || group.group === "untracked";
              return { key: row.key, label: row.label, description: relativeFile(repository.rootUri.fsPath, row.change.uri.fsPath) ?? "",
                title: [row.label, row.change.originalUri.fsPath !== row.change.uri.fsPath ? row.change.originalUri.fsPath : undefined,
                  row.change.uri.fsPath, status && this.text(status.message)].filter(Boolean).join("\n"),
                statusLetter: status?.badge, color: status ? `var(--vscode-gitDecoration-${status.color})` : undefined,
                actions: fileInline(group.group, options.showOpen, options.openDiff, canDiscard).map(action => button(action, text)),
                context: { ...common, webviewSection: "scmChange", eskaScmKey: row.key, eskaScmDiscard: canDiscard,
                  eskaScmReveal: group.group !== "untracked", eskaScmCompare: options.worktree && (group.group === "index" || group.group === "working") } };
            }) };
        }) };
    });
    await this.view.webview.postMessage({ type: "snapshot", revision, busy: this.busy, notice: this.notice, repositories,
      labels: { commit: this.text("scmCommit"), message: this.text("scmMessage"), repository: this.text("scmRepository"),
        noChanges: this.text("scmNoChanges"), changes: this.text("scmWorking"), collapse: this.text("scmCollapse"), expand: this.text("scmExpand") } });
  }

  private async receive(value: unknown): Promise<void> {
    if (!isRecord(value) || this.disposed) return;
    try {
      if (value.type === "ready") { this.ready = true; await this.connect(); await this.publish(); return; }
      if (value.type === "action" && typeof value.action === "string") {
        const action = value.action;
        if (isFileAction(action) || isGroupAction(action) || action === "openChange" || action === "refresh") {
          await this.execute(action, { eskaScmKey: value.key, eskaScmRevision: value.revision, eskaScmSelection: value.selection });
        }
        return;
      }
      if (value.type !== "message" && value.type !== "commit") return;
      const key = value.repository, editId = value.editId, commitId = value.commitId;
      if (typeof key !== "string" || typeof value.value !== "string" || !Number.isSafeInteger(editId) || (editId as number) < 0) return;
      // An old/duplicate request must not restore text already cleared by a successful commit.
      if (value.type === "commit" && (!Number.isSafeInteger(commitId) || (commitId as number) < 1)) return;
      const root = this.entries.get(key);
      if (!root || root.kind !== "repository") throw new Error(this.text("scmRepositoryUnavailable"));
      const repository = this.validRepository(root);
      if (value.repositoryToken !== this.token(repository)) throw new Error(this.text("scmChanged"));
      if (value.type === "commit" && (commitId as number) <= (this.commitAcks.get(repository) ?? 0)) return;
      if (value.type === "message" && (editId as number) <= (this.draftAcks.get(repository) ?? 0)) { await this.publishInput(repository); return; }
      try {
        if (value.value.length > 1024 * 1024) throw new Error(this.text("scmMessageTooLong"));
        if ((editId as number) < (this.draftAcks.get(repository) ?? 0)) throw new Error(this.text("scmChanged"));
        if (value.type === "commit" && (!Number.isSafeInteger(value.revision) || value.revision !== this.revision)) throw new Error(this.text("scmChanged"));
        if (this.busy) {
          if (value.type === "commit") throw new Error(this.text("scmBusy"));
          this.deferredDrafts.set(repository, { value: value.value, editId: editId as number });
        } else repository.inputBox.value = value.value;
        this.draftAcks.set(repository, editId as number);
        if (value.type === "commit") await this.execute("commit", root);
      } finally {
        if (value.type === "commit") {
          this.commitAcks.set(repository, Math.max(this.commitAcks.get(repository) ?? 0, commitId as number));
          await this.publish();
        } else await this.publishInput(repository);
      }
    } catch (error) { this.report(error); await this.publish(); }
  }

  /** Typing must not serialize and reconcile the entire changed-file list on every keystroke. */
  private async publishInput(repository: GitRepository): Promise<void> {
    if (!this.view || !this.ready || this.disposed) return;
    await this.view.webview.postMessage({ type: "input", repository: repository.rootUri.toString(),
      repositoryToken: this.token(repository), message: this.deferredDrafts.get(repository)?.value ?? repository.inputBox.value,
      acknowledgedEditId: this.draftAcks.get(repository) ?? 0 });
  }

  private async execute(action: ScmAction, value?: unknown, selected?: unknown): Promise<void> {
    if (this.disposed || this.busy) return;
    this.busy = true;
    try {
      const entry = this.resolve(value);
      const root = entry.kind === "repository" ? entry : entry.kind === "group" ? entry.parent : entry.parent.parent;
      const repository = this.validRepository(root);
      if (["commit", "stage", "unstage", "discard", "ignore"].includes(action) || isGroupAction(action) && !action.startsWith("open")) {
        if (!vscode.workspace.isTrusted) throw new Error(this.text("scmUntrusted"));
      }
      void this.publish();
      if (action === "commit") {
        if (entry.kind !== "repository") throw new Error(this.text("scmChanged"));
        await vscode.commands.executeCommand("git.commit", repository.rootUri); return;
      }
      if (action === "refresh") { await repository.status(); return; }
      if (entry.kind === "repository") return;
      if (entry.kind === "group") {
        const options = this.options(root), available = groupActions(entry.group, options.mixed);
        const groupAction = isGroupAction(action) ? action : available.find(item => action === "stage" ? item.startsWith("stage")
          : action === "unstage" ? item.startsWith("unstage") : action === "discard" ? item.startsWith("discard") : action === "diff" ? item.startsWith("open") : false);
        if (!groupAction || !available.includes(groupAction)) throw new Error(this.text("scmChanged"));
        const rows = this.groupRows(root, entry.group, groupAction);
        const expected = rows.map(row => changeIdentity(row.change, row.parent.group)).sort();
        const validate = () => {
          this.validRepository(root);
          const current = changeGroups.flatMap(group => changes(repository, group)
            .filter(change => this.targetsGroup(groupAction, entry.group, group, change.status))
            .map(change => changeIdentity(change, group))).sort();
          if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error(this.text("scmChanged"));
        };
        await repository.status(); validate();
        if (groupAction.startsWith("open")) await vscode.commands.executeCommand(groupCommands[groupAction], repository.rootUri);
        else if (rows.length) await this.files(groupAction.startsWith("discard") ? "discard" : groupAction === "unstageAll" ? "unstage" : "stage", rows, validate);
        return;
      }
      let fileAction: FileAction;
      if (action === "openChange") fileAction = this.options(root).openDiff ? "diff" : "open";
      else if (isFileAction(action)) fileAction = action;
      else throw new Error(this.text("scmChanged"));
      const provided = isRecord(value) ? value.eskaScmSelection : undefined;
      const selection = Array.isArray(selected) ? selected.map(item => isRecord(item) ? item.key : item)
        : Array.isArray(provided) ? provided : [];
      const keys = action !== "openChange" && selection.includes(entry.key) ? selection : [entry.key];
      const rows: ChangeEntry[] = [];
      for (const key of new Set(keys)) {
        if (typeof key !== "string") throw new Error(this.text("scmChanged"));
        const row = this.entries.get(key);
        if (!row || row.kind !== "change") throw new Error(this.text("scmChanged"));
        const settings = this.options(row.parent.parent);
        if (fileAction === "diff" || action === "openChange" || fileMenu(row.parent.group, settings.worktree, settings.local, true).includes(fileAction)) rows.push(row);
      }
      await this.files(fileAction, rows);
    } catch (error) { this.report(error); }
    finally {
      this.busy = false;
      for (const [repository, draft] of this.deferredDrafts) {
        if (this.git.repositories.includes(repository)) repository.inputBox.value = draft.value;
      }
      this.deferredDrafts.clear();
      this.invalidate(); await this.publish();
    }
  }

  private targetsGroup(action: string, selected: ChangeGroup, group: ChangeGroup, status: number): boolean {
    if (action === "stageAll") return group === "working" || group === "untracked";
    if (action === "stageAllUntracked" || action === "discardAllUntracked") return (group === "working" || group === "untracked") && (status === 7 || status === 8);
    if (action === "stageAllTracked" || action === "discardAllTracked") return group === "working" && status !== 7 && status !== 8;
    return group === selected;
  }

  private groupRows(root: RepositoryEntry, selected: ChangeGroup, action: string): ChangeEntry[] {
    return root.groups.flatMap(group => group.entries.filter(row => this.targetsGroup(action, selected, group.group, row.change.status)));
  }

  private async files(action: FileAction, rows: ChangeEntry[], validateGroup?: () => void): Promise<void> {
    const api = this.git.api;
    if (!api) throw new Error(this.text("scmGitUnavailable"));
    const repositories = new Map<GitRepository, ChangeEntry[]>();
    for (const row of rows) { const repository = this.validate(row), list = repositories.get(repository) ?? []; list.push(row); repositories.set(repository, list); }
    for (const [repository, entries] of repositories) await executeFileAction(action, {
      api, repository, entries: entries.map(row => ({ group: row.parent.group, change: row.change, label: row.label })),
      text: (key, ...args) => this.text(key, ...args), validate: () => { validateGroup?.(); for (const row of entries) this.validate(row); },
    });
  }

  private async compareRevisions(): Promise<void> {
    try {
      await this.connect();
      const projects = this.contexts().flatMap(context => {
        const repositoryRoot = this.git.api?.getRepository(vscode.Uri.file(context.root))?.rootUri.fsPath;
        const repository = repositoryRoot && this.git.repositories.find(candidate =>
          sourceKey(candidate.rootUri.fsPath) === sourceKey(repositoryRoot));
        const state = context.tree.connection.state;
        const target = state.kind === "ready" ? state.target : undefined;
        if (!repository || !target
          || sourceKey(repository.rootUri.fsPath) !== sourceKey(context.root) && relativeFile(repository.rootUri.fsPath, context.root) === undefined) return [];
        return [{ root: context.root, name: context.project.info.displayName ?? (context.project.info.scope?.kind === "member" ? context.project.info.scope.name : basename(context.root)), executable: target.executable, validate: () => {
          const currentRoot = this.git.api?.getRepository(vscode.Uri.file(context.root))?.rootUri.fsPath;
          if (this.disposed || context.tree.connection.state !== state || !this.contexts().some(current => current.tree === context.tree && current.project === context.project)
            || !currentRoot || sourceKey(currentRoot) !== sourceKey(repository.rootUri.fsPath)
            || !this.git.repositories.includes(repository)) throw new Error(this.text("scmChanged"));
        } }];
      });
      const { compareRevisions } = await import("./scm-compare.js");
      await compareRevisions(projects);
    } catch (error) { this.report(error); }
  }

  private async refresh(): Promise<void> {
    await this.connect();
    try { for (const repository of this.git.repositories) if (this.relevant(repository)) await repository.status(); }
    catch (error) { this.report(error); }
    this.invalidate(); await this.publish();
  }

  private report(error: unknown): void { this.log(String(error)); void vscode.window.showErrorMessage(error instanceof Error ? error.message : this.text("scmFailed")); }
  private text(key: MessageKey, ...values: string[]): string { return message(vscode.env.language, key, ...values); }

  dispose(): void {
    this.disposed = true; this.revision++; clearTimeout(this.timer);
    for (const subscription of [...this.viewSubscriptions.splice(0), ...this.subscriptions.splice(0)]) subscription.dispose();
    this.entries.clear(); this.roots = undefined; this.view = undefined; this.ready = false;
  }
}
