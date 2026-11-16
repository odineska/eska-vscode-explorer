import * as vscode from "vscode";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { ExplorerError, isRecord, isWirePath } from "../protocol.js";
import { configuredReadOnlyResource } from "../editor-policy.js";
import { plannedSource } from "../metadata-object-review.js";
import { existingSource } from "../source.js";
import type { MetadataTree, TreeEntry } from "../tree.js";
import type { FormSnapshot } from "./protocol.js";
import { formSourceKey } from "./source.js";

type RecordValue = Record<string, unknown>;
type AssignedTarget = { kind: "element"; id: number } | { kind: "attribute" | "command" | "parameter"; name: string };
type Context = { tree: MetadataTree; entry: TreeEntry; path: string; snapshot: FormSnapshot; origin: string };
type Request = { form: string; snapshot: string; operations: RecordValue[] };
type Patch = { before: string; after: string }[];
type Plan = { prepared: RecordValue; inputs: string[]; target?: AssignedTarget };
interface Draft {
  context: Context;
  id: number;
  form: string;
  snapshot: string;
  busy: boolean;
  committing: boolean;
  writable: boolean;
  plan?: Plan;
}

const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function diskSnapshot(context: Context): string | undefined {
  const dependency = context.snapshot.dependencies.find(item => item.id === context.origin && item.role === "form");
  return dependency?.version === null && hash(dependency.snapshot) ? dependency.snapshot : undefined;
}

const limit = 1_000_000; // Below the metadata RPC request limit, including the context envelope.
const excerptLimit = 16_000;

function target(value: unknown): AssignedTarget | undefined {
  if (!isRecord(value)) return;
  if (value.kind === "element" && typeof value.id === "number" && Number.isSafeInteger(value.id)) return { kind: value.kind, id: value.id };
  if ((value.kind === "attribute" || value.kind === "command" || value.kind === "parameter") && typeof value.name === "string")
    return { kind: value.kind, name: value.name };
}

function operations(value: unknown): RecordValue[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1024 || !value.every(isRecord)
    || value.some(item => item.kind === "remove" && item.force === true)
    || Buffer.byteLength(JSON.stringify(value)) > limit) throw new ExplorerError("protocolInvalid");
  return value;
}

function showPatch(bytes: Buffer, changes: unknown, expected: string): Patch {
  if (!Array.isArray(changes) || changes.length > 1024) throw new ExplorerError("protocolInvalid");
  const result: Patch = [], parts: Buffer[] = [];
  let previous = 0;
  const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (const change of changes) {
    if (!isRecord(change) || !isRecord(change.range) || typeof change.replacement !== "string") throw new ExplorerError("protocolInvalid");
    const { start, end } = change.range;
    if (typeof start !== "number" || !Number.isSafeInteger(start) || start < previous ||
      typeof end !== "number" || !Number.isSafeInteger(end) || end < start || end > bytes.length) throw new ExplorerError("protocolInvalid");
    const contextStart = start > 0 ? bytes.lastIndexOf(10, start - 1) + 1 : 0;
    const newline = bytes.indexOf(10, end);
    const contextEnd = newline === -1 ? bytes.length : newline;
    const before = decode.decode(bytes.subarray(contextStart, contextEnd));
    const after = decode.decode(bytes.subarray(contextStart, start)) + change.replacement + decode.decode(bytes.subarray(end, contextEnd));
    result.push({ before: shorten(before), after: shorten(after) });
    parts.push(bytes.subarray(previous, start), Buffer.from(change.replacement, "utf8"));
    previous = end;
  }
  parts.push(bytes.subarray(previous));
  if (digest(Buffer.concat(parts)) !== expected) throw new ExplorerError("protocolInvalid");
  return result;
}

function shorten(text: string): string {
  return text.length > excerptLimit ? text.slice(0, excerptLimit / 2) + "\n⋯\n" + text.slice(-excerptLimit / 2) : text;
}

/** The webview owns drafts. The host owns the checked plan and submits it once on Save. */
export class FormEditor {
  private draft: Draft | undefined;
  private serial = 0;
  private replaying = false;

  constructor(private readonly current: () => Context | undefined,
    private readonly uri: (path: string) => Promise<vscode.Uri>,
    private readonly post: (value: RecordValue) => void,
    private readonly applied: (selected?: AssignedTarget) => void) {}

  dispose(): void { this.draft = undefined; }

