import * as vscode from "vscode";

/** Root marker presence is independent of TOML validity and backend availability. */
export class WorkspaceProjects implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly watchers = new Map<string, vscode.Disposable>();
  private readonly subscription: vscode.Disposable;
  private roots: readonly vscode.WorkspaceFolder[] = [];
  private revision = 0;
  private disposed = false;
  private pending: Promise<void> = Promise.resolve();
  private publishing: Promise<void> = Promise.resolve();

  constructor() {
    this.subscription = vscode.Disposable.from(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.observe()),
      // Native Explorer operations can precede readiness of VS Code's workspace watcher.
      vscode.workspace.onDidCreateFiles(event => this.filesChanged(event.files)),
      vscode.workspace.onDidDeleteFiles(event => this.filesChanged(event.files)),
      vscode.workspace.onDidRenameFiles(event => this.filesChanged(event.files.flatMap(file => [file.oldUri, file.newUri]))),
    );
    this.observe();
  }

  get folders(): readonly vscode.WorkspaceFolder[] { return this.roots; }

  /** A command must not use roots superseded while filesystem checks were pending. */
  async settled(): Promise<void> {
    let pending: Promise<void>;
    do { pending = this.pending; await pending; } while (!this.disposed && pending !== this.pending);
  }

  private observe(): void {
    if (this.disposed) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const keys = new Set(folders.map(folder => folder.uri.toString()));
    for (const [key, watcher] of this.watchers) if (!keys.has(key)) {
      watcher.dispose(); this.watchers.delete(key);
    }
    for (const folder of folders) {
      const key = folder.uri.toString();
      if (this.watchers.has(key)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "eska.toml"), false, true, false);
      this.watchers.set(key, vscode.Disposable.from(watcher,
        watcher.onDidCreate(() => this.refresh()), watcher.onDidDelete(() => this.refresh())));
    }
    this.refresh();
  }

  private refresh(): void {
    const revision = ++this.revision;
    this.pending = this.check(vscode.workspace.workspaceFolders ?? [], revision);
  }

  private filesChanged(files: readonly vscode.Uri[]): void {
    const markers = new Set((vscode.workspace.workspaceFolders ?? []).map(folder => vscode.Uri.joinPath(folder.uri, "eska.toml").toString()));
    if (files.some(file => markers.has(file.toString()))) this.refresh();
  }

  private async check(folders: readonly vscode.WorkspaceFolder[], revision: number): Promise<void> {
    const found = await Promise.all(folders.map(async folder => {
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, "eska.toml"));
        return stat.type & vscode.FileType.File ? folder : undefined;
      } catch { return undefined; }
    }));
    if (this.disposed || revision !== this.revision) return;
    this.roots = found.filter((folder): folder is vscode.WorkspaceFolder => folder !== undefined);
    // Serialize context writes as well as filesystem reads; disposal or a newer check wins.
    this.publishing = this.publishing.then(async () => {
      if (this.disposed || revision !== this.revision) return;
      await vscode.commands.executeCommand("setContext", "eska.hasProject", this.roots.length > 0);
      if (!this.disposed && revision === this.revision) this.changed.fire();
    });
    await this.publishing;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.revision;
    this.subscription.dispose();
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear(); this.roots = []; this.changed.dispose();
    void this.publishing.then(() => vscode.commands.executeCommand("setContext", "eska.hasProject", false));
  }
}
