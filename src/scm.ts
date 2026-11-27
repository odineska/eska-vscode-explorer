import * as vscode from "vscode";
import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { GitRepositories, type GitChange, type GitRepository, type ScmProject } from "./git-api.js";
import { gitStatus, Status } from "./git-status.js";
import { changeCaption, changeGroups, changeIdentity, changes, insideRepository, matchChanges, monitoredChanges, type ChangeGroup } from "./scm-model.js";
import { button, fileActions, fileInline, fileMenu, groupActions, groupCommands, isFileAction, isFileMutation, isGroupAction, type FileAction, type ScmAction } from "./scm-actions.js";
import { executeFileAction, openGroupChanges } from "./scm-file-actions.js";
import { ScmMonitors } from "./scm-monitor.js";
import { SCM_CHECKOUT } from "./scm-repository.js";
import { GIGACODE_EXTENSION, GIGACODE_GENERATE, GIT_EXTENSION, findToolbarCommand, toolbarFromManifest,
  type Toolbar, type ToolbarCommand, type ToolbarItem } from "./scm-toolbar.js";
import { stageSelectedLines } from "./scm-line-staging.js";
import { saveScmScope, ScmSaveError } from "./scm-save.js";
import type { ProjectCommandTarget } from "./project-command.js";
import { message, type MessageKey } from "./messages.js";
import { isRecord, isWirePath, projectEnabled } from "./protocol.js";
import { nativePath, resolveSourcePath, sourceKey } from "./source.js";
import { relativeFile } from "./reveal.js";
import type { MetadataTree, ProjectTree } from "./tree.js";

interface RepositoryEntry { kind: "repository"; key: string; repository: GitRepository; groups: GroupEntry[]; branch: string | undefined }
interface GroupEntry { kind: "group"; key: string; parent: RepositoryEntry; group: ChangeGroup; entries: ChangeEntry[] }
export interface ChangeEntry { kind: "change"; key: string; parent: GroupEntry; change: GitChange; label: string; fromMonitor: boolean }
type Entry = RepositoryEntry | GroupEntry | ChangeEntry;
interface ProjectContext { tree: MetadataTree; project: ProjectTree; root: string; source: string }
interface SaveScope extends ProjectCommandTarget { tree?: MetadataTree; name: string }
type Captions = Record<"ru-RU" | "en-US", string>;
const groupLabels: Record<ChangeGroup, MessageKey> = { merge: "scmMerge", index: "scmIndex", working: "scmWorking", untracked: "scmUntracked" };
const prefix = "eska.explorer.scm";
const pageLimit = 200;
const cachedCaptionLimit = 4096;
interface RepositoryToolbar extends Toolbar { checkout: ToolbarCommand | undefined }

function rowsByGroup(rows: readonly ChangeEntry[]): Map<GroupEntry, ChangeEntry[]> {
  const groups = new Map<GroupEntry, ChangeEntry[]>();
  for (const row of rows) {
    const group = groups.get(row.parent);
    if (group) group.push(row);
    else groups.set(row.parent, [row]);
  }
  return groups;
}