  async receive(value: RecordValue): Promise<void> {
    const id = value.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return;
    if (value.action === "open") {
      if (id <= this.serial || this.draft?.committing || this.replaying) return;
      this.serial = id;
      const context = this.current();
      if (!context || context.entry.node.id.kind !== "object") {
        this.reply(id, "error", { message: "editUnavailable" });
        return;
      }
      this.draft = { id, context, form: context.entry.node.id.objectId, snapshot: "", busy: false, committing: false, writable: false };
    }
    const draft = this.draft;
    if (!draft || id !== draft.id) return;
    if (value.action === "close") {
      if (!draft.committing) this.draft = undefined;
      return;
    }
    if (draft.busy) return;
    draft.busy = true;
    try {
      switch (value.action) {
        case "open": await this.open(draft, value.includeTypes === true); break;
        case "preview": await this.preview(draft, operations(value.operations)); break;
        case "back": delete draft.plan; break;
        case "save": await this.save(draft); break;
      }
    } catch (error) {
      if (this.draft === draft) {
        const committing = draft.committing;
        delete draft.plan;
        draft.committing = false;
        if (committing) draft.writable = false;
        this.reply(id, "error", { message: this.error(error, committing), fatal: committing,
          ...(error instanceof ExplorerError && error.domain === "form_references"
            ? { references: this.references(error.details) } : {}) });
        if (committing) this.applied();
      }
    } finally {
      draft.busy = false;
    }
  }

  private reply(id: number, phase: string, detail: RecordValue = {}): void {
    this.post({ type: "formEditResult", id, phase, ...detail });
  }

  private checkContext(context: Context): void {
    const current = this.current();
    if (!current || current.tree !== context.tree || current.entry.project !== context.entry.project
      || current.entry.node.id.kind !== "object" || context.entry.node.id.kind !== "object"
      || current.entry.node.id.objectId !== context.entry.node.id.objectId || current.origin !== context.origin
      || formSourceKey(current.path) !== formSourceKey(context.path)) throw new ExplorerError("sourceChanged");
  }

  private check(draft: Draft): void {
    if (this.draft !== draft) throw new ExplorerError("sourceChanged");
    this.checkContext(draft.context);
  }

  private async checkBuffers(draft: Draft, paths: string[]): Promise<void> {
    this.check(draft);
    await this.checkSourceBuffers(draft.context, paths);
    this.check(draft);
  }

