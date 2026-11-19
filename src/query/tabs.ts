import { NativeQueryConstructor } from "./native-constructor.js";
import * as vscode from "vscode";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Connection } from "../connection.js";
import { ExplorerError } from "../protocol.js";
import { existingSource } from "../source.js";
import { configuredReadOnly, configuredReadOnlyResource } from "../editor-policy.js";
import { ProtectedSources } from "../protected-source.js";
import { nodeKey, type MetadataTree, type ProjectTree, type TreeEntry } from "../tree.js";
import { message, type MessageKey } from "../messages.js";
import { QueryClient, queryKey, querySnapshot, type QueryDocument } from "./client.js";
import { xmlQueryOwner, bslQueryOwner, nativeReadOnly, nativeDirty, type QueryOwnerView } from "./owner.js";
import { QueryRecovery, type QueryDraftRecord } from "./recovery.js";
import type { QueryHeader, QueryIdentity } from "./protocol.js";
import type { RecoveryEndpoint } from "./recovery-protocol.js";
import { QuerySessions, type QuerySourceSession } from "./sessions.js";
import type { CommentDecision } from "./protocol.js";
import type { SourceCommentState } from "./comments.js";
import type { QueryOwnerFacts } from "./session-protocol.js";
import type { QueryLanguageProjection } from "./projections.js";
import { QueryModalParent, unlockQueryOwner } from "./modal-parent.js";

export const QUERY_SCHEME = "eska-query";
interface Session {
  record: QueryDraftRecord;
  resumed: boolean;
  mtime: number;
  saving?: Promise<void>;
  source?: QuerySourceSession;
  endpoint?: RecoveryEndpoint;
  pending?: boolean;
  ownerMtime?: number;
  closing?: Promise<void>;
  design?: NativeQueryConstructor;
  placements?: { draft: string; owner: string; decisions: CommentDecision[] };
  parent?: QueryModalParent;
  inheritedBslReadonly?: boolean;
  nativeSave?: vscode.TextDocument;
  guarding?: Promise<void>;
}

/** Editable SDBL views own private drafts; only a freshly checked backend plan can change their owner. */
export class QueryTabs implements vscode.FileSystemProvider {
  private readonly events = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.events.event;
  private readonly languageEvents = new vscode.EventEmitter<vscode.Uri | undefined>();
  readonly onDidChangeLanguage = this.languageEvents.event;
  private readonly sessions = new Map<string, Session>();
  private readonly removals = new Set<string>();
  private readonly gates = new Map<string, Promise<unknown>>();
  private recovery: QueryRecovery | undefined;
  private recoveryEndpoint: RecoveryEndpoint | undefined;
  private recoveryAvailable = false;
  private warnedOffline = false;
  private ready: Promise<void>;
  private initial: { resolve(): void; reject(error: unknown): void } | undefined;
  private readonly directory: string;
  private readonly subscriptions: vscode.Disposable[];
  private disposed = false;

