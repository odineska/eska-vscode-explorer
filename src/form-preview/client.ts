import type { Connection } from "../connection.js";
import { ExplorerError, isRecord, projectEnabled } from "../protocol.js";
import type { MetadataTree, TreeEntry } from "../tree.js";
import { withQueryText } from "../query/text-transfer.js";
import { parseFormSnapshot, parseFormPreparation, parsePropertyPalette, parseLocation, parseHandlerSource, MAX_FORM_DEPENDENCIES, type FormHandlerSource, type FormInput, type FormPreparation, type FormLimits, type FormNode, type FormPalette, type FormSnapshot, type FormTarget, type Location } from "./protocol.js";

function checkContext(connection: Connection, tree: MetadataTree, entry: TreeEntry, value: unknown, generation: string): void {
  const state = connection.state;
  if (state.kind !== "ready" || state.session.sessionId !== tree.session.sessionId || !projectEnabled(entry.project.info)
    || generation !== entry.project.info.generation) throw new ExplorerError("obsolete");
  if (!isRecord(value) || value.sessionId !== tree.session.sessionId || value.projectId !== entry.project.info.projectId || value.generation !== generation) throw new ExplorerError("protocolInvalid");
}

async function withInputs<T>(values: FormInput[], limits: FormLimits, request: (method: string, params: Record<string, unknown>) => Promise<unknown>, use: (inputs: Record<string, unknown>[]) => Promise<T>): Promise<T> {
  if (values.length > MAX_FORM_DEPENDENCIES || values.reduce((bytes, input) => bytes + Buffer.byteLength(input.text, "utf8"), 0) > 32 * 1024 * 1024) throw new ExplorerError("resourceLimit");
  const maxInlineInputBytes = Math.min(limits.maxInlineBytes, Math.floor(524288 / Math.max(1, values.length)));
  const inputs: Record<string, unknown>[] = [];
  const submit = async (index: number): Promise<T> => {
    const value = values[index];
    if (!value) return use(inputs);
    return withQueryText(value.text, { maxSnapshotBytes: limits.maxOverlayBytes, maxInlineBytes: limits.maxInlineBytes, maxInlineInputBytes }, request,
      async id => { await request("query/bufferClose", { bufferId: id }); },
      input => {
        inputs.push({ root: value.root, path: value.path, version: value.version, ...input });
        return submit(index + 1);
      });
  };
  return submit(0);
}
/** One logical session can feed several panels. No allocation/update is automatically replayed. */
export class FormSession {
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(private readonly connection: Connection, readonly tree: MetadataTree, readonly entry: TreeEntry,
    readonly limits: FormLimits, public current: FormSnapshot) {}