  private async checkSourceBuffers(context: Context, paths: string[]): Promise<void> {
    this.checkContext(context);
    const uri = await this.uri(context.path);
    this.checkContext(context);
    if (uri.scheme !== "file" || configuredReadOnlyResource(uri, "xml")) throw new ExplorerError("requestFailed", "property_read_only");
    const inputs = new Set(paths.map(formSourceKey));
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === "file" && document.isDirty && inputs.has(formSourceKey(document.uri.fsPath)))
        throw new ExplorerError("requestFailed", "creation_dirty_source");
    }
  }

  private async open(draft: Draft, includeTypes: boolean): Promise<void> {
    const { tree, entry, path } = draft.context;
    await this.checkBuffers(draft, [path]);
    const schema = await tree.request(entry.project, "metadata/formEditSchema", { form: draft.form, ...(includeTypes ? { includeTypes } : {}) });
    this.check(draft);
    if (schema.schemaVersion !== 1 || schema.form !== draft.form || !hash(schema.snapshot) || !isWirePath(schema.path)
      || !Array.isArray(schema.nodes) || !Array.isArray(schema.elementKinds) || !Array.isArray(schema.definitionKinds)
      || !isRecord(schema.propertyCaptions) || !isRecord(schema.choiceCaptions) || typeof schema.writable !== "boolean")
      throw new ExplorerError("protocolInvalid");
    const source = await existingSource(entry.project.info.sourcePath, schema.path);
    if (relative(path, source) !== "" || diskSnapshot(draft.context) !== schema.snapshot)
      throw new ExplorerError("sourceChanged");
    this.check(draft);
    draft.snapshot = schema.snapshot;
    draft.writable = schema.writable;
    const { nodes, elementKinds, definitionKinds, propertyCaptions, choiceCaptions, conditionalAppearance, dynamicListAppearance, typeOptions, writable } = schema;
    this.reply(draft.id, "ready", { schema: { nodes, elementKinds, definitionKinds, propertyCaptions, choiceCaptions, conditionalAppearance, dynamicListAppearance, typeOptions, writable } });
  }

  private async preview(draft: Draft, operations: RecordValue[]): Promise<void> {
    delete draft.plan;
    if (!draft.writable) throw new ExplorerError("requestFailed", "property_read_only");
    const { tree, entry, path } = draft.context;
    await this.checkBuffers(draft, [path]);
    const request: Request = { form: draft.form, snapshot: draft.snapshot, operations };
    const preview = await tree.request(entry.project, "metadata/previewFormEdit", { request });
    this.check(draft);
    const prepared = preview.prepared;
    if (preview.schemaVersion !== 1 || preview.form !== draft.form || preview.valid !== true || preview.operation !== "form-edit"
      || typeof preview.changed !== "boolean" || !isWirePath(preview.source) || !isRecord(prepared)
      || !isDeepStrictEqual(request, prepared.request) || !hash(prepared.sourceSnapshot) || !hash(prepared.expectedOutputSnapshot)
      || !Array.isArray(preview.inputs) || !preview.inputs.every(isWirePath) || !Array.isArray(preview.assignedIds))
      throw new ExplorerError("protocolInvalid");
    const source = plannedSource(entry.project.info.sourcePath, preview.source);
    if (relative(path, source) !== "") throw new ExplorerError("protocolInvalid");
    const inputs = preview.inputs.map(input => plannedSource(entry.project.info.sourcePath, input));
    await this.checkBuffers(draft, [path, ...inputs]);
    const bytes = await readFile(path);
    this.check(draft);
    if (digest(bytes) !== draft.snapshot) throw new ExplorerError("sourceChanged");
    const changes = showPatch(bytes, preview.changes, prepared.expectedOutputSnapshot);
    const assigned = preview.assignedIds[0];
    const selected = isRecord(assigned) ? target(assigned.target) : undefined;
    if (preview.changed) draft.plan = { prepared, inputs, ...(selected ? { target: selected } : {}) };
    this.reply(draft.id, "preview", { changes, changed: preview.changed });
  }

  private async save(draft: Draft): Promise<void> {
    if (!draft.writable || !draft.plan) throw new ExplorerError("sourceChanged");
    const { prepared, inputs, target } = draft.plan;
    delete draft.plan;
    const { tree, entry, path } = draft.context;
    await this.checkBuffers(draft, [path, ...inputs]);
    // The Rust server verifies the sources again under the publication lock.
    draft.committing = true;
    const result = await tree.request(entry.project, "metadata/applyFormEdit", { prepared });
    if (result.schemaVersion !== 1 || result.form !== draft.form || result.changed !== true || result.snapshot !== prepared.expectedOutputSnapshot)
      throw new ExplorerError("protocolInvalid");
    if (this.draft === draft) {
      this.draft = undefined;
      this.reply(draft.id, "saved", target ? { target } : {});
      this.applied(target);
    }
  }

  async receiveHistory(value: RecordValue): Promise<void> {
    const { id, action } = value;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0
      || action !== "state" && action !== "undo" && action !== "redo") return;
    const respond = (result: RecordValue): void => this.post({ type: "formEditHistoryResult", id, ...result });
    const context = this.current();
    const snapshot = context && diskSnapshot(context);
    if (!context || context.entry.node.id.kind !== "object" || !snapshot) {
      respond(action === "state" ? { undo: false, redo: false } : { message: "editConflict" });
      return;
    }
    const { tree, entry, path } = context;
    const form = context.entry.node.id.objectId;
    if (action === "state") {
      try {
        const result = await tree.request(entry.project, "metadata/formEditHistory", { form, snapshot });
        this.checkContext(context);
        if (typeof result.undo !== "boolean" || typeof result.redo !== "boolean") throw new ExplorerError("protocolInvalid");
        respond({ undo: result.undo, redo: result.redo });
      } catch {
        respond({ undo: false, redo: false });
      }
      return;
    }
    if (this.draft || this.replaying) {
      respond({ message: "editLocked" });
      return;
    }
    this.replaying = true;
    let submitted = false;
    try {
      await this.checkSourceBuffers(context, [path, join(dirname(path), "Form", "Module.bsl")]);
      submitted = true;
      const result = await tree.request(entry.project, "metadata/replayFormEdit", { form, snapshot, undo: action === "undo" });
      if (result.schemaVersion !== 1 || result.form !== form || result.changed !== true || !hash(result.snapshot))
        throw new ExplorerError("protocolInvalid");
      respond({ message: action === "undo" ? "editUndone" : "editRedone" });
      this.applied();
    } catch (error) {
      respond({ message: this.error(error, submitted) });
      if (submitted) this.applied();
    } finally {
      this.replaying = false;
    }
  }

  private references(details: RecordValue | undefined): string[] {
    return Array.isArray(details?.paths) ? details.paths.filter((path): path is string => typeof path === "string").slice(0, 20) : [];
  }

  private error(error: unknown, committing: boolean): string {
    if (error instanceof ExplorerError) {
      switch (error.domain) {
        case "creation_dirty_source": return "editDirty";
        case "property_history_unavailable": return "editHistoryUnavailable";
        case "property_read_only": case "property_edit_busy": return "editLocked";
        case "creation_invalid_name": case "form_name_collision": return "editInvalidName";
        case "form_references": return "editReferences";
        case "form_invalid_xml": return "editInvalidXml";
        case "form_invalid":
          return error.details?.field === "form" ? "editUnavailable"
            : error.details?.field === "conditionalAppearance" ? "editInvalidRule" : "editInvalid";
        case "property_conflict": case "stale_generation": return "editConflict";
        case "form_committed_refresh_required": return "editSavedRefresh";
      }
      if (["sourceChanged", "obsolete", "cancelled"].includes(error.code)) return "editConflict";
    }
    return committing ? "editUnknownWrite" : "editFailed";
  }
}