  constructor(context: vscode.ExtensionContext, private readonly connection: Connection, private readonly currentTree: () => MetadataTree | undefined,
    private readonly application: () => string | undefined, private readonly changed: (entry: TreeEntry) => void,
    private readonly log: (value: string) => void, private readonly ownedReadonlyRule: (uri: vscode.Uri) => string | undefined,
    private readonly settleReadonlyRule: (uri: vscode.Uri) => Promise<string | undefined>) {
    this.directory = join(context.globalStorageUri.fsPath, "query-drafts-v1");
    this.ready = new Promise<void>((resolve, reject) => { this.initial = { resolve, reject }; });
    void this.ready.catch(() => {});
    this.subscriptions = [vscode.workspace.registerFileSystemProvider(QUERY_SCHEME, this, { isCaseSensitive: true }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!event.contentChanges.length) return;
        const session = this.session(event.document.uri);
        if (session && !this.isOwnerSnapshot(event.document.uri) && !this.disposed) {
          if (session.design) { session.design.observe(event.document); this.languageEvents.fire(event.document.uri); return; }
          session.record = { ...session.record, draft: canonical(event.document.getText()) };
          this.persist(session);
          this.languageEvents.fire(event.document.uri);
        }
      }), vscode.workspace.onWillSaveTextDocument(({ document }) => {
        const session = this.session(document.uri);
        // VS Code starts a text-editor save only when its effective editor mode is writable.
        // Remember that approval for this provider write, including the native session override.
        if (session?.record.identity.kind === "bslLiteral" && session.record.writable && !session.design && !this.isOwnerSnapshot(document.uri)
          && (session.inheritedBslReadonly || configuredReadOnly(document))) session.nativeSave = document;
      }), vscode.workspace.onDidOpenTextDocument(document => {
        if (document.uri.scheme === QUERY_SCHEME) void this.restore(document).catch(error => this.failure(error));
      }), vscode.window.tabGroups.onDidChangeTabs(event => {
        for (const tab of event.closed) if (tab.input instanceof vscode.TabInputText) void this.closeView(tab.input.uri).catch(error => this.failure(error));
        this.guardConstructorTabs();
      }), vscode.window.onDidChangeActiveTextEditor(() => this.guardConstructorTabs()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("files.readonlyInclude") || event.affectsConfiguration("files.readonlyExclude")) {
          this.events.fire([...this.sessions.values()].map(session => ({ type: vscode.FileChangeType.Changed, uri: this.uri(session.record) })));
        }
      }), connection.onRecovery(endpoint => this.connected(endpoint)), connection.beforeStop(async () => {
        try {
          await Promise.allSettled([...this.sessions.values()].map(session => session.saving));
          await this.recovery?.settled();
          await Promise.allSettled([...this.sessions.values()].map(session => this.closeSource(session)));
        }
        catch (error) { this.failure(error); }
      })];
    if (connection.recovery) this.connected(connection.recovery);
  }

  /** XML discovery is lazy, uses the current editor buffer, and releases every transient backend document. */
  async discover(tree: MetadataTree, entry: TreeEntry): Promise<QueryHeader[]> {
    if (!tree.connection.recovery?.sessions) return [];
    return this.serial(entry.key, async () => {
      return await this.withDocument(tree, entry.project, () => xmlQueryOwner(tree, entry), document => document.list()) ?? [];
    });
  }

  /** Focus an existing session or close its previous query through the editor's native dirty-close prompt. */
  async show(tree: MetadataTree, entry: TreeEntry, identity: QueryIdentity): Promise<void> {
    await this.ready;
    await this.serial(entry.key, async () => {
      let owner = await xmlQueryOwner(tree, entry);
      if (!owner) throw new ExplorerError("sourceMissing");
      const existing = await this.existingSession(session => session.record.projectKey === entry.project.key
        && nodeKey(session.record.node) === nodeKey(entry.node.id));
      if (existing) {
        if (queryKey(existing.record.identity) === queryKey(identity)) { await this.focus(existing); return; }
        if (existing.pending || existing.source?.header.applyPending) {
          await this.focus(existing);
          throw new ExplorerError("requestFailed", "query_failed", { reason: "pending_apply" });
        }
        if (existing.record.draft !== existing.record.base) await this.focus(existing);
        const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText
          && tab.input.uri.toString() === this.uri(existing.record).toString());
        if (tabs.length && !await vscode.window.tabGroups.close(tabs)) return;
        await this.closeView(this.uri(existing.record));
        if (this.sessions.has(existing.record.id)) throw new ExplorerError("sourceChanged");
      }
      const ownerUri = owner.document.uri;
      const editor = vscode.window.visibleTextEditors.find(editor => ProtectedSources.sourceUri(editor.document.uri).toString() === ownerUri.toString());
      const parent = editor ? QueryModalParent.capture(editor) : new QueryModalParent(owner.document.uri);
      if (!await parent.hide()) return;
      let session: Session | undefined;
      try {
        const endpoint = this.recoveryEndpoint;
        const source = await this.withDocument(tree, entry.project, async () => {
          const current = await xmlQueryOwner(tree, entry);
          if (current) {
            owner = current;
            await this.settleReadonlyRule(current.document.uri);
          }
          return current;
        }, (document, current) => this.openSourceSession(tree, document, current, identity));
        if (!source) throw new ExplorerError("sourceMissing");
        if (!endpoint || this.disposed || tree !== this.currentTree() || endpoint !== this.recoveryEndpoint) {
          await source.close().catch(() => {});
          throw new ExplorerError("obsolete");
        }
        const returnView = !editor && !source.header.draftWritable ? new QueryModalParent(ProtectedSources.protectedUri(owner.document.uri)) : parent;
        session = { resumed: source.header.resumed, mtime: Date.now(), record: source.record, source, endpoint, parent: returnView };
        this.sessions.set(session.record.id, session);
        await this.focus(session);
      } catch (error) {
        if (session) { session.resumed = false; await this.closeSource(session).catch(() => {}); }
        await parent.restore(); throw error;
      }
    });
  }

  /** A query replaces its parent's native views; only the backend snapshot remains while the child is active. */
  async showBsl(editor = vscode.window.activeTextEditor): Promise<void> {
    await this.ready;
    const tree = this.currentTree();
    if (!tree || !editor || !this.recoveryEndpoint?.sessions?.capabilities.bslEditing) throw new ExplorerError("incompatible", "query_failed", { reason: "bsl_sessions_unavailable" });
    const uri = ProtectedSources.sourceUri(editor.document.uri);
    if (uri.scheme !== "file") throw new ExplorerError("sourceMissing");
    const position = editor.selection.active;
    let document = await vscode.workspace.openTextDocument(uri);
    if (editor.document.uri.scheme !== "file" && editor.document.getText() !== document.getText()) throw new ExplorerError("sourceChanged");
    let owner = await bslQueryOwner(tree, document);
    await this.serial(owner.entry.key, async () => {
      const existing = await this.existingSession(session => session.record.projectKey === owner.entry.project.key
        && nodeKey(session.record.node) === nodeKey(owner.entry.node.id)
        && isDeepStrictEqual(session.record.source, owner.source));
      const parent = QueryModalParent.capture(editor);
      if (!await parent.hide()) return;
      let session: Session | undefined;
      try {
        // Capture the native model, including unrelated unsaved edits in the module.
        if (existing) { existing.parent = parent; await this.focus(existing); return; }
        const endpoint = this.recoveryEndpoint;
        const source = await this.withDocument(tree, owner.entry.project, async () => {
          document = await vscode.workspace.openTextDocument(uri);
          owner = await bslQueryOwner(tree, document);
          await this.settleReadonlyRule(owner.document.uri);
          return owner;
        }, async (retained, current) => {
          const query = await retained.read({ at: { line: position.line, character: position.character } });
          return this.openSourceSession(tree, retained, current, query.identity);
        });
        if (!source) throw new ExplorerError("sourceMissing");
        if (!endpoint || tree !== this.currentTree() || endpoint !== this.recoveryEndpoint || this.disposed) {
          await source.close().catch(() => {}); throw new ExplorerError("obsolete");
        }
        const inheritedBslReadonly = configuredReadOnly(owner.document, this.ownedReadonlyRule(owner.document.uri));
        session = { record: source.record, source, endpoint, resumed: source.header.resumed, mtime: Date.now(), parent, inheritedBslReadonly };
        this.sessions.set(session.record.id, session);
        await this.focus(session);
      } catch (error) {
        if (session) { session.resumed = false; await this.closeSource(session).catch(() => {}); }
        await parent.restore();
        throw error;
      }
    });
  }

  /** The backend checks source policy independently before an extension-managed editor rule can be discounted. */
  private async openSourceSession(tree: MetadataTree, document: QueryDocument, owner: QueryOwnerView, identity: QueryIdentity): Promise<QuerySourceSession> {
    const ignoredRule = document.writable ? this.ownedReadonlyRule(owner.document.uri) : undefined;
    const userReadOnly = await nativeReadOnly(owner.document, ignoredRule);
    return this.client(tree, owner.entry.project).open(document, randomUUID(), identity, userReadOnly);
  }

  /** A quick reopen must wait for the previous tab to release its source and return to the owner. */
  private async existingSession(matches: (session: Session) => boolean): Promise<Session | undefined> {
    const session = [...this.sessions.values()].find(matches);
    if (session?.closing) await session.closing;
    return session && this.sessions.get(session.record.id) === session ? session : undefined;
  }

  /** A connection replacement cannot reuse an earlier owner's authority. Draft text remains available. */
  stale(): void { for (const session of this.sessions.values()) session.resumed = false; this.languageEvents.fire(undefined); }

  /** Native language providers present the backend's actual support and explicit resume state. */
  languageState(document: vscode.TextDocument): "bsl" | "basic" | "backend" | "paused" | undefined {
    const session = this.session(document.uri);
    if (!session || this.isOwnerSnapshot(document.uri)) return undefined;
    if (session.record.identity.kind !== "bslLiteral") return "basic";
    if (this.recoveryAvailable && !this.recoveryEndpoint?.sessions?.capabilities.projections) return "backend";
    return !this.disposed && this.recoveryAvailable
      && session.resumed && !session.pending && !session.saving && !!session.source && !session.source.header.constructorActive ? "bsl" : "paused";
  }

  /** Only ESKA constructs the immutable language input and checks its current native owner facts. */
  async languageProjection(document: vscode.TextDocument): Promise<{ owner: vscode.TextDocument; projection: QueryLanguageProjection }> {
    await this.ready;
    const tree = this.currentTree(), session = this.session(document.uri), version = document.version;
    if (!tree || !session || document.isClosed || this.languageState(document) !== "bsl") throw new ExplorerError("obsolete");
    const draft = canonical(document.getText());
    await this.requiredRecovery().saveDraft(session.record.id, draft);
    const owner = await this.owner(session, tree), facts = this.ownerFacts(owner.document, owner.userReadOnly);
    const source = session.source;
    if (!source || this.languageState(document) !== "bsl") throw new ExplorerError("obsolete");
    const projection = await source.projection(facts);
    if (this.disposed || tree !== this.currentTree() || session.source !== source || this.languageState(document) !== "bsl"
      || document.isClosed || document.version !== version || canonical(document.getText()) !== projection.draft
      || owner.document.isClosed || String(owner.document.version) !== facts.version || querySnapshot(owner.document.getText()) !== facts.snapshot) {
      await projection.close().catch(() => {}); throw new ExplorerError("obsolete");
    }
    return { owner: owner.document, projection };
  }

  /** Formatting is available for either query owner kind and checks native lifetime after checkpoint acknowledgement. */
  async formatting(document: vscode.TextDocument, range: { start: number; end: number } | undefined,
    formatter: string | undefined, signal: AbortSignal): Promise<unknown> {
    await this.ready;
    const session = this.session(document.uri), tree = this.currentTree(), version = document.version;
    if (!session || !tree || this.isOwnerSnapshot(document.uri) || !session.resumed || session.pending || session.design) throw new ExplorerError("obsolete");
    if (session.saving) await session.saving;
    const text = document.getText();
    await this.requiredRecovery().saveDraft(session.record.id, canonical(text));
    const source = await this.source(session, tree), endpoint = this.recoveryEndpoint;
    const result = await source.formatting(text, version, await nativeReadOnly(document), range, formatter, signal);
    if (this.disposed || session.source !== source || endpoint !== this.recoveryEndpoint || tree !== this.currentTree() || session.design
      || !session.resumed || session.pending || document.isClosed || document.version !== version || signal.aborted) throw new ExplorerError("obsolete");
    return result;
  }

  /** A visual adapter receives an owned native binding; all model and text operations remain in ESKA. */
  async beginConstructor(document: vscode.TextDocument): Promise<NativeQueryConstructor> {
    await this.ready;
    const session = this.session(document.uri), tree = this.currentTree();
    if (!session || !tree || this.isOwnerSnapshot(document.uri) || session.design) throw new ExplorerError("obsolete");
    if (session.saving) await session.saving;
    await this.requiredRecovery().saveDraft(session.record.id, canonical(document.getText()));
    const source = await this.source(session, tree);
    if (!session.resumed || !source.header.resumed) {
      const owner = await this.owner(session, tree);
      await source.resume(this.ownerFacts(owner.document, owner.userReadOnly));
      this.accept(session, source);
    }
    let design: NativeQueryConstructor;
    design = new NativeQueryConstructor(source, document, {
      current: () => !this.disposed && session.design === design && session.source === source && session.endpoint === this.recoveryEndpoint && session.resumed,
      header: () => this.accept(session, source),
      failed: () => { session.resumed = false; void this.closeSource(session).catch(() => {}); },
      complete: async native => {
        if (session.design !== design) return;
        delete session.design;
        if (session.source === source) this.accept(session, source);
        if (!native.isClosed) {
          session.record = { ...session.record, draft: canonical(native.getText()) };
          this.persist(session);
          if (!this.disposed) await this.restore(native);
        }
        this.languageEvents.fire(document.uri);
      },
    });
    session.design = design; this.languageEvents.fire(document.uri);
    try { await design.open(); return design; }
    catch (error) { await design.cancel().catch(() => {}); throw error; }
  }

  /** Explicit UI choices use ESKA source anchors and core-converted native positions, never guessed XML offsets. */
  async placeComments(document = vscode.window.activeTextEditor?.document): Promise<void> {
    await this.ready;
    const session = document && this.session(document.uri), tree = this.currentTree();
    if (!document || !session || !tree || session.design || this.isOwnerSnapshot(document.uri)) return;
    if (session.saving) await session.saving;
    const draft = canonical(document.getText()), version = document.version;
    await this.requiredRecovery().saveDraft(session.record.id, draft);
    const source = await this.source(session, tree), info = await source.comments([]);
    if (!info.comments.length) { void vscode.window.showInformationMessage(this.text("queryNoSourceComments")); return; }
    const decisions = await this.sourceCommentChoices(source, info, document);
    if (!decisions) return;
    if (document.isClosed || document.version !== version || session.source !== source || canonical(document.getText()) !== draft) throw new ExplorerError("sourceChanged");
    session.placements = { draft: querySnapshot(draft), owner: querySnapshot(session.record.ownerText), decisions };
    void vscode.window.showInformationMessage(this.text("querySourceCommentsReady"));
  }

  /** Automatic placement remains a core decision; deletion and replacement destinations require a distinct user choice. */
  private async sourceCommentChoices(source: QuerySourceSession, info: SourceCommentState, document: vscode.TextDocument): Promise<CommentDecision[] | undefined> {
    const decisions: CommentDecision[] = [];
    for (const comment of info.comments) {
      const automatic = this.text("queryCommentAutomatic"), cursor = this.text("queryCommentCursor"), position = this.text("queryCommentPosition"), discard = this.text("queryCommentDelete");
      const choice = await vscode.window.showQuickPick([automatic, cursor, position, discard], { title: comment.text.slice(0, 160), placeHolder: this.text("queryCommentChoice"), ignoreFocusOut: true });
      if (!choice) return undefined;
      if (choice === automatic) continue;
      if (choice === discard) { decisions.push({ comment: comment.comment, queryOffset: null }); continue; }
      const editor = vscode.window.visibleTextEditors.find(value => value.document === document);
      let point = editor?.selection.active ?? new vscode.Position(0, 0);
      if (choice === position) {
        const input = await vscode.window.showInputBox({ title: this.text("queryCommentPosition"), prompt: this.text("queryCommentPositionHint"), value: `${point.line + 1}:${point.character + 1}`, ignoreFocusOut: true });
        if (input === undefined) return undefined;
        const parts = /^(\d+):(\d+)$/.exec(input.trim());
        if (!parts || Number(parts[1]) < 1 || Number(parts[2]) < 1) throw new ExplorerError("requestFailed", "query_failed", { reason: "comment_position" });
        point = new vscode.Position(Number(parts[1]) - 1, Number(parts[2]) - 1);
      }
      if (!document.validatePosition(point).isEqual(point)) throw new ExplorerError("requestFailed", "query_failed", { reason: "comment_position" });
      const mapped = await source.comments([point]), offset = mapped.positions[0]?.queryOffset;
      if (offset === undefined || offset === null || mapped.snapshot !== info.snapshot) throw new ExplorerError("requestFailed", "query_failed", { reason: "comment_position" });
      decisions.push({ comment: comment.comment, queryOffset: offset });
    }
    return decisions;
  }

  /** Query-specific machine reasons stay distinct from generic metadata operation errors. */
  explain(error: unknown): void { this.failure(error); }

  /** The native editor compares against the last applied text. Uncommitted input lives in its dirty model. */
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    await this.ready;
    const session = this.required(uri);
    if (this.isCurrentOwner(uri)) return Buffer.from(await this.currentOwnerText(session));
    return Buffer.from(this.isOwnerSnapshot(uri) ? session.record.ownerText : session.design?.before ?? session.record.base);
  }

  private directoryEntries(uri: vscode.Uri): [string, vscode.FileType][] | undefined {
    if (uri.scheme !== QUERY_SCHEME || uri.authority || uri.query || uri.fragment) return undefined;
    if (uri.path === "/" || uri.path === "") return [...this.sessions.keys()].map(id => [id, vscode.FileType.Directory]);
    const session = this.sessions.get(uri.path.slice(1));
    return session ? [[this.uri(session.record).path.split("/")[2]!, vscode.FileType.File]] : undefined;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    await this.ready;
    if (this.directoryEntries(uri)) return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    const session = this.required(uri);
    const snapshot = this.isOwnerSnapshot(uri);
    const text = this.isCurrentOwner(uri) ? await this.currentOwnerText(session) : snapshot ? session.record.ownerText : session.design?.before ?? session.record.base;
    // Keep the inherited editor restriction in the text model. During an approved native save, VS Code
    // also uses stat for its filesystem check, where it would otherwise reject the session override.
    const editorReadOnly = session.source?.header.protection.userReadOnly
      || (session.parent && configuredReadOnlyResource(session.parent.source, session.record.identity.kind === "bslLiteral" ? "bsl" : "xml",
        this.sessionReadonlyRule(session, session.parent.source)));
    const writable = !snapshot && session.record.writable && (!editorReadOnly || session.nativeSave?.isClosed === false);
    return { type: vscode.FileType.File, ctime: 1, mtime: snapshot ? session.ownerMtime ?? session.mtime : session.mtime,
      size: Buffer.byteLength(text), ...(writable ? {} : { permissions: vscode.FilePermission.Readonly }) };
  }

  /** Every native save checks the current owner and applies just this query through its original document. */
  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    await this.ready;
    const session = this.required(uri);
    if (session.design || this.isOwnerSnapshot(uri)) throw vscode.FileSystemError.NoPermissions(this.text("queryReadonly"));
    const draft = canonical(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content));
    const native = session.nativeSave;
    delete session.nativeSave;
    const nativeUnlock = !!native && !native.isClosed && canonical(native.getText()) === draft;
    const saving = this.serial(uri.toString(), () => this.save(session, draft, nativeUnlock));
    session.saving = saving;
    try {
      await saving;
    } catch (error) {
      this.log(`query_save_failed ${error instanceof ExplorerError ? error.details?.reason ?? error.code : String(error)}`);
      const key = this.failureKey(error);
      if (key === "queryReadonly") throw vscode.FileSystemError.NoPermissions(this.text(key));
      throw vscode.FileSystemError.Unavailable(this.text(key));
    } finally {
      if (session.saving === saving) delete session.saving;
      this.languageEvents.fire(uri);
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    await this.ready;
    const entries = this.directoryEntries(uri);
    if (!entries) throw vscode.FileSystemError.FileNotFound(uri);
    return entries;
  }
  /** In-memory watches share the same text document across split editors. */
  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  /** Native folders are never created by the virtual provider. */
  createDirectory(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }
  /** Closing a tab owns recovery removal; direct filesystem deletion is refused. */
  delete(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }
  /** A URI change would break the checked owner binding. */
  rename(uri: vscode.Uri): void { throw vscode.FileSystemError.NoPermissions(uri); }

  /** Finish source saves and private storage before the metadata connection is stopped. */
  async shutdown(): Promise<void> {
    this.disposed = true;
    this.initial?.reject(new ExplorerError("obsolete"));
    this.initial = undefined;
    try {
      if (!this.recovery) return;
      await this.ready;
      await Promise.allSettled([...this.sessions.values()].map(session => session.saving));
      await this.recovery.settled();
      await Promise.allSettled([...this.sessions.values()].map(session => this.closeSource(session)));
      if (this.recoveryAvailable) await this.recovery.close();
    } finally {
      for (const subscription of this.subscriptions) subscription.dispose();
      this.events.dispose();
      this.languageEvents.dispose();
    }
  }

  /** Recover private records without resolving or applying their owners. */
  private async load(recovery: QueryRecovery): Promise<void> {
    await recovery.records();
    if (this.recovery !== recovery || !this.recoveryAvailable || this.disposed) throw new ExplorerError("obsolete");
    for (const id of this.removals) {
      if (this.requiredRecovery() !== recovery) throw new ExplorerError("obsolete");
      try { await recovery.remove(id); this.removals.delete(id); }
      catch (error) { this.failure(error); }
    }
    for (const record of await recovery.records()) {
      if (this.requiredRecovery() !== recovery) throw new ExplorerError("obsolete");
      if (this.removals.has(record.id)) continue;
      const session = this.sessions.get(record.id);
      if (!session) this.sessions.set(record.id, { record, resumed: false, mtime: Date.now(), pending: recovery.hasPrepared(record.id) });
      else if (!isDeepStrictEqual(session.record, record)) {
        try {
          await recovery.saveDraft(record.id, session.record.draft);
          session.record = recovery.record(record.id);
          session.pending = recovery.hasPrepared(record.id);
        }
        catch (error) { this.failure(error); }
      }
    }
  }

  /** An initialized endpoint is enough for recovery; a valid metadata tree is needed only for applying. */
  private connected(endpoint: RecoveryEndpoint | undefined): void {
    if (this.disposed) return;
    this.recoveryAvailable = endpoint !== undefined;
    if (!endpoint) {
      this.stale();
      if (["error", "ready", "disconnected", "stopping"].includes(this.connection.state.kind)) {
        this.initial?.reject(new ExplorerError("incompatible"));
        this.initial = undefined;
      }
      return;
    }
    if (endpoint === this.recoveryEndpoint) return;
    this.warnedOffline = false;
    this.recoveryEndpoint = endpoint;
    const recovery = new QueryRecovery(endpoint, this.directory, () => {
      void vscode.window.showWarningMessage(this.text("queryRecoveryDamaged"));
    }, this.recovery?.revisions());
    this.recovery = recovery;
    this.ready = this.load(recovery);
    const initial = this.initial;
    this.initial = undefined;
    void this.ready.then(() => initial?.resolve(), error => {
      initial?.reject(error);
      if (this.recovery === recovery && this.recoveryAvailable) this.failure(error);
    });
  }

  /** Disconnected input remains in its native model and is reconciled against disk revisions on reconnect. */
  private persist(session: Session): void {
    if (this.recoveryAvailable) void this.recovery?.saveDraft(session.record.id, session.record.draft).catch(error => this.failure(error));
    else if (!this.warnedOffline && !this.disposed) {
      this.warnedOffline = true;
      void vscode.window.showWarningMessage(this.text("queryRecoveryOffline"));
    }
  }

  /** Source editing cannot fall back to an adapter-owned file store or an earlier backend process. */
  private requiredRecovery(): QueryRecovery {
    if (!this.recoveryAvailable || !this.recovery || this.connection.recovery !== this.recoveryEndpoint) throw new ExplorerError("incompatible");
    return this.recovery;
  }

  /** VS Code has already handled Save, Don't Save or Cancel before the last tab disappears. */
  private async closeView(uri: vscode.Uri): Promise<void> {
    const session = this.session(uri);
    if (!session || this.disposed || session.design || this.isOwnerSnapshot(uri)) return;
    if (vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()))) return;
    if (session.closing) return session.closing;
    session.closing = this.releaseView(session);
    try { await session.closing; } finally { delete session.closing; }
  }

  private async releaseView(session: Session): Promise<void> {
    const id = session.record.id;
    let discard = false;
    try {
      await session.saving?.catch(() => {});
      const unfinished = session.pending || session.source?.header.applyPending;
      await this.closeSource(session);
      // A lost receipt can be reconciled on the next checked save. A normal discard needs no extra dialog.
      if (!unfinished) {
        discard = true;
        this.removals.add(id);
        if (this.recoveryAvailable) {
          await this.requiredRecovery().remove(id);
          this.removals.delete(id);
        }
      }
    } finally {
      session.resumed = false;
      this.languageEvents.fire(this.uri(session.record));
      try { await this.returnParent(session); }
      finally {
        if (discard) {
          this.sessions.delete(id);
          this.events.fire([{ type: vscode.FileChangeType.Deleted, uri: this.uri(session.record) }]);
        }
      }
    }
  }

  /** Hot-exit text wins over an older private record; otherwise restore through a real dirty editor edit. */
  private async restore(document: vscode.TextDocument): Promise<void> {
    await this.serial(document.uri.toString(), () => this.restoreOnce(document));
  }

  /** Open and focus callbacks must not submit the same restoration edit concurrently. */
  private async restoreOnce(document: vscode.TextDocument): Promise<void> {
    await this.ready;
    const session = this.session(document.uri);
    if (this.disposed || !session || session.design || this.isOwnerSnapshot(document.uri) || document.isClosed) return;
    const text = canonical(document.getText());
    if (nativeDirty(document) && text !== session.record.base && text !== session.record.draft) {
      session.record = { ...session.record, draft: text };
      this.persist(session);
      return;
    }
    if ((text !== session.record.base && text !== session.record.draft) || session.record.draft === session.record.base
      || (text === session.record.draft && nativeDirty(document))) return;
    const editor = vscode.window.visibleTextEditors.find(editor => editor.document === document);
    if (text === session.record.draft && editor) {
      const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
      if (!await editor.edit(edit => edit.replace(range, session.record.draft))) throw new ExplorerError("sourceChanged");
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), session.record.draft);
    if (!await vscode.workspace.applyEdit(edit)) throw new ExplorerError("sourceChanged");
  }

  /** Native CAS, Undo/Redo and optional disk save implement a plan whose lifecycle is owned by ESKA. */
  private async save(session: Session, draft: string, nativeUnlock: boolean): Promise<void> {
    const tree = this.currentTree();
    if (!tree || this.disposed) throw new ExplorerError("obsolete");
    const selection = this.application();
    await tree.synchronizeInputs();
    if (tree !== this.currentTree() || this.disposed) throw new ExplorerError("obsolete");
    const source = await this.source(session, tree);
    const owner = await this.owner(session, tree);
    const ignoredRule = this.sessionReadonlyRule(session, owner.document.uri);
    const unlockOwner = nativeUnlock && owner.userReadOnly
      && configuredReadOnly(owner.document, ignoredRule ?? this.ownedReadonlyRule(owner.document.uri));
    let attempted = false;
    try {
      if (!session.record.writable || (unlockOwner ? await nativeReadOnly(owner.document, ignoredRule, true) : owner.userReadOnly)) {
        throw new ExplorerError("requestFailed", "query_failed", { reason: "user_read_only" });
      }
      const facts = this.ownerFacts(owner.document, false);
      if (session.record.draft !== draft) throw new ExplorerError("requestFailed", "query_failed", { reason: "stale_draft" });
      await this.requiredRecovery().saveDraft(session.record.id, draft);
      if (!session.resumed || !source.header.resumed || source.header.applyPending || source.header.protection.userReadOnly) {
        await source.resume(facts);
        this.accept(session, source);
      }
      const decisions = session.placements?.draft === querySnapshot(draft) && session.placements.owner === facts.snapshot ? session.placements.decisions : [];
      const state = this.connection.state;
      const lineEnding = state.kind === "ready" && state.queryEditing?.editorLineEndings
        ? owner.document.eol === vscode.EndOfLine.CRLF ? "crlf" : "lf" : undefined;
      const plan = await source.prepare(facts, draft, decisions, lineEnding, true);
      session.pending = true;
      if (this.disposed || tree !== this.currentTree() || !session.resumed || selection !== this.application()) throw new ExplorerError("obsolete");
      const currentRule = this.sessionReadonlyRule(session, owner.document.uri);
      if (await nativeReadOnly(owner.document, currentRule, unlockOwner)) throw new ExplorerError("requestFailed", "query_failed", { reason: "user_read_only" });
      this.assertOwner(owner.document, facts, currentRule, unlockOwner);
      if (unlockOwner) {
        await unlockQueryOwner(owner.document);
        if (this.disposed || tree !== this.currentTree() || !session.resumed || selection !== this.application()) throw new ExplorerError("obsolete");
        this.assertOwner(owner.document, facts, currentRule, true);
      }
      if (!plan.noOp) {
        const edit = new vscode.WorkspaceEdit();
        for (const replacement of plan.replacements) edit.replace(owner.document.uri,
          new vscode.Range(replacement.rangeUtf16.start.line, replacement.rangeUtf16.start.character,
            replacement.rangeUtf16.end.line, replacement.rangeUtf16.end.character), replacement.text);
        attempted = true;
        if (!await vscode.workspace.applyEdit(edit)) throw new ExplorerError("sourceChanged");
        if (querySnapshot(owner.document.getText()) !== plan.outputSnapshot) throw new ExplorerError("sourceChanged");
        if (plan.saveOwner && !await owner.document.save()) throw new ExplorerError("sourceChanged");
      }
      if (querySnapshot(owner.document.getText()) !== plan.outputSnapshot) throw new ExplorerError("sourceChanged");
      const receipt = this.ownerFacts(owner.document, await nativeReadOnly(owner.document, currentRule, unlockOwner));
      if (plan.saveOwner) receipt.isDirty = owner.document.isDirty;
      await source.applied(plan.applyToken, receipt);
      this.accept(session, source, true);
      const entry = owner.project.nodes.get(nodeKey(session.record.node));
      if (entry) this.changed(entry);
    } catch (error) {
      session.resumed = false;
      session.pending = source.header.applyPending;
      const token = source.header.record.prepared?.applyToken;
      if (!attempted && token) {
        try { await source.abort(token); this.accept(session, source); }
        catch { /* An unacknowledged cleanup keeps its durable intent for explicit recovery. */ }
      }
      await this.closeSource(session).catch(() => {});
      throw error;
    }
  }

  /** Only a checked backend source handle can provide the binding used for native application. */
  private async source(session: Session, tree: MetadataTree): Promise<QuerySourceSession> {
    if (session.source && session.endpoint === this.recoveryEndpoint) return session.source;
    const project = tree.projects.find(project => project.key === session.record.projectKey);
    if (!project) throw new ExplorerError("sourceChanged");
    const endpoint = this.recoveryEndpoint;
    const source = await this.client(tree, project).restore(session.record.id);
    if (!endpoint || this.disposed || tree !== this.currentTree() || endpoint !== this.recoveryEndpoint) {
      await source.close().catch(() => {});
      throw new ExplorerError("obsolete");
    }
    session.source = source;
    session.endpoint = endpoint;
    this.accept(session, source);
    return source;
  }

  /** ESKA has already resolved the source/member; the adapter opens only its native document view. */
  private async owner(session: Session, tree: MetadataTree): Promise<{ project: ProjectTree; document: vscode.TextDocument; userReadOnly: boolean }> {
    const project = tree.projects.find(project => project.key === session.record.projectKey);
    if (!project) throw new ExplorerError("sourceChanged");
    const path = await existingSource(project.info.sourcePath, session.record.source);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    return { project, document, userReadOnly: await nativeReadOnly(document, this.sessionReadonlyRule(session, document.uri)) };
  }

  /** The query may use its own source lease. All other editor rules still apply. */
  private sessionReadonlyRule(session: Session, uri: vscode.Uri): string | undefined {
    const protection = session.source?.header.protection;
    if (!this.recoveryAvailable || session.endpoint !== this.recoveryEndpoint || !protection?.sourceRestriction
      || protection.userReadOnly || !protection.capturedSourceWritable) return undefined;
    return this.ownedReadonlyRule(uri);
  }

  /** These are exact native facts; disk, descriptor, source policy and context are checked by the core. */
  private ownerFacts(document: vscode.TextDocument, userReadOnly: boolean): QueryOwnerFacts {
    if (document.isClosed) throw new ExplorerError("sourceChanged");
    return { version: String(document.version), snapshot: querySnapshot(document.getText()), isDirty: nativeDirty(document),
      userReadOnly, application: this.application() ?? null };
  }

  /** A text plan can touch only the native version that supplied its preflight facts. */
  private assertOwner(document: vscode.TextDocument, facts: QueryOwnerFacts, ignoredRule?: string, allowConfiguredWrite = false): void {
    if ((!allowConfiguredWrite && configuredReadOnly(document, ignoredRule)) || document.isClosed
      || String(document.version) !== facts.version || querySnapshot(document.getText()) !== facts.snapshot) {
      throw new ExplorerError("sourceChanged");
    }
  }

  /** Cached presentation follows acknowledged backend state and the queue's rebased native draft. */
  private accept(session: Session, source: QuerySourceSession, saved = false): void {
    if (session.endpoint !== this.recoveryEndpoint || session.source !== source) throw new ExplorerError("obsolete");
    const oldOwner = session.record.ownerText;
    session.record = source.record;
    session.resumed = source.header.resumed;
    session.pending = source.header.applyPending;
    this.languageEvents.fire(this.uri(session.record));
    if (saved) session.mtime = Math.max(session.mtime + 1, Date.now());
    if (oldOwner !== session.record.ownerText) {
      session.ownerMtime = (session.ownerMtime ?? session.mtime) + 1;
      this.events.fire([{ type: vscode.FileChangeType.Changed, uri: this.ownerUri(session.record) }]);
    }
  }

  /** A client is bound to the initialized process and one metadata member, not a VS Code URI. */
  private client(tree: MetadataTree, project: ProjectTree): QuerySessions {
    const state = tree.connection.state;
    const recovery = this.requiredRecovery();
    if (tree !== this.currentTree() || state.kind !== "ready" || !state.queryEditing || !this.recoveryEndpoint) throw new ExplorerError("incompatible");
    return new QuerySessions(this.recoveryEndpoint, recovery, () => ({ sessionId: tree.session.sessionId,
      projectId: project.info.projectId, generation: project.info.generation }), state.queryEditing);
  }

  /** Native views may close independently; releasing a handle never deletes its retained checkpoint. */
  private async closeSource(session: Session): Promise<void> {
    const source = session.source;
    session.design?.invalidate();
    delete session.source;
    delete session.endpoint;
    this.languageEvents.fire(this.uri(session.record));
    await source?.close();
  }

  /** No document handle survives discovery, save, cancellation or a thrown callback. */
  private async withDocument<T>(tree: MetadataTree, project: ProjectTree,
    locate: () => Promise<QueryOwnerView | undefined>, action: (document: QueryDocument, owner: QueryOwnerView) => Promise<T>): Promise<T | undefined> {
    let owner: QueryOwnerView | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await tree.synchronizeInputs();
      const generation = project.info.generation, sequence = project.info.eventSequence;
      try { owner = await locate(); }
      catch (error) {
        if (tree === this.currentTree() && (generation !== project.info.generation || sequence !== project.info.eventSequence)
          && error instanceof ExplorerError && (error.code === "sourceChanged" || error.domain === "unknown_node" || error.domain === "stale_generation")) {
          if (attempt === 2) throw new ExplorerError("sourceChanged");
          continue;
        }
        throw error;
      }
      await tree.synchronizeInputs();
      if (this.disposed || tree !== this.currentTree()) throw new ExplorerError("obsolete");
      if (generation === project.info.generation && sequence === project.info.eventSequence) break;
      owner = undefined;
      if (attempt === 2) throw new ExplorerError("sourceChanged");
    }
    if (!owner) return undefined;
    const state = tree.connection.state;
    if (tree !== this.currentTree() || state.kind !== "ready" || !state.queryEditing) throw new ExplorerError("incompatible");
    this.requiredRecovery();
    const client = new QueryClient(tree.connection, tree.session.sessionId, owner.entry.project, state.queryEditing);
    const application = this.application();
    const document = await client.open({ node: owner.entry.node.id, source: owner.source,
      version: String(owner.document.version), text: owner.document.getText(), ...(application ? { application } : {}) });
    try {
      if (this.disposed || tree !== this.currentTree() || !this.recoveryAvailable) throw new ExplorerError("obsolete");
      return await action(document, owner);
    }
    finally { await document.close(); }
  }

  /** Serialize discovery/open for the same owner instead of allocating duplicate backend snapshots. */
  private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.gates.get(key);
    const pending = (previous ?? Promise.resolve()).catch(() => {}).then(action);
    this.gates.set(key, pending);
    try { return await pending; }
    finally { if (this.gates.get(key) === pending) this.gates.delete(key); }
  }

  /** A stable private URI gives native SDBL highlighting, shared splits and built-in Undo/Redo. */
  private async focus(session: Session): Promise<void> {
    if (session.design?.parentLocked) { session.design.reveal(); return; }
    if (!session.parent?.active) {
      const tree = this.currentTree();
      // Recovery remains readable when the manifest is invalid and no native parent can be resolved yet.
      if (tree) {
        const owner = await this.owner(session, tree);
        session.parent = new QueryModalParent(session.record.writable ? owner.document.uri : ProtectedSources.protectedUri(owner.document.uri));
        if (!await session.parent.hide()) { session.parent.active = false; return; }
      }
    }
    const document = await vscode.workspace.openTextDocument(this.uri(session.record));
    await this.restore(document);
    await vscode.window.showTextDocument(document, { preview: false });
    if (canonical(document.getText()) !== session.record.base && canonical(document.getText()) !== session.record.draft) {
      throw new ExplorerError("sourceChanged");
    }
  }

  /** The visual constructor owns all splits of its query until it returns control to the text editor. */
  private guardConstructorTabs(): void {
    for (const session of this.sessions.values()) {
      if (this.disposed || session.closing || session.guarding || !session.design?.parentLocked) continue;
      const query = this.uri(session.record).toString();
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === query && !tab.isDirty);
      if (!tabs.length) continue;
      session.design.reveal();
      const closing = Promise.resolve(vscode.window.tabGroups.close(tabs, true)).then(() => {});
      session.guarding = closing;
      void closing.catch(error => this.failure(error)).finally(() => {
        if (session.guarding === closing) delete session.guarding;
      });
    }
  }

  /** Closing the last query view restores the original source and its cursor. */
  private async returnParent(session: Session): Promise<void> {
    if (this.disposed) return;
    const newer = [...this.sessions.values()].find(value => value !== session && value.parent?.active
      && value.record.projectKey === session.record.projectKey && isDeepStrictEqual(value.record.source, session.record.source));
    if (newer) return;
    const tree = this.currentTree();
    let parent = session.parent;
    if (!parent) {
      if (!tree) return;
      const owner = await this.owner(session, tree);
      parent = new QueryModalParent(session.record.writable ? owner.document.uri : ProtectedSources.protectedUri(owner.document.uri));
    }
    // A save can invalidate the support snapshot. Resolve it before showing the native editor again.
    try {
      await tree?.synchronizeInputs();
      await this.settleReadonlyRule(parent.source);
    } finally { if (!this.disposed) await parent.restore(); }
  }

  /** Identities appear only in the filename label; the UUID owns the actual session. */
  private uri(record: QueryDraftRecord): vscode.Uri {
    const identity = record.identity;
    const label = identity.kind === "dataSet" ? identity.path.join(".") : identity.kind === "dynamicList" ? identity.name : "query";
    const name = [...label.replaceAll(/[\\/\?#%]/g, "_")].slice(0, 80).join("");
    return vscode.Uri.from({ scheme: QUERY_SCHEME, path: `/${record.id}/${name}.sdbl` });
  }

  /** Read-only original snapshots share the provider without acquiring native source write permissions. */
  private isOwnerSnapshot(uri: vscode.Uri): boolean { return ["owner.xml", "owner.bsl", "current-owner.xml", "current-owner.bsl"].includes(uri.path.split("/")[2] ?? ""); }

  /** Current native text is a read-only fact for comparison, distinct from ESKA's retained original snapshot. */
  private isCurrentOwner(uri: vscode.Uri): boolean { return ["current-owner.xml", "current-owner.bsl"].includes(uri.path.split("/")[2] ?? ""); }

  /** A comparison mirror can never delegate a writable file URI to the native diff editor. */
  private currentOwnerUri(record: QueryDraftRecord): vscode.Uri {
    return this.uri(record).with({ path: `/${record.id}/current-owner.${record.identity.kind === "bslLiteral" ? "bsl" : "xml"}` });
  }

  /** The adapter supplies current native facts; the backend snapshot and all source-write decisions remain in ESKA. */
  private async currentOwnerText(session: Session): Promise<string> {
    const tree = this.currentTree();
    if (!tree) throw vscode.FileSystemError.Unavailable(this.text("sourceMissing"));
    return (await this.owner(session, tree)).document.getText();
  }

  /** The snapshot keeps the owner language while its UUID remains the only session identity. */
  private ownerUri(record: QueryDraftRecord): vscode.Uri {
    return this.uri(record).with({ path: `/${record.id}/owner.${record.identity.kind === "bslLiteral" ? "bsl" : "xml"}` });
  }

  /** Only exact session filenames and original snapshots are readable; arbitrary URI paths are refused. */
  private session(uri: vscode.Uri): Session | undefined {
    if (uri.scheme !== QUERY_SCHEME) return undefined;
    const id = uri.path.split("/")[1];
    const session = id ? this.sessions.get(id) : undefined;
    return session && (this.uri(session.record).toString() === uri.toString()
      || this.ownerUri(session.record).toString() === uri.toString() || this.currentOwnerUri(session.record).toString() === uri.toString()) ? session : undefined;
  }

  /** Missing private records cannot fall back to any file on disk. */
  private required(uri: vscode.Uri): Session {
    const session = this.session(uri);
    if (!session) throw vscode.FileSystemError.FileNotFound(uri);
    return session;
  }

  /** Technical reasons stay in diagnostics; presentation always has both supported locales. */
  private failureKey(error: unknown): MessageKey {
    const reason = error instanceof ExplorerError ? error.details?.reason : undefined;
    return reason === "bsl_sessions_unavailable" ? "queryBslUnavailable"
      : reason === "constructor_unavailable" ? "constructorUnavailable"
      : error instanceof ExplorerError && error.code === "incompatible" ? "queryUnavailable"
      : ["unsupported_expression", "invalid_literal", "not_found"].includes(String(reason)) ? "queryUnsupported"
      : reason === "comment_position" ? "queryCommentInvalid"
      : error instanceof ExplorerError && (error.code === "sourceChanged" || ["conflict", "context_changed", "source_changed", "owner_changed", "disk_changed", "stale_version", "stale_owner", "stale_revision"].includes(String(reason))) ? "queryOwnerChanged"
      : ["read_only", "user_read_only"].includes(String(reason)) ? "queryReadonly" : reason === "comments_require_decision" ? "queryComments" : "querySaveFailed";
  }

  private failure(error: unknown): void {
    this.log(`query_error code=${error instanceof ExplorerError ? error.code : "io"} reason=${error instanceof ExplorerError ? error.details?.reason ?? "none" : "none"}`);
    if (!this.disposed) void vscode.window.showWarningMessage(this.text(this.failureKey(error)));
  }

  /** Localize only UI, never persisted identities or protocol fields. */
  private text(key: MessageKey): string { return message(vscode.env.language, key); }
}

/** SDBL editor line endings are logical LF; source physical lines are chosen separately in query/plan. */
function canonical(text: string): string { return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"); }