  static async prepare(connection: Connection, tree: MetadataTree, entry: TreeEntry, application?: string): Promise<FormPreparation> {
    await tree.synchronizeInputs();
    const generation = entry.project.info.generation;
    const value = await connection.request(tree.session.sessionId, "form/prepare", { projectId: entry.project.info.projectId, generation, node: entry.node.id, ...(application ? { application } : {}) });
    checkContext(connection, tree, entry, value, generation); return parseFormPreparation(value);
  }
  static async open(connection: Connection, tree: MetadataTree, entry: TreeEntry, limits: FormLimits, inputs: FormInput[], application?: string, expandedData: string[][] = []): Promise<FormSession> {
    await tree.synchronizeInputs();
    const generation = entry.project.info.generation;
    const request = (method: string, params: Record<string, unknown>) => connection.request(tree.session.sessionId, method, { ...params, projectId: entry.project.info.projectId, generation });
    let opened: unknown;
    try {
      await withInputs(inputs, limits, request, async inputs => {
        // Record the allocated ID before the uploaded input buffers are released.
        opened = await request("form/open", { node: entry.node.id, inputs,
          ...(application ? { application } : {}), ...(limits.referenceData ? { expandedData } : {}) });
      });
      checkContext(connection, tree, entry, opened, generation);
      return new FormSession(connection, tree, entry, limits, parseFormSnapshot(opened));
    } catch (error) {
      if (isRecord(opened) && typeof opened.formSessionId === "string" && opened.formSessionId) {
        // Close is scoped to this workspace and accepts an obsolete generation.
        await request("form/close", { formSessionId: opened.formSessionId }).catch(() => {});
      }
      throw error;
    }
  }
  private check(value: unknown, generation: string): void {
    if (this.closed) throw new ExplorerError("obsolete");
    checkContext(this.connection, this.tree, this.entry, value, generation);
  }
  private request(method: string, params: Record<string, unknown>, generation = this.entry.project.info.generation): Promise<unknown> {
    return this.connection.request(this.tree.session.sessionId, method, { ...params, projectId: this.entry.project.info.projectId, generation });
  }
  /** Uploads and update acknowledgement complete before close; stale results are never installed into another session. */
  update(inputs: FormInput[], expandedData: string[][] = []): Promise<FormSnapshot> {
    const action = this.pending.then(async () => {
      if (this.closed) throw new ExplorerError("obsolete");
      await this.tree.synchronizeInputs();
      const generation = this.entry.project.info.generation;
      return withInputs(inputs, this.limits, (method, params) => this.request(method, params, generation), async inputs => {
        const value = await this.request("form/update", { formSessionId: this.current.formSessionId, revision: this.current.revision, overlays: [], inputs, ...(this.limits.referenceData ? { expandedData } : {}) }, generation);
        const result = parseFormSnapshot(value);
        // Retain the acknowledged revision even if a later file event made this response visually obsolete.
        this.current = result; this.check(value, generation); return result;
      });
    });
    this.pending = action.catch(() => {}); return action;
  }
  async inspect(snapshot: FormSnapshot, node: FormNode): Promise<FormPalette> {
    await this.pending;
    if (this.closed || this.current !== snapshot) throw new ExplorerError("obsolete");
    if (!this.limits.propertyPalette) throw new ExplorerError("incompatible");
    const generation = this.entry.project.info.generation;
    const value = await this.request("form/inspect", { formSessionId: snapshot.formSessionId, revision: snapshot.revision, identity: node.identity, includeEventRows: true }, generation);
    this.check(value, generation);
    if (this.current !== snapshot) throw new ExplorerError("obsolete");
    return parsePropertyPalette(value, snapshot, node);
  }
  async locate(snapshot: FormSnapshot, target: FormTarget): Promise<Location> {
    await this.pending;
    if (this.closed || this.current !== snapshot) throw new ExplorerError("obsolete");
    const generation = this.entry.project.info.generation;
    const value = await this.request("form/locate", { formSessionId: snapshot.formSessionId, revision: snapshot.revision, target }, generation);
    this.check(value, generation);
    if (this.current !== snapshot) throw new ExplorerError("obsolete");
    return parseLocation(value);
  }
  async handlerSource(index: number, revision = this.current.revision): Promise<FormHandlerSource> {
    await this.pending;
    if (this.closed) throw new ExplorerError("obsolete");
    if (!this.limits.handlerNavigation) throw new ExplorerError("incompatible");
    if (this.current.revision !== revision) throw new ExplorerError("sourceChanged");
    const generation = this.entry.project.info.generation;
    const value = await this.request("form/handlerSource", { formSessionId: this.current.formSessionId, revision: this.current.revision, index }, generation);
    this.check(value, generation); return parseHandlerSource(value);
  }
  locateHandler(index: number, source: FormHandlerSource, text: string, version: string): Promise<Location> {
    const action = this.pending.then(async () => {
      if (this.closed) throw new ExplorerError("obsolete");
      if (!this.limits.handlerNavigation || this.current.revision !== source.revision) throw new ExplorerError("sourceChanged");
      const generation = this.entry.project.info.generation;
      return withQueryText(text, { maxSnapshotBytes: this.limits.maxOverlayBytes, maxInlineBytes: this.limits.maxInlineBytes },
        (method, params) => this.request(method, params, generation), async id => { await this.request("query/bufferClose", { bufferId: id }); }, async input => {
          const value = await this.request("form/handlerLocate", { formSessionId: this.current.formSessionId, revision: source.revision, index,
            input: { source: source.source, version, ...input } }, generation);
          this.check(value, generation); return parseLocation(value);
        });
    });
    this.pending = action.catch(() => {}); return action;
  }
  async close(): Promise<void> {
    await this.pending;
    if (this.closed) return; this.closed = true;
    await this.request("form/close", { formSessionId: this.current.formSessionId });
  }
}
