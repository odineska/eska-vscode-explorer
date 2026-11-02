import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ExplorerError, isRecord, projectEnabled } from "../protocol.js";
import { existingSource, nativePath, editorRange, resolveSource, isForm } from "../source.js";
import { revealFile } from "../reveal.js";
import { type MetadataTree, type TreeEntry, nodeKey } from "../tree.js";
import type { Connection } from "../connection.js";
import { querySnapshot } from "../query/text-transfer.js";
import { FormSession, type Overlay } from "./client.js";
import { identityKey, isIdentity, type FormSnapshot, type ElementIdentity, type FormNode, type FormTarget } from "./protocol.js";
import { formStrings } from "./strings.js";

const VIEW_TYPE = "eska.formViewer";
type Role = "main" | "preview";
interface Frame { panel: vscode.WebviewPanel; role: Role; ready: boolean }
interface View {
  key: string; path: string; entry: TreeEntry; tree: MetadataTree; application: string | undefined; title: string; frames: Map<Role, Frame>;
  client: FormSession | undefined; snapshot: FormSnapshot | undefined; nodes: Map<string, FormNode>; selected: ElementIdentity | undefined;
  phase: "loading" | "ready" | "stale" | "disconnected"; notice: string; sequence: number; wanted: number; running: Promise<void> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined; suspended: boolean; closed: boolean; watchers: vscode.Disposable[]; watchKey: string;
  inputs: Map<string, string>; generation: string;
}
function normalized(path: string): string { return process.platform === "win32" ? path.toLowerCase() : path; }