/** Present project changes from the SCM provider selected for each repository. */
export class MetadataChanges implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private viewSubscriptions: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;
  private trees: readonly MetadataTree[] = [];
  private projects: readonly ScmProject[] = [];
  private roots: RepositoryEntry[] | undefined;
  private readonly entries = new Map<string, Entry>();
  private readonly draftAcks = new WeakMap<GitRepository, number>();
  private readonly commitAcks = new WeakMap<GitRepository, number>();
  private revision = 0;
  private readonly repositoryTokens = new WeakMap<GitRepository, string>();
  private readonly deferredDrafts = new Map<GitRepository, { value: string; editId: number }>();
  private readonly monitors: ScmMonitors;
  private labelCache = new WeakMap<ProjectTree, { source: string; names: Map<string, Captions | null> }>();
  private pending: Promise<RepositoryEntry[]> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private busy = false;
  private ready = false;
  private notice: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly git: GitRepositories, private readonly language: () => string,
    private readonly ensureTree: () => Promise<void>, private readonly log: (text: string) => void) {
    this.monitors = new ScmMonitors(() => this.invalidate(), log);
    this.subscriptions.push(this.monitors, vscode.window.registerWebviewViewProvider(prefix, this), git.onDidChange(repository => {
      if (!repository || this.relevant(repository)) this.invalidate();
    }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("eska.explorer.treeLanguage") || event.affectsConfiguration("git")) this.invalidate();
      }));
    this.subscriptions.push(vscode.extensions.onDidChange(() => this.invalidate()));
    for (const action of [...fileActions, ...Object.keys(groupCommands), "openChange", "commit"] as ScmAction[]) {
      this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${action}`, (entry?: unknown, selected?: unknown) => this.execute(action, entry, selected)));
    }
    for (const alias of ["revealWindows", "revealMac", "revealLinux"]) {
      this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.${alias}`, (entry?: unknown) => this.execute("revealOs", entry)));
    }
    this.subscriptions.push(vscode.commands.registerCommand(`${prefix}.refresh`, () => this.refresh()),
      vscode.commands.registerCommand(`${prefix}.stageLines`, () => this.runAction(() => stageSelectedLines(this.git, key => this.text(key)))),
      vscode.commands.registerCommand(`${prefix}.compareRevisions`, () => this.compareRevisions()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    for (const subscription of this.viewSubscriptions.splice(0)) subscription.dispose();
    this.view = view; this.ready = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out"),
      vscode.Uri.joinPath(this.context.extensionUri, "resources", "shared")] };
    this.viewSubscriptions.push(view.webview.onDidReceiveMessage(value => { void this.receive(value); }),
      view.onDidChangeVisibility(() => {
        if (view.visible) { void this.connect(); this.invalidate(); }
        else this.monitors.synchronize([]);
      }),
      view.onDidDispose(() => { if (this.view === view) {
        this.view = undefined; this.ready = false; this.monitors.synchronize([]); this.invalidate();
      } }));
    const nonce = randomBytes(16).toString("hex");
    const uri = (...parts: string[]) => view.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts));
    view.webview.html = `<!doctype html><html lang="${vscode.env.language.startsWith("ru") ? "ru" : "en"}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'none'">
      <link rel="stylesheet" href="${uri("resources", "shared", "ui.css")}"><link rel="stylesheet" href="${uri("out", "scm-view.css")}">
      </head><body><main id="root"></main><script nonce="${nonce}" src="${uri("out", "scm-view.js")}"></script></body></html>`;
  }

  setProjects(projects: readonly ScmProject[]): void {
    if (projects.length === this.projects.length && projects.every((project, index) => {
      const previous = this.projects[index]!;
      return project.root === previous.root && project.mode === previous.mode && project.projectExecutable === previous.projectExecutable;
    })) return;
    this.projects = projects;
    this.invalidate();
  }

  setTrees(trees: readonly MetadataTree[]): void {
    if (trees.length === this.trees.length && trees.every((tree, index) => tree === this.trees[index])) return;
    this.trees = [...trees]; this.invalidate();
  }

  invalidate(): void {
    if (this.disposed) return;
    this.revision++; this.roots = undefined; this.pending = undefined;
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.publish(); }, 35);
  }

  private async connect(): Promise<void> {
    if (this.trees.length || this.disposed || !this.projects.some(project => project.mode !== "vscode")) return;
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

  private relevant(repository: GitRepository): boolean {
    const mode = this.git.modeFor(repository.rootUri.fsPath);
    return repository.rootUri.scheme === "file" && mode !== undefined && mode !== "vscode"
      && this.projects.some(project => project.mode !== "vscode" && this.owns(repository, project.root));
  }

  private owns(repository: GitRepository, path: string): boolean {
    const root = repository.rootUri.fsPath;
    if (sourceKey(root) !== sourceKey(path) && relativeFile(root, path) === undefined) return false;
    const owner = this.git.api.getRepository(vscode.Uri.file(path));
    return owner?.rootUri.scheme === "file" && sourceKey(owner.rootUri.fsPath) === sourceKey(root);
  }

  private displayedChanges(repository: GitRepository, group: ChangeGroup) {
    const snapshot = this.monitors.get(repository.rootUri.fsPath);
    if (!snapshot) return changes(repository, group);
    const mode = vscode.workspace.getConfiguration("git", repository.rootUri).get<string>("untrackedChanges", "mixed");
    return monitoredChanges(repository, group, snapshot, mode);
  }

  private async load(revision: number): Promise<RepositoryEntry[]> {
    const contexts = this.contexts();
    const roots: RepositoryEntry[] = [];
    const repositories = this.git.repositories.filter(repository => this.relevant(repository));
    this.monitors.synchronize(this.view?.visible && vscode.workspace.isTrusted ? repositories.flatMap(repository => {
      if (repository.scmProvider === "eska") return [];
      const project = this.projects.find(candidate => candidate.mode !== "vscode" && this.owns(repository, candidate.root));
      return project ? [{ root: repository.rootUri.fsPath, projectExecutable: project.projectExecutable }] : [];
    }) : []);
    for (const repository of repositories) {
      const snapshot = this.monitors.get(repository.rootUri.fsPath);
      const monitorRows = snapshot && new Set([...snapshot.mergeChanges, ...snapshot.indexChanges,
        ...snapshot.workingTreeChanges, ...snapshot.untrackedChanges]);
      const root: RepositoryEntry = { kind: "repository", key: repository.rootUri.toString(), repository, groups: [],
        branch: snapshot ? snapshot.branch : repository.state.HEAD?.name };
      for (const group of changeGroups) {
        const parent: GroupEntry = { kind: "group", key: `${root.key}:${group}`, parent: root, group, entries: [] };
        const seen = new Set<string>();
        for (const change of this.displayedChanges(repository, group)) {
          if (!insideRepository(repository, change)) continue;
          const identity = changeIdentity(change, group);
          if (seen.has(identity)) continue;
          seen.add(identity);
          parent.entries.push({ kind: "change", key: `${root.key}:${identity}`, parent, change,
            label: basename(change.uri.fsPath), fromMonitor: monitorRows?.has(change) ?? false });
        }
        if (parent.entries.length) root.groups.push(parent);
      }
      roots.push(root);
    }
    const groups = roots.flatMap(root => root.groups);
    const eagerRows = groups.filter(group => group.entries.length <= pageLimit).flatMap(group => group.entries);
    await this.labelRows(eagerRows, contexts, revision);
    if (revision !== this.revision || this.disposed) return [];
    this.entries.clear();
    const collator = new Intl.Collator(this.language());
    for (const root of roots) {
      this.entries.set(root.key, root);
      for (const group of root.groups) {
        this.entries.set(group.key, group);
        for (const entry of group.entries) this.entries.set(entry.key, entry);
        // A page has a stable position even before its metadata captions have been requested.
        if (group.entries.length > pageLimit) {
          group.entries.sort((a, b) => {
            const left = a.change.uri.fsPath, right = b.change.uri.fsPath;
            return left < right ? -1 : left > right ? 1 : collator.compare(a.key, b.key);
          });
        } else group.entries.sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.key, b.key));
      }
    }
    const notice = !repositories.length ? this.text(contexts.length ? "scmGitUnavailable" : "scmConnect") : !groups.length ? this.text("scmNoChanges") : undefined;
    this.notice = notice;
    this.roots = roots;
    return roots;
  }

  /** Load semantic names for the rows being presented, including deleted paths. */
  private async labelRows(entries: ChangeEntry[], contexts: ProjectContext[], revision: number): Promise<void> {
    const result = new Map<string, string>(), requests = new Map<ProjectContext, Set<string>>();
    const language = this.language().startsWith("ru") ? "ru-RU" : "en-US";
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
      let cache = this.labelCache.get(context.project);
      if (!cache || cache.source !== context.source) {
        cache = { source: context.source, names: new Map() };
        this.labelCache.set(context.project, cache);
      }
      const captions = new Map<string, Captions | null>();
      const names: string[] = [];
      for (const path of paths) {
        const caption = cache.names.get(path);
        if (caption === undefined) names.push(path);
        else captions.set(path, caption);
      }
      for (let offset = 0; offset < names.length; offset += 512) {
        if (revision !== this.revision || this.disposed) return;
        const batch = names.slice(offset, offset + 512);
        try {
          const response = await context.tree.request(context.project, "metadata/sourceLabels", { paths: batch.map(value => ({ value, encoding: "utf-8" })) });
          if (revision !== this.revision || this.disposed || !this.trees.includes(context.tree)) return;
          if (!Array.isArray(response.labels) || response.labels.length !== batch.length) throw new Error("Invalid source labels response");
          const accepted = new Map<string, Captions | null>();
          for (let index = 0; index < batch.length; index++) {
            const item = response.labels[index];
            if (!isRecord(item) || !isWirePath(item.path) || nativePath(item.path) !== batch[index]) throw new Error("Invalid source label path");
            if (item.translations !== null && (!isRecord(item.translations) || typeof item.translations["ru-RU"] !== "string"
              || typeof item.translations["en-US"] !== "string")) throw new Error("Invalid source label caption");
            accepted.set(batch[index]!, item.translations as Captions | null);
          }
          if (cache.names.size + accepted.size > cachedCaptionLimit) cache.names.clear();
          for (const [path, caption] of accepted) {
            captions.set(path, caption);
            cache.names.set(path, caption);
          }
        } catch (error) { this.log(`scm_source_labels_failed: ${String(error)}`); }
      }
      for (const [path, caption] of captions) if (caption) {
        const file = resolveSourcePath(context.project.info.sourcePath, { value: path, encoding: "utf-8" });
        result.set(sourceKey(file), caption[language]);
      }
    }
    for (const entry of entries) entry.label = changeCaption(entry.change, result);
  }

  private validRepository(root: RepositoryEntry): GitRepository {
    const repository = root.repository, current = this.git.api.getRepository(repository.rootUri);
    if (!this.git.repositories.includes(repository) || !this.relevant(repository) || !current
      || sourceKey(current.rootUri.fsPath) !== sourceKey(repository.rootUri.fsPath)) throw new Error(this.text("scmChanged"));
    return repository;
  }

  private resolve(value: unknown): Entry {
    if (!isRecord(value) || (value.webview !== undefined && value.webview !== prefix)) throw new Error(this.text("scmChanged"));
    if (value.kind === undefined && (!this.roots || !Number.isSafeInteger(value.eskaScmRevision) || value.eskaScmRevision !== this.revision)) throw new Error(this.text("scmChanged"));
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

  private rowData(group: GroupEntry, rows: ChangeEntry[], options = this.options(group.parent)) {
    const root = group.parent.repository.rootUri.fsPath;
    const canDiscard = group.group === "working" || group.group === "untracked";
    const actions = fileInline(group.group, options.showOpen, options.openDiff, canDiscard).map(action => button(action, key => this.text(key)));
    const context = { webviewSection: "scmChange", eskaScmGroup: group.group, eskaScmUntrackedMixed: options.mixed,
      eskaScmDiscard: canDiscard, eskaScmReveal: group.group !== "untracked",
      eskaScmCompare: options.worktree && (group.group === "index" || group.group === "working") };
    return rows.map(row => {
      const { uri, originalUri } = row.change, status = gitStatus(row.change.status);
      return { key: row.key, label: row.label, description: relativeFile(root, uri.fsPath) ?? "",
        title: [row.label, originalUri.fsPath !== uri.fsPath ? originalUri.fsPath : undefined,
          uri.fsPath, status && this.text(status.message)].filter(Boolean).join("\n"),
        statusLetter: status?.badge, color: status ? `var(--vscode-gitDecoration-${status.color})` : undefined,
        actions, context: { ...context, eskaScmKey: row.key } };
    });
  }

  private async publishPage(request: Record<string, unknown>): Promise<void> {
    const { group, revision, start, count } = request;
    const view = this.view;
    if (!view?.visible || !this.ready || !this.roots || revision !== this.revision || typeof group !== "string"
      || typeof start !== "number" || !Number.isSafeInteger(start) || start < 0
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > pageLimit) return;
    const entry = this.entries.get(group);
    if (entry?.kind !== "group" || entry.entries.length <= pageLimit || start >= entry.entries.length) return;
    const rows = entry.entries.slice(start, start + count);
    await this.labelRows(rows, this.contexts(), revision);
    if (this.disposed || view !== this.view || !view.visible || revision !== this.revision) return;
    await view.webview.postMessage({ type: "rows", revision, group, start, rows: this.rowData(entry, rows) });
  }

  private toolbar(repository: GitRepository): RepositoryToolbar {
    const native = this.git.canUseNativeToolbar(repository);
    const config = vscode.workspace.getConfiguration("git", repository.rootUri);
    const own = repository.scmProvider === "eska";
    const supports = (id: string) => native || id === "git.commit" || id === "git.refresh" || own && id === "git.checkout";
    const context = (key: string): unknown => {
      if (key === "scmProvider") return "git";
      if (key === "scmProviderContext") return repository.kind;
      if (key === "operationInProgress") return false; // ESKA disables the entire toolbar while executing.
      if (key === "gitRebaseInProgress") return repository.state.rebaseCommit !== undefined;
      if (key === "gitState") return native ? "idle" : undefined;
      const version = /^gitVersion(\d+)\.(\d+)$/.exec(key);
      if (version) return this.git.nativeGitAtLeast(Number(version[1]), Number(version[2]));
      if (key.startsWith("config.git.")) return config.get(key.slice("config.git.".length));
      return undefined;
    };
    const git = vscode.extensions.getExtension(GIT_EXTENSION);
    const giga = native ? vscode.extensions.getExtension(GIGACODE_EXTENSION) : undefined;
    const fromGit = toolbarFromManifest(git?.packageJSON, GIT_EXTENSION, context, id => {
      if (id === "git.commit") return this.text("scmCommit");
      if (id === "git.refresh") return this.text("scmRefresh");
      if (id === "git.checkout") return this.text("scmCheckout");
      return undefined;
    }, supports);
    const fromGiga = toolbarFromManifest(giga?.packageJSON, GIGACODE_EXTENSION, context,
      () => this.text("scmGenerateCommitMessage"));
    if (!git) {
      fromGit.inline.push({ id: "git.commit", title: this.text("scmCommit"), icon: "check", extension: GIT_EXTENSION },
        { id: "git.refresh", title: this.text("scmRefresh"), icon: "refresh", extension: GIT_EXTENSION });
    }
    const head = repository.state.HEAD;
    const buttons = config.get<{ sync?: boolean; publish?: boolean }>("showActionButton");
    let shortcut: ToolbarCommand | undefined;
    if (native && head?.name) {
      if (head.upstream && (head.ahead || head.behind) && buttons?.sync !== false) {
        shortcut = findToolbarCommand(fromGit.overflow, "git.sync");
      } else if (!head.upstream && buttons?.publish !== false && repository.state.remotes?.some(remote => !remote.isReadOnly)) {
        shortcut = findToolbarCommand(fromGit.overflow, "git.publish");
      }
    }
    const inline = [...fromGit.inline, ...fromGiga.inline];
    if (shortcut && !inline.some(item => item.id === shortcut.id)) inline.unshift(shortcut);
    const checkout = own ? { id: "git.checkout", title: this.text("scmCheckout"), extension: GIT_EXTENSION } as const
      : findToolbarCommand(fromGit.overflow, "git.checkout") ?? fromGit.inline.find(item => item.id === "git.checkout");
    return { inline, overflow: [...fromGit.overflow, ...fromGiga.overflow], checkout };
  }

  private async executeToolbar(root: RepositoryEntry, command: ToolbarCommand): Promise<void> {
    const repository = this.validRepository(root);
    if (command.id === "git.commit" || command.id === "git.refresh") {
      await this.execute(command.id === "git.commit" ? "commit" : "refresh", root);
      return;
    }
    await this.runAction(async () => {
      this.validRepository(root);
      if (!vscode.workspace.isTrusted) throw new Error(this.text("scmUntrusted"));
      void this.publish();
      if (command.id === "git.checkout" && repository.scmProvider === "eska") {
        await vscode.commands.executeCommand(SCM_CHECKOUT, repository.rootUri.fsPath);
      } else await this.git.runNativeToolbarCommand(repository, command.id);
    });
  }

  private async selectToolbarCommand(repository: GitRepository, menu: ToolbarItem[]): Promise<ToolbarCommand | undefined> {
    const items: (vscode.QuickPickItem & { command?: ToolbarCommand })[] = [];
    const visit = (group: ToolbarItem[], heading?: string) => {
      const available = group.filter((item): item is ToolbarCommand => "id" in item);
      if (available.length && heading) items.push({ label: heading, kind: vscode.QuickPickItemKind.Separator });
      items.push(...available.map(command => ({ label: command.title, command })));
      for (const item of group) if ("items" in item) visit(item.items, item.title);
    };
    visit(menu);
    if (items.length) return (await vscode.window.showQuickPick(items, {
      title: this.text("scmRepositoryActions"), placeHolder: basename(repository.rootUri.fsPath),
    }))?.command;
    return undefined;
  }

  private async publish(): Promise<void> {
    if (!this.view?.visible || !this.ready || this.disposed) return;
    const revision = this.revision, roots = await this.getChildren();
    if (revision !== this.revision || !this.view?.visible || !this.ready || this.disposed) return;
    const text = (key: MessageKey) => this.text(key);
    const repositories = (roots as RepositoryEntry[]).map(root => {
      const options = this.options(root), repository = root.repository;
      const context = { webviewSection: "scmRepository", eskaScmKey: root.key };
      const toolbar = this.toolbar(repository);
      const actions = toolbar.inline.map(({ id, title, icon }) => ({ id,
        title: id === GIGACODE_GENERATE ? text("scmGenerateCommitMessage") : id === "git.refresh" ? text("scmRefresh") : title,
        icon: id === GIGACODE_GENERATE ? "sparkle" : id === "git.sync" ? "sync" : icon }));
      return { key: root.key, label: basename(repository.rootUri.fsPath), description: repository.rootUri.fsPath,
        repositoryToken: this.token(repository), branch: root.branch, message: this.deferredDrafts.get(repository)?.value ?? repository.inputBox.value, acknowledgedEditId: this.draftAcks.get(repository) ?? 0,
        acknowledgedCommitId: this.commitAcks.get(repository) ?? 0, busy: this.busy || !vscode.workspace.isTrusted,
        actions, hasMenu: toolbar.overflow.length > 0,
        canCheckout: !!toolbar.checkout,
        context, groups: root.groups.map(group => {
          return { key: group.key, kind: group.group, label: this.text(groupLabels[group.group]), count: group.entries.length,
            actions: groupActions(group.group, options.mixed).map(action => button(action, text)),
            context: { eskaScmGroup: group.group, eskaScmUntrackedMixed: options.mixed, webviewSection: "scmGroup", eskaScmKey: group.key },
            ...(group.entries.length <= pageLimit ? { rows: this.rowData(group, group.entries, options) } : {}) };
        }) };
    });
    await this.view.webview.postMessage({ type: "snapshot", revision, busy: this.busy, notice: this.notice, repositories,
      labels: { commit: this.text("scmCommit"), message: this.text("scmMessage"), repository: this.text("scmRepository"),
        commitHint: this.text("scmSaveHint"), noChanges: this.text("scmNoChanges"), changes: this.text("scmWorking"),
        collapse: this.text("scmCollapse"), expand: this.text("scmExpand"),
        repositoryActions: text("scmRepositoryActions"), checkout: text("scmCheckout") } });
  }

  private async receive(value: unknown): Promise<void> {
    if (!isRecord(value) || this.disposed) return;
    try {
      if (value.type === "ready") { this.ready = true; await this.connect(); await this.publish(); return; }
      if (value.type === "rows") { await this.publishPage(value); return; }
      if (value.type === "toolbar") {
        const root = typeof value.repository === "string" ? this.entries.get(value.repository) : undefined;
        if (this.busy || !root || root.kind !== "repository" || value.repositoryToken !== this.token(root.repository)) return;
        const repository = this.validRepository(root), toolbar = this.toolbar(repository);
        let command: ToolbarCommand | undefined;
        if (value.action === "menu") command = await this.selectToolbarCommand(repository, toolbar.overflow);
        else if (value.action === "git.checkout") command = toolbar.checkout;
        else command = toolbar.inline.find(item => item.id === value.action);
        const current = this.entries.get(root.key);
        if (command && current?.kind === "repository" && current.repository === repository && !this.disposed) {
          if (value.action === "menu" &&
            findToolbarCommand(this.toolbar(repository).overflow, command.id)?.extension !== command.extension) return;
          await this.executeToolbar(current, command);
        }
        return;
      }
      if (value.type === "action" && typeof value.action === "string") {
        const action = value.action;
        if (isFileAction(action) || isGroupAction(action) || action === "openChange" || action === "refresh") {
          await this.execute(action, { eskaScmKey: value.key, eskaScmRevision: value.revision,
            eskaScmSelection: value.selection, eskaScmSelectionRanges: value.selectionRanges });
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

  /** Positional selections belong to the displayed revision, which resolve() has already checked. */
  private selectedKeys(value: unknown, selected: unknown): Set<unknown> {
    if (Array.isArray(selected)) return new Set(selected.map(item => isRecord(item) ? item.key : item));
    const keys = new Set<unknown>(isRecord(value) && Array.isArray(value.eskaScmSelection) ? value.eskaScmSelection : []);
    if (!isRecord(value) || value.eskaScmSelectionRanges === undefined) return keys;
    if (!Array.isArray(value.eskaScmSelectionRanges)) throw new Error(this.text("scmChanged"));
    const ranges = new Map<GroupEntry, { start: number; end: number }[]>();
    for (const range of value.eskaScmSelectionRanges) {
      const group = isRecord(range) && typeof range.group === "string" && this.entries.get(range.group);
      if (!group || group.kind !== "group" || typeof range.start !== "number" || typeof range.end !== "number"
        || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
        || range.start < 0 || range.end < range.start || range.end >= group.entries.length) throw new Error(this.text("scmChanged"));
      const intervals = ranges.get(group) ?? [];
      intervals.push({ start: range.start, end: range.end });
      ranges.set(group, intervals);
    }
    for (const [group, intervals] of ranges) {
      let covered = -1;
      for (const { start, end } of intervals.sort((a, b) => a.start - b.start)) {
        for (let index = Math.max(start, covered + 1); index <= end; index++) keys.add(group.entries[index]!.key);
        covered = Math.max(covered, end);
      }
    }
    return keys;
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.disposed || this.busy) return;
    this.busy = true;
    try { await action(); }
    catch (error) { this.report(error); }
    finally {
      this.busy = false;
      for (const [repository, draft] of this.deferredDrafts) {
        if (this.git.repositories.includes(repository)) repository.inputBox.value = draft.value;
      }
      this.deferredDrafts.clear();
      this.invalidate(); await this.publish();
    }
  }

  private async execute(action: ScmAction, value?: unknown, selected?: unknown): Promise<void> {
    await this.runAction(async () => {
      const entry = this.resolve(value);
      const root = entry.kind === "repository" ? entry : entry.kind === "group" ? entry.parent : entry.parent.parent;
      const repository = this.validRepository(root);
      if (action === "commit" || isFileMutation(action) || isGroupAction(action) && !action.startsWith("open")) {
        if (!vscode.workspace.isTrusted) throw new Error(this.text("scmUntrusted"));
      }
      void this.publish();
      if (action === "commit") {
        if (entry.kind !== "repository") throw new Error(this.text("scmChanged"));
        await this.commit(root); return;
      }
      if (action === "refresh") { this.monitors.restart(repository.rootUri.fsPath); await repository.status(); return; }
      if (entry.kind === "repository") return;
      if (entry.kind === "group") {
        const options = this.options(root), available = groupActions(entry.group, options.mixed);
        const groupAction = isGroupAction(action) ? action : available.find(item => action === "stage" ? item.startsWith("stage")
          : action === "unstage" ? item.startsWith("unstage") : action === "discard" ? item.startsWith("discard") : action === "diff" ? item.startsWith("open") : false);
        if (!groupAction || !available.includes(groupAction)) throw new Error(this.text("scmChanged"));
        await repository.status();
        const rows = this.reconcileRows(this.groupRows(root, entry.group, groupAction), groupAction.startsWith("discard"));
        const expected = rows.map(row => changeIdentity(row.change, row.parent.group)).sort();
        const validate = () => {
          this.validRepository(root);
          const current = changeGroups.flatMap(group => changes(repository, group)
            .filter(change => this.targetsGroup(groupAction, entry.group, group, change.status))
            .map(change => changeIdentity(change, group))).sort();
          if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error(this.text("scmChanged"));
        };
        validate();
        if (groupAction.startsWith("open")) {
          if (repository.scmProvider === "eska") {
            await openGroupChanges(rows.map(row => ({ change: row.change, group: row.parent.group, label: row.label })),
              this.git.api, repository, this.text(groupLabels[entry.group]));
          } else await vscode.commands.executeCommand(groupCommands[groupAction], repository.rootUri);
        } else if (rows.length) await this.files(groupAction.startsWith("discard") ? "discard" : groupAction === "unstageAll" ? "unstage" : "stage", rows, validate, true);
        return;
      }
      let fileAction: FileAction;
      if (action === "openChange") fileAction = this.options(root).openDiff ? "diff" : "open";
      else if (isFileAction(action)) fileAction = action;
      else throw new Error(this.text("scmChanged"));
      const selection = action === "openChange" ? new Set() : this.selectedKeys(value, selected);
      const keys = selection.has(entry.key) ? selection : [entry.key];
      const rows: ChangeEntry[] = [];
      for (const key of keys) {
        if (typeof key !== "string") throw new Error(this.text("scmChanged"));
        const row = this.entries.get(key);
        if (!row || row.kind !== "change") throw new Error(this.text("scmChanged"));
        const settings = this.options(row.parent.parent);
        if (fileAction === "diff" || action === "openChange" || fileMenu(row.parent.group, settings.worktree, settings.local, true).includes(fileAction)) rows.push(row);
      }
      await this.files(fileAction, rows);
    });
  }

  private targetsGroup(action: string, selected: ChangeGroup, group: ChangeGroup, status: number): boolean {
    if (action === "stageAll") return group === "working" || group === "untracked";
    if (action === "stageAllUntracked" || action === "discardAllUntracked") return (group === "working" || group === "untracked") && (status === Status.Untracked || status === Status.Ignored);
    if (action === "stageAllTracked" || action === "discardAllTracked") return group === "working" && status !== Status.Untracked && status !== Status.Ignored;
    return group === selected;
  }

  private groupRows(root: RepositoryEntry, selected: ChangeGroup, action: string): ChangeEntry[] {
    return root.groups.flatMap(group => group.entries.filter(row => this.targetsGroup(action, selected, group.group, row.change.status)));
  }

  private async files(action: FileAction, rows: ChangeEntry[], validateGroup?: () => void, statusFresh = false): Promise<void> {
    const api = this.git.api;
    const repositories = new Map<GitRepository, ChangeEntry[]>();
    this.validateRows(rows, statusFresh);
    for (const row of rows) { const repository = row.parent.parent.repository, list = repositories.get(repository) ?? []; list.push(row); repositories.set(repository, list); }
    const mutation = isFileMutation(action);
    for (const [repository, selected] of repositories) {
      if (mutation && !statusFresh) await repository.status();
      const entries = mutation && !statusFresh ? this.reconcileRows(selected, action === "discard" || action === "ignore") : selected;
      await executeFileAction(action, {
        api, repository, statusFresh: mutation || statusFresh, entries: entries.map(row => ({ group: row.parent.group, change: row.change, label: row.label })),
        text: (key, ...args) => this.text(key, ...args),
        validate: () => { validateGroup?.(); this.validateRows(entries, mutation); },
      });
    }
  }

  private validateRows(rows: readonly ChangeEntry[], native: boolean): void {
    for (const [parent, selected] of rowsByGroup(rows)) {
      const repository = this.validRepository(parent.parent);
      const current = new Set((native ? changes(repository, parent.group) : this.displayedChanges(repository, parent.group))
        .map(change => changeIdentity(change, parent.group)));
      for (const row of selected) {
        if (!current.has(changeIdentity(row.change, parent.group))
          || !insideRepository(repository, row.change, path => this.owns(repository, path))) throw new Error(this.text("scmChanged"));
      }
    }
  }

  /** Refine monitor rows only when native Git explains every endpoint already displayed. */
  private reconcileRows(selected: ChangeEntry[], destructive: boolean): ChangeEntry[] {
    const result = new Map<string, ChangeEntry>();
    for (const [parent, rows] of rowsByGroup(selected)) {
      const repository = this.validRepository(parent.parent);
      const available = (destructive ? rows : parent.entries).map(row => row.change);
      const matches = matchChanges(repository, parent.group, available, path => this.owns(repository, path));
      for (const row of rows) {
        const selectedIdentity = changeIdentity(row.change, parent.group);
        const change = matches.get(selectedIdentity);
        if (!change) throw new Error(this.text("scmChanged"));
        const identity = changeIdentity(change, parent.group);
        if (!row.fromMonitor && identity !== selectedIdentity) throw new Error(this.text("scmChanged"));
        result.set(identity, { ...row, change });
      }
    }
    return [...result.values()];
  }

  private saveScopes(repository: GitRepository): SaveScope[] {
    const scopes = new Map<string, SaveScope>();
    for (const { tree, project, root } of this.contexts()) {
      const state = tree.connection.state;
      if (!this.owns(repository, root) || state.kind !== "ready" || !state.target) continue;
      const workspace = project.info.scope.kind === "member"
        && sourceKey(state.target.path) === sourceKey(repository.rootUri.fsPath)
        && tree.projects.every(member => this.owns(repository, nativePath(member.info.rootPath)));
      const path = workspace ? state.target.path : root;
      const name = workspace ? basename(path) : project.info.displayName
        ?? (project.info.scope.kind === "member" ? project.info.scope.name : basename(path));
      scopes.set(sourceKey(path), { tree, root: path, executable: state.target.executable, workspace, name });
    }
    // A marked folder can be monitored before its metadata tree is connected.
    // The CLI resolves standalone and workspace manifests from that exact directory.
    for (const project of this.projects) {
      if (project.mode === "vscode" || !this.owns(repository, project.root)) continue;
      if (this.trees.some(tree => tree.connection.state.kind === "ready"
        && sourceKey(tree.connection.state.target.path) === sourceKey(project.root))) continue;
      const key = sourceKey(project.root);
      if (!scopes.has(key)) scopes.set(key, { root: project.root, executable: project.projectExecutable, name: basename(project.root) });
    }
    return [...scopes.values()];
  }

  private async commit(entry: RepositoryEntry): Promise<void> {
    const { repository } = entry;
    const draft = repository.inputBox.value;
    const displayedIndex = entry.groups.find(group => group.group === "index")?.entries;
    await repository.status();
    this.validRepository(entry);
    if (this.disposed) throw new Error(this.text("scmChanged"));
    const candidates = this.saveScopes(repository);
    if (!candidates.length) throw new Error(this.text("scmSaveNoProject"));
    const { name: branch, commit: revision } = repository.state.HEAD ?? {};
    const initialIndex = repository.state.indexChanges;
    const scope = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map(candidate => ({
      label: candidate.name, description: candidate.root, candidate,
    })), { title: this.text("scmSaveScope") }))?.candidate;
    if (!scope) return;
    const inScope = (change: GitChange) => [change.uri, change.originalUri, change.renameUri]
      .some(uri => uri && relativeFile(scope.root, uri.fsPath) !== undefined);
    const wasStaged = initialIndex.some(inScope) || displayedIndex?.some(row => inScope(row.change));
    const validate = () => {
      this.validRepository(entry);
      const head = repository.state.HEAD;
      if (this.disposed || branch !== head?.name || revision !== head?.commit || !this.saveScopes(repository).some(candidate => candidate.tree === scope.tree
        && candidate.root === scope.root && candidate.executable === scope.executable && candidate.workspace === scope.workspace)) {
        throw new Error(this.text("scmChanged"));
      }
    };
    const refresh = async () => {
      validate();
      await repository.status();
      // Losing the staged selection while a prompt is open must never broaden a commit.
      return wasStaged || repository.state.indexChanges.some(inScope) ? "staged" : "all";
    };
    let acceptedDraft = draft;
    const acceptMessage = (value: string) => {
      acceptedDraft = value;
      if (!this.deferredDrafts.has(repository) && repository.inputBox.value === draft) repository.inputBox.value = value;
    };
    if (!await saveScmScope({ ...scope, repositoryRoot: repository.rootUri.fsPath, validate, refresh, acceptMessage }, draft)) return;
    if (repository.inputBox.value === acceptedDraft) repository.inputBox.value = "";
    try { await repository.status(); } catch { this.log("scm_status_after_save_failed"); }
  }

  private async compareRevisions(): Promise<void> {
    try {
      await this.connect();
      const projects = this.contexts().flatMap(context => {
        const repositoryRoot = this.git.api.getRepository(vscode.Uri.file(context.root))?.rootUri.fsPath;
        const repository = repositoryRoot && this.git.repositories.find(candidate =>
          sourceKey(candidate.rootUri.fsPath) === sourceKey(repositoryRoot));
        const state = context.tree.connection.state;
        const target = state.kind === "ready" ? state.target : undefined;
        if (!repository || !target || !this.relevant(repository)
          || sourceKey(repository.rootUri.fsPath) !== sourceKey(context.root) && relativeFile(repository.rootUri.fsPath, context.root) === undefined) return [];
        return [{ root: context.root, name: context.project.info.displayName ?? (context.project.info.scope?.kind === "member" ? context.project.info.scope.name : basename(context.root)), executable: target.executable, validate: () => {
          const currentRoot = this.git.api.getRepository(vscode.Uri.file(context.root))?.rootUri.fsPath;
          if (this.disposed || context.tree.connection.state !== state || !this.contexts().some(current => current.tree === context.tree && current.project === context.project)
            || !currentRoot || sourceKey(currentRoot) !== sourceKey(repository.rootUri.fsPath)
            || !this.git.repositories.includes(repository) || !this.relevant(repository)) throw new Error(this.text("scmChanged"));
        } }];
      });
      const { compareRevisions } = await import("./scm-compare.js");
      await compareRevisions(projects);
    } catch (error) { this.report(error); }
  }

  private async refresh(): Promise<void> {
    this.git.retryScm();
    await this.connect();
    this.labelCache = new WeakMap();
    try { for (const repository of this.git.repositories) if (this.relevant(repository)) {
      this.monitors.restart(repository.rootUri.fsPath);
      await repository.status();
    } }
    catch (error) { this.report(error); }
    this.invalidate(); await this.publish();
  }

  private report(error: unknown): void {
    this.log(String(error));
    const message = error instanceof Error ? error.message : this.text("scmFailed");
    void vscode.window.showErrorMessage(error instanceof ScmSaveError && error.diagnostic ? `${message}\n${error.diagnostic}` : message);
  }
  private text(key: MessageKey, ...values: string[]): string { return message(vscode.env.language, key, ...values); }

  dispose(): void {
    this.disposed = true; this.revision++; clearTimeout(this.timer);
    for (const subscription of [...this.viewSubscriptions.splice(0), ...this.subscriptions.splice(0)]) subscription.dispose();
    this.entries.clear(); this.roots = undefined; this.view = undefined; this.ready = false;
  }
}
