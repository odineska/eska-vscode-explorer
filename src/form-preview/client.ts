import type { Connection } from "../connection.js";
import { ExplorerError, isRecord, projectEnabled } from "../protocol.js";
import type { MetadataTree, TreeEntry } from "../tree.js";
import { withQueryText } from "../query/text-transfer.js";
import { parseFormSnapshot, parseLocation, type FormLimits, type FormSnapshot, type FormTarget, type Location } from "./protocol.js";

export interface Overlay { source: string; version: string; text: string }
/** One logical session can feed several panels. No allocation/update is automatically replayed. */
export class FormSession {
  private closed = false;
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(private readonly connection: Connection, readonly tree: MetadataTree, readonly entry: TreeEntry,
    readonly limits: FormLimits, public current: FormSnapshot) {}

  static async open(connection: Connection, tree: MetadataTree, entry: TreeEntry, limits: FormLimits, application?: string): Promise<FormSession> {
    await tree.synchronizeInputs();
    const generation = entry.project.info.generation;
    const value = await connection.request(tree.session.sessionId, "form/open", { projectId: entry.project.info.projectId, generation, node: entry.node.id, ...(application ? { application } : {}) });
    const snapshot = parseFormSnapshot(value), session = new FormSession(connection, tree, entry, limits, snapshot);
    try { session.check(value, generation); return session; } catch (error) { await session.close(); throw error; }
  }
  private check(value: unknown, generation: string): void {
    const state = this.connection.state;
    if (this.closed || state.kind !== "ready" || state.session.sessionId !== this.tree.session.sessionId || !projectEnabled(this.entry.project.info)
      || generation !== this.entry.project.info.generation) throw new ExplorerError("obsolete");
    if (!isRecord(value) || value.sessionId !== this.tree.session.sessionId || value.projectId !== this.entry.project.info.projectId
      || value.generation !== generation) throw new ExplorerError("protocolInvalid");
  }
  private request(method: string, params: Record<string, unknown>, generation = this.entry.project.info.generation): Promise<unknown> {
    return this.connection.request(this.tree.session.sessionId, method, { ...params, projectId: this.entry.project.info.projectId, generation });
  }
  /** Uploads and update acknowledgement complete before close; stale results are never installed into another session. */
  update(overlays: Overlay[]): Promise<FormSnapshot> {
    const action = this.pending.then(async () => {
      if (this.closed) throw new ExplorerError("obsolete");
      await this.tree.synchronizeInputs();
      const generation = this.entry.project.info.generation;
      const submit = async (index: number, inputs: Record<string, unknown>[]): Promise<FormSnapshot> => {
        const overlay = overlays[index];
        if (!overlay) {
          const value = await this.request("form/update", { formSessionId: this.current.formSessionId, revision: this.current.revision, overlays: inputs }, generation);
          const result = parseFormSnapshot(value);
          // Retain the acknowledged revision even if a later file event made this response visually obsolete.
          this.current = result; this.check(value, generation); return result;
        }
        if (!this.current.dependencies.some(dependency => dependency.id === overlay.source)) throw new ExplorerError("sourceChanged");
        return withQueryText(overlay.text, { maxSnapshotBytes: this.limits.maxOverlayBytes, maxInlineBytes: this.limits.maxInlineBytes },
          (method, params) => this.request(method, params, generation), async id => { await this.request("query/bufferClose", { bufferId: id }, generation); },
          input => submit(index + 1, [...inputs, { source: overlay.source, version: overlay.version, ...input }]));
      };
      return submit(0, []);
    });
    this.pending = action.catch(() => {}); return action;
  }
  async locate(target: FormTarget): Promise<Location> {
    await this.pending;
    const generation = this.entry.project.info.generation;
    const value = await this.request("form/locate", { formSessionId: this.current.formSessionId, revision: this.current.revision, target }, generation);
    this.check(value, generation); return parseLocation(value);
  }
  async close(): Promise<void> {
    await this.pending;
    if (this.closed) return; this.closed = true;
    await this.request("form/close", { formSessionId: this.current.formSessionId });
  }
}