/** Panels are disposable consumers of one backend session. File events never focus or reopen a panel. */
export class FormPreviewService implements vscode.Disposable {
  private readonly views = new Map<string, View>();
  private readonly opening = new Map<string, Promise<View>>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly closing = new Set<Promise<void>>();
  private stopping: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly connection: Connection,
    private readonly tree: () => MetadataTree | undefined, private readonly ensureTree: () => Promise<MetadataTree | undefined>,
    private readonly application: () => string | undefined, private readonly locale: () => string,
    private readonly sourceUri: (path: string) => Promise<vscode.Uri>, private readonly log: (value: string) => void) {
    const changed = (document: vscode.TextDocument) => { void this.documentChanged(document).catch(error => this.log(String(error))); };
    this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => changed(event.document)), vscode.workspace.onDidSaveTextDocument(changed),
      vscode.workspace.onDidCloseTextDocument(changed), connection.beforeStop(() => this.suspend()),
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, { deserializeWebviewPanel: (panel, state) => this.restore(panel, state) }));
  }
  private strings(): Record<string, string> { return formStrings(this.locale()); }
  async show(entry: TreeEntry): Promise<void> {
    if (this.disposed || !isForm(entry)) return;
    const tree = this.tree(); if (!tree || !tree.projects.includes(entry.project)) return;
    const path = (await resolveSource(tree, entry, "form")).path;
    const view = await this.view(tree, entry, path, this.application());
    const frame = view.frames.get("main") ?? this.frame(view, "main"); frame.panel.reveal();
    this.schedule(view, 0);
  }
  private async view(tree: MetadataTree, entry: TreeEntry, path: string, application: string | undefined): Promise<View> {
    const key = `${normalized(path)}\0${application ?? ""}`;
    const existing = this.views.get(key) ?? [...this.views.values()].find(view => normalized(view.path) === normalized(path) && application !== undefined && view.application === application);
    if (existing) return existing;
    const pending = this.opening.get(key); if (pending) return pending;
    const create = Promise.resolve().then(() => {
      const view: View = { key, tree, entry, path, application, title: `${this.strings().title}: ${entry.node.label.kind === "name" ? entry.node.label.text : ""}`,
        frames: new Map(), client: undefined, snapshot: undefined, nodes: new Map(), selected: undefined, phase: "loading", notice: "", sequence: 0, wanted: 0,
        running: undefined, timer: undefined, suspended: false, closed: false, watchers: [], watchKey: "", inputs: new Map(), generation: "" };
      this.views.set(key, view); return view;
    });
    this.opening.set(key, create); try { return await create; } finally { this.opening.delete(key); }
  }
  private frame(view: View, role: Role, restored?: vscode.WebviewPanel): Frame {
    const panel = restored ?? vscode.window.createWebviewPanel(VIEW_TYPE, role === "main" ? view.title : `${view.title} — ${this.strings().preview}`,
      role === "main" ? vscode.ViewColumn.One : vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out")] });
    const frame = { panel, role, ready: false }; view.frames.set(role, frame);
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out")] };
    panel.webview.onDidReceiveMessage(value => { void this.receive(view, frame, value).catch(error => this.failure(view, error)); });
    panel.onDidDispose(() => { if (view.frames.get(role) === frame) view.frames.delete(role); if (!view.frames.size) this.release(view); else this.publish(view); });
    panel.webview.html = this.html(panel.webview);
    return frame;
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("hex"), base = vscode.Uri.joinPath(this.context.extensionUri, "out");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(base, "form-preview.js")), style = webview.asWebviewUri(vscode.Uri.joinPath(base, "form-preview.css"));
    return `<!doctype html><html lang="${this.locale().startsWith("ru") ? "ru" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}"><link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  private async receive(view: View, frame: Frame, value: unknown): Promise<void> {
    if (view.closed || this.disposed || !isRecord(value)) return;
    if (value.type === "ready") { frame.ready = true; this.publish(view); return; }
    if (value.type === "refresh") { if (!this.tree()) await this.ensureTree(); view.suspended = false; this.schedule(view, 0); return; }
    if (value.type === "select" && isIdentity(value.identity) && view.nodes.has(identityKey(value.identity))) {
      view.selected = value.identity;
      for (const target of view.frames.values()) if (target.ready) void target.panel.webview.postMessage({ type: "selection", identity: value.identity }); return;
    }
    if (value.type === "detach") { await this.detach(view); return; }
    if (value.type === "revealPreview") { view.frames.get("preview")?.panel.reveal(); return; }
    if (value.type === "dock") { const main = view.frames.get("main") ?? this.frame(view, "main"); view.frames.get("preview")?.panel.dispose(); main.panel.reveal(); this.publish(view); return; }
    if (value.type === "source") { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(await this.sourceUri(view.path)), { preview: false }); return; }
    if (value.type === "locate" && isRecord(value.target)) await this.locate(view, value.target as unknown as FormTarget);
  }
  /** The native command targets only our active preview panel, after checking its identity and command availability. */
  private async detach(view: View): Promise<void> {
    const frame = view.frames.get("preview") ?? this.frame(view, "preview"); frame.panel.reveal(vscode.ViewColumn.Beside, false); this.publish(view);
    if ((await vscode.commands.getCommands(true)).includes("workbench.action.moveEditorToNewWindow") && frame.panel.active) {
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    } else { view.notice = this.strings().floatFailed!; this.publish(view); }
  }
  private async documentChanged(document: vscode.TextDocument): Promise<void> {
    if (this.disposed || document.uri.scheme !== "file") return;
    const path = normalized(await realpath(document.uri.fsPath).catch(() => document.uri.fsPath));
    for (const view of this.views.values()) if (view.inputs.has(path) || normalized(view.path) === path) this.schedule(view);
  }
  private schedule(view: View, delay = 120): void {
    if (view.closed || view.suspended || this.disposed) return;
    view.wanted++; if (view.timer) clearTimeout(view.timer);
    view.timer = setTimeout(() => { view.timer = undefined; if (!view.running) { view.running = this.refresh(view).finally(() => { view.running = undefined; }); } }, delay);
  }
  private async refresh(view: View): Promise<void> {
    for (;;) {
      const wanted = view.wanted;
      if (view.closed || view.suspended || this.disposed) return;
      try {
        const tree = this.tree(); const state = this.connection.state;
        if (!tree || state.kind !== "ready" || !state.formPreview) throw new ExplorerError("incompatible");
        if (tree !== view.tree || !view.client || view.generation !== view.entry.project.info.generation) {
          const found = await revealFile(tree, view.path), entry = found && "owner" in found ? found.owner : found;
          if (!entry || !isForm(entry) || !projectEnabled(entry.project.info)) throw new ExplorerError("sourceMissing");
          if (view.client && (tree !== view.tree || nodeKey(entry.node.id) !== nodeKey(view.entry.node.id))) { await view.client.close().catch(() => {}); view.client = undefined; }
          view.tree = tree; view.entry = entry;
        }
        view.phase = "loading"; view.notice = this.strings().updating!; this.publish(view, false);
        const opened = !view.client;
        if (!view.client) {
          this.watchInitial(view);
          try { view.client = await FormSession.open(this.connection, tree, view.entry, state.formPreview, view.application); }
          catch (error) {
            if (error instanceof ExplorerError && error.details?.reason === "application_required" && Array.isArray(error.details.available)) {
              const available = error.details.available.filter((value): value is string => typeof value === "string");
              const chosen = await vscode.window.showQuickPick(available, { placeHolder: this.strings().application! });
              if (!chosen) throw error; view.application = chosen;
              view.client = await FormSession.open(this.connection, tree, view.entry, state.formPreview, chosen);
            } else throw error;
          }
        }
        await this.watch(view, view.client.current);
        const overlays = await this.overlays(view);
        const snapshot = opened && !overlays.length ? view.client.current : await view.client.update(overlays);
        if (view.closed || view.suspended || this.disposed) return;
        view.generation = view.entry.project.info.generation; await this.watch(view, snapshot);
        if (wanted === view.wanted) {
          view.snapshot = snapshot; view.phase = "ready"; view.notice = snapshot.modelComplete ? "" : this.strings().incomplete!;
          view.nodes.clear(); const visit = (node: FormNode): void => { view.nodes.set(identityKey(node.identity), node); node.children.forEach(visit); node.auxiliary.forEach(visit); }; visit(snapshot.model.root);
          if (!view.selected || !view.nodes.has(identityKey(view.selected))) view.selected = snapshot.model.root.identity;
          this.publish(view);
        }
      } catch (error) { if (wanted === view.wanted && !view.suspended) this.failure(view, error); }
      if (wanted === view.wanted) return;
      if (view.timer) { clearTimeout(view.timer); view.timer = undefined; }
    }
  }
  private async overlays(view: View): Promise<Overlay[]> {
    const result = new Map<string, Overlay>();
    for (const document of vscode.workspace.textDocuments.filter(document => document.uri.scheme === "file" && document.isDirty)) {
      const path = normalized(await realpath(document.uri.fsPath).catch(() => document.uri.fsPath)), source = view.inputs.get(path); if (!source) continue;
      const text = document.getText(), previous = result.get(source);
      if (previous && previous.text !== text) throw new ExplorerError("sourceChanged");
      result.set(source, { source, text, version: String(document.version) });
    }
    return [...result.values()];
  }
  private watchInitial(view: View): void {
    if (view.watchKey) return;
    // A malformed first disk snapshot has no backend dependencies yet. Watch its checked file
    // so correcting the source recovers the panel without closing or manually refreshing it.
    const uri = vscode.Uri.file(view.path), parent = vscode.Uri.joinPath(uri, "..");
    const source = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(parent, uri.path.split("/").at(-1)!));
    const changed = () => this.schedule(view);
    view.watchKey = "initial";
    view.watchers.push(source, source.onDidChange(changed), source.onDidCreate(changed), source.onDidDelete(changed));
  }
  private async watch(view: View, snapshot: FormSnapshot): Promise<void> {
    const key = JSON.stringify(snapshot.dependencies.map(dependency => [dependency.id, dependency.root, dependency.path]));
    if (view.watchKey === key) return;
    const inputs = new Map<string, string>(), roots = new Map<string, vscode.Uri>();
    for (const dependency of snapshot.dependencies) {
      const path = await existingSource(dependency.root, dependency.path); inputs.set(normalized(await realpath(path)), dependency.id);
      const root = nativePath(dependency.root); roots.set(normalized(root), vscode.Uri.file(root));
    }
    view.inputs = inputs; view.watchKey = key;
    for (const watcher of view.watchers) watcher.dispose(); view.watchers = [];
    for (const root of roots.values()) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
      const changed = (uri: vscode.Uri) => { const path = normalized(uri.fsPath); if (inputs.has(path) || /[\\/](?:StyleItems|Styles|CommonPictures)[\\/]/.test(uri.fsPath)) this.schedule(view); };
      view.watchers.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    }
  }
  private publish(view: View, model = true): void {
    for (const frame of view.frames.values()) if (frame.ready) void frame.panel.webview.postMessage({ type: "state", sequence: ++view.sequence, title: frame.panel.title,
      role: frame.role, phase: view.phase, notice: view.notice, locale: this.locale(), culture: Intl.DateTimeFormat().resolvedOptions().locale, os: process.platform, strings: this.strings(), detached: view.frames.has("preview"),
      restore: { path: view.path, application: view.application ?? view.snapshot?.application ?? undefined, role: frame.role },
      ...(view.selected ? { selection: view.selected } : {}), ...(model && view.snapshot ? { model: view.snapshot.model } : {}) });
  }
  private failure(view: View, error: unknown): void {
    if (view.closed || this.disposed) return;
    view.phase = view.snapshot ? "stale" : "loading";
    const reason = error instanceof ExplorerError ? error.details?.reason : undefined;
    view.notice = error instanceof ExplorerError && error.code === "incompatible" ? this.strings().incompatible!
      : view.snapshot ? this.strings().stale! : reason === "not_managed_form" ? this.strings().notManaged! : this.strings().unavailable!;
    this.log(JSON.stringify({ event: "form_preview_failed", code: error instanceof ExplorerError ? error.code : "requestFailed", reason })); this.publish(view, false);
  }
  private async locate(view: View, target: FormTarget): Promise<void> {
    if (!view.client || view.phase !== "ready") throw new ExplorerError("sourceChanged");
    if (target.kind !== "definition" && (!isIdentity(target.identity) || !view.nodes.has(identityKey(target.identity)))) return;
    const location = await view.client.locate(target), path = await existingSource(location.root, location.path);
    const dependency = view.client.current.dependencies.find(dependency => dependency.id === location.source);
    const uri = await this.sourceUri(path), document = await vscode.workspace.openTextDocument(uri);
    const bytes = dependency?.version !== null ? Buffer.from(document.getText(), "utf8") : await readFile(path);
    if (querySnapshot(bytes.toString("utf8")) !== location.snapshot) throw new ExplorerError("sourceChanged");
    const position = editorRange(bytes, location.range.start, location.range.end);
    if (document.getText() !== position.text) throw new ExplorerError("sourceChanged");
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    editor.selection = new vscode.Selection(document.positionAt(position.start), document.positionAt(position.end)); editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  /** Reconnect only to the replacement tree supplied by the owning Explorer, preserving the visible last model. */
  changed(tree: MetadataTree | undefined): void {
    for (const view of this.views.values()) {
      if (!tree || (view.tree === tree && !projectEnabled(view.entry.project.info))) { for (const watcher of view.watchers) watcher.dispose(); view.watchers = []; view.watchKey = ""; view.suspended = true; view.phase = "disconnected"; view.notice = this.strings().disconnected!; this.publish(view, false); }
      else { view.suspended = false; this.schedule(view); }
    }
  }
  private async restore(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    try {
      if (!isRecord(state) || state.schemaVersion !== 1 || typeof state.path !== "string" || !isAbsolute(state.path) || !["main", "preview"].includes(String(state.role))) throw new ExplorerError("sourceMissing");
      const tree = await this.ensureTree(); if (!tree) throw new ExplorerError("obsolete");
      const found = await revealFile(tree, state.path), entry = found && "owner" in found ? found.owner : found;
      if (!entry || !isForm(entry)) throw new ExplorerError("sourceMissing");
      const view = await this.view(tree, entry, state.path, typeof state.application === "string" ? state.application : undefined);
      const role = state.role as Role; if (view.frames.has(role)) { panel.dispose(); view.frames.get(role)?.panel.reveal(); return; }
      this.frame(view, role, panel); this.schedule(view, 0);
    } catch (error) { panel.dispose(); this.log(`form_restore ${error instanceof ExplorerError ? error.code : "requestFailed"}`); }
  }
  private release(view: View): void {
    if (view.closed) return;
    view.closed = true; this.views.delete(view.key); if (view.timer) clearTimeout(view.timer); for (const watcher of view.watchers) watcher.dispose();
    const closing = (async () => { await view.running; await view.client?.close(); })().catch(error => this.log(`form_close ${String(error)}`));
    this.closing.add(closing); void closing.finally(() => this.closing.delete(closing));
  }
  private async suspend(): Promise<void> {
    const views = [...this.views.values()]; this.changed(undefined);
    for (const view of views) { if (view.timer) clearTimeout(view.timer); await view.running; await view.client?.close().catch(() => {}); view.client = undefined; }
  }
  shutdown(): Promise<void> {
    if (!this.stopping) this.stopping = (async () => { this.disposed = true; for (const disposable of this.disposables) disposable.dispose(); for (const view of [...this.views.values()]) { this.release(view); for (const frame of view.frames.values()) frame.panel.dispose(); } await Promise.allSettled([...this.closing]); })();
    return this.stopping;
  }
  dispose(): void { void this.shutdown(); }
}
