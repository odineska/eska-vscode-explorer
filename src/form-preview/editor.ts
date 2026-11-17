import * as vscode from "vscode";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { ExplorerError, isRecord, isWirePath } from "../protocol.js";
import { configuredReadOnlyResource } from "../editor-policy.js";
import { hasDirtySource, existingSource, resolveSourcePath, sourceKey } from "../source.js";
import type { MetadataTree, TreeEntry } from "../tree.js";
import type { FormSnapshot } from "./protocol.js";

type RecordValue = Record<string, unknown>;
type AssignedTarget = { kind: "element"; id: number } | { kind: "attribute" | "command" | "parameter"; name: string };
type Context = { tree: MetadataTree; entry: TreeEntry; path: string; snapshot: FormSnapshot; origin: string };
type Request = { form: string; snapshot: string; operations: RecordValue[] };
type Step = { operations: RecordValue[]; merge?: string };
type Base = { context: Context; form: string; snapshot: string; schema: RecordValue };
type Plan = { prepared: RecordValue; inputs: string[]; text: string; schema: RecordValue; targets: (AssignedTarget | undefined)[] };
type Recovery = { snapshot: string; steps: Step[] };

const limit = 1_000_000; // Below the metadata RPC limit, including the project envelope.
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function diskSnapshot(context: Context): string | undefined {
  const dependency = context.snapshot.dependencies.find(item => item.id === context.origin && item.role === "form");
  return dependency?.version === null && hash(dependency.snapshot) ? dependency.snapshot : undefined;
}

function target(value: unknown): AssignedTarget | undefined {
  if (!isRecord(value)) return;
  if (value.kind === "element" && typeof value.id === "number" && Number.isSafeInteger(value.id)) return { kind: value.kind, id: value.id };
  if ((value.kind === "attribute" || value.kind === "command" || value.kind === "parameter") && typeof value.name === "string")
    return { kind: value.kind, name: value.name };
}

function operations(value: unknown): RecordValue[] {
  if (!Array.isArray(value) || value.length > 1024 || !value.every(isRecord)
    || value.some(item => item.kind === "remove" && item.force === true)
    || Buffer.byteLength(JSON.stringify(value)) > limit) throw new ExplorerError("protocolInvalid");
  return value;
}

function recovery(value: unknown): Recovery | undefined {
  if (!isRecord(value) || !hash(value.snapshot) || !Array.isArray(value.steps) || value.steps.length > 1024) return;
  const steps: Step[] = [];
  for (const step of value.steps) {
    if (!isRecord(step) || !Array.isArray(step.operations) || !step.operations.length) return;
    steps.push({ operations: step.operations });
  }
  try { operations(steps.flatMap(step => step.operations)); } catch { return; }
  if (steps.length) return { snapshot: value.snapshot, steps };
}

function patchedText(bytes: Buffer, changes: unknown, expected: string): string {
  if (!Array.isArray(changes) || changes.length > 1024) throw new ExplorerError("protocolInvalid");
  const parts: Buffer[] = [];
  let previous = 0;
  for (const change of changes) {
    if (!isRecord(change) || !isRecord(change.range) || typeof change.replacement !== "string") throw new ExplorerError("protocolInvalid");
    const { start, end } = change.range;
    if (typeof start !== "number" || !Number.isSafeInteger(start) || start < previous ||
      typeof end !== "number" || !Number.isSafeInteger(end) || end < start || end > bytes.length) throw new ExplorerError("protocolInvalid");
    parts.push(bytes.subarray(previous, start), Buffer.from(change.replacement, "utf8"));
    previous = end;
  }
  parts.push(bytes.subarray(previous));
  const output = Buffer.concat(parts);
  if (digest(output) !== expected) throw new ExplorerError("protocolInvalid");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output);
}

function schemaValues(value: unknown): value is RecordValue {
  return isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.dynamicListAppearance)
    && (value.conditionalAppearance === null || isRecord(value.conditionalAppearance));
}

/** One checked draft per form. Every panel receives an overlay of these exact bytes. */
export class FormEditor {
  private base: Base | undefined;
  private plan: Plan | undefined;
  private steps: Step[] = [];
  private cursor = 0;
  private recovery: Recovery | undefined;
  private history = { undo: false, redo: false };
  private closed = false;
  private conflict = false;
  private saving = false;
  private notice = "";
  private lastUnavailable = "";
  private revision = 0;
  private pending = Promise.resolve();

  constructor(private readonly current: () => Context | undefined,
    private readonly uri: (path: string) => Promise<vscode.Uri>,
    private readonly changed: (render: boolean, selected?: AssignedTarget) => void,
    stored: unknown,
    private readonly persist: (value: Recovery | undefined) => Thenable<void>) {
    this.recovery = recovery(stored);
  }

  dispose(): void { this.closed = true; }
  get dirty(): boolean { return !!this.plan && this.plan.prepared.expectedOutputSnapshot !== this.base?.snapshot || !!this.recovery; }
  get overlay(): { text: string; version: string } | undefined {
    if (this.plan && this.dirty) return { text: this.plan.text, version: "eska-form-" + this.revision };
  }
  get schema(): RecordValue | undefined { return this.plan?.schema ?? this.base?.schema; }
  get status(): RecordValue {
    return {
      dirty: this.dirty, saving: this.saving, conflict: this.conflict, notice: this.notice || this.lastUnavailable,
      undo: !this.saving && !this.conflict && (this.steps.length ? this.cursor > 0 : this.history.undo),
      redo: !this.saving && !this.conflict && (this.steps.length ? this.cursor < this.steps.length : this.history.redo),
    };
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.pending.then(async () => { if (!this.closed) await task(); });
    this.pending = next.catch(() => {});
    return next;
  }

  synchronize(): Promise<void> {
    return this.enqueue(async () => {
      const context = this.current();
      if (this.plan) {
        // Check external changes even while the last valid draft remains visible.
        try { if (this.base) await this.checkBase(this.base, this.plan.inputs); }
        catch (error) { this.fail(error, true); }
        return;
      }
      const snapshot = context && diskSnapshot(context);
      if (!context || !snapshot || context.entry.node.id.kind !== "object") {
        if (this.base || this.lastUnavailable !== "editDirty") {
          this.base = undefined;
          this.history = { undo: false, redo: false };
          this.lastUnavailable = "editDirty";
          this.changed(false);
        }
        return;
      }
      if (this.base?.snapshot === snapshot && this.base.context.tree === context.tree
        && this.base.context.entry.project === context.entry.project) return;
      if (this.steps.length) this.reset();
      const form = context.entry.node.id.objectId;
      try {
        await this.checkSourceBuffers(context, [context.path]);
        const [value, history] = await Promise.all([
          context.tree.request(context.entry.project, "metadata/formEditSchema", { form, includeTypes: true }),
          context.tree.request(context.entry.project, "metadata/formEditHistory", { form, snapshot }),
        ]);
        this.checkContext(context);
        if (!schemaValues(value) || value.schemaVersion !== 1 || value.form !== form || value.snapshot !== snapshot || !isWirePath(value.path)
          || !Array.isArray(value.elementKinds) || !Array.isArray(value.definitionKinds)
          || !isRecord(value.propertyCaptions) || !isRecord(value.choiceCaptions) || typeof value.writable !== "boolean")
          throw new ExplorerError("protocolInvalid");
        const source = await existingSource(context.entry.project.info.sourcePath, value.path);
        this.checkContext(context);
        const current = this.current();
        if (relative(context.path, source) !== "" || !current || diskSnapshot(current) !== snapshot)
          throw new ExplorerError("sourceChanged");
        const { nodes, elementKinds, definitionKinds, propertyCaptions, choiceCaptions, conditionalAppearance, dynamicListAppearance, typeOptions, writable } = value;
        const schema = { nodes, elementKinds, definitionKinds, propertyCaptions, choiceCaptions, conditionalAppearance, dynamicListAppearance, typeOptions, writable };
        this.base = { context, form, snapshot, schema };
        this.history = { undo: history.undo === true, redo: history.redo === true };
        this.lastUnavailable = writable ? "" : "editLocked";
        if (this.recovery) {
          if (this.recovery.snapshot !== snapshot) throw new ExplorerError("sourceChanged");
          const steps = this.recovery.steps;
          this.plan = await this.prepare(this.base, steps);
          this.steps = steps;
          this.cursor = steps.length;
          this.revision++;
          this.recovery = undefined;
          this.changed(true);
        } else this.changed(false);
      } catch (error) {
        this.lastUnavailable = this.message(error);
        if (this.recovery) this.conflict = true;
        this.changed(false);
      }
    });
  }

  receive(value: RecordValue, respond: (value: RecordValue) => void): Promise<void> {
    const { id, action } = value;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return Promise.resolve();
    return this.enqueue(async () => {
      let selected: AssignedTarget | undefined;
      try {
        if (action === "discard") {
          await this.persist(undefined);
          this.reset();
          this.notice = "";
          this.base = undefined;
          this.changed(true);
        } else if (action === "save") await this.save();
        else if (action === "undo" || action === "redo") await this.replay(action);
        else if (action === "change" || action === "placeAttribute") {
          const items = operations(value.operations);
          if (action === "placeAttribute") this.allocateName(items);
          if (items.length) selected = await this.change(items, value.merge);
        } else return;
        respond({ type: "formDraftResult", id, ...(selected ? { target: selected } : {}) });
      } catch (error) {
        this.fail(error, false);
        const references = error instanceof ExplorerError && Array.isArray(error.details?.paths)
          ? error.details.paths.filter(path => typeof path === "string").slice(0, 20) : [];
        respond({ type: "formDraftResult", id, message: this.message(error), references });
      }
    });
  }

  private reset(): void {
    this.steps = [];
    this.cursor = 0;
    this.plan = undefined;
    this.recovery = undefined;
    this.conflict = false;
    this.history = { undo: false, redo: false };
    this.lastUnavailable = "";
  }

  private checkContext(context: Context): void {
    const current = this.current();
    if (this.closed || !current || current.tree !== context.tree || current.entry.project !== context.entry.project
      || current.entry.node.id.kind !== "object" || context.entry.node.id.kind !== "object"
      || current.entry.node.id.objectId !== context.entry.node.id.objectId || current.origin !== context.origin
      || sourceKey(current.path) !== sourceKey(context.path)) throw new ExplorerError("sourceChanged");
  }

  private async checkSourceBuffers(context: Context, paths: string[]): Promise<void> {
    this.checkContext(context);
    const uri = await this.uri(context.path);
    this.checkContext(context);
    if (uri.scheme !== "file" || configuredReadOnlyResource(uri, "xml")) throw new ExplorerError("requestFailed", "property_read_only");
    if (await hasDirtySource(paths, vscode.workspace.textDocuments))
      throw new ExplorerError("requestFailed", "creation_dirty_source");
    this.checkContext(context);
  }

  private async checkBase(base: Base, inputs: string[] = []): Promise<Buffer> {
    const { context, snapshot } = base;
    await this.checkSourceBuffers(context, [context.path, ...inputs]);
    const bytes = await readFile(context.path);
    this.checkContext(context);
    if (digest(bytes) !== snapshot) throw new ExplorerError("sourceChanged");
    return bytes;
  }

  private writable(): Base {
    if (this.conflict) throw new ExplorerError("sourceChanged");
    if (!this.base?.schema.writable) throw new ExplorerError("requestFailed", "property_read_only");
    return this.base;
  }

  private allocateName(items: RecordValue[]): void {
    const [operation] = items;
    const element = operation?.element;
    if (items.length !== 1 || operation?.kind !== "addElement" || !isRecord(element) || typeof element.name !== "string")
      throw new ExplorerError("protocolInvalid");
    const nodes = this.schema?.nodes;
    if (!Array.isArray(nodes)) throw new ExplorerError("sourceChanged");
    const names = new Set(nodes.flatMap(node => isRecord(node) && isRecord(node.target)
      && node.target.kind === "element" && typeof node.name === "string" ? [node.name.toLowerCase()] : []));
    const base = element.name;
    let name = base;
    for (let suffix = 1; names.has(name.toLowerCase()); suffix++) name = base + suffix;
    items[0] = { ...operation, element: { ...element, name } };
  }

  private async prepare(base: Base, steps: Step[]): Promise<Plan> {
    const { tree, entry, path } = base.context;
    await this.checkBase(base);
    const request: Request = { form: base.form, snapshot: base.snapshot, operations: operations(steps.flatMap(step => step.operations)) };
    const preview = await tree.request(entry.project, "metadata/previewFormEdit", { request, includeDraft: true });
    const prepared = preview.prepared;
    if (preview.schemaVersion !== 1 || preview.form !== base.form || preview.valid !== true || preview.operation !== "form-edit"
      || typeof preview.changed !== "boolean" || !isWirePath(preview.source) || !isRecord(prepared)
      || !isDeepStrictEqual(request, prepared.request) || !hash(prepared.sourceSnapshot) || !hash(prepared.expectedOutputSnapshot)
      || !Array.isArray(preview.inputs) || !preview.inputs.every(isWirePath) || !Array.isArray(preview.assignedIds) || !schemaValues(preview.draft))
      throw new ExplorerError("protocolInvalid");
    const source = resolveSourcePath(entry.project.info.sourcePath, preview.source);
    if (relative(path, source) !== "") throw new ExplorerError("protocolInvalid");
    const inputs = preview.inputs.map(input => resolveSourcePath(entry.project.info.sourcePath, input));
    const bytes = await this.checkBase(base, inputs);
    const text = patchedText(bytes, preview.changes, prepared.expectedOutputSnapshot);
    const targets = preview.assignedIds.map(value => isRecord(value) ? target(value.target) : undefined);
    return { prepared, inputs, text, schema: { ...base.schema, ...preview.draft }, targets };
  }

  private async install(base: Base, steps: Step[], cursor: number, plan: Plan | undefined, selected?: AssignedTarget): Promise<void> {
    const dirty = !!plan && plan.prepared.expectedOutputSnapshot !== base.snapshot;
    await this.persist(dirty ? { snapshot: base.snapshot, steps: steps.slice(0, cursor).map(({ operations }) => ({ operations })) } : undefined);
    if (this.closed) return; // The persisted draft will be loaded in the next panel.
    this.steps = steps;
    this.cursor = cursor;
    this.plan = plan;
    this.recovery = undefined;
    this.notice = "";
    this.revision++;
    this.changed(true, selected);
  }

  private async change(items: RecordValue[], key: unknown): Promise<AssignedTarget | undefined> {
    const base = this.writable();
    const merge = typeof key === "string" && key.length <= 512 ? key : undefined;
    const steps = this.steps.slice(0, this.cursor);
    if (merge && steps.at(-1)?.merge === merge) steps.pop();
    steps.push({ operations: items, ...(merge ? { merge } : {}) });
    const plan = await this.prepare(base, steps);
    if (plan.prepared.expectedOutputSnapshot === (this.plan?.prepared.expectedOutputSnapshot ?? base.snapshot)) return;
    const count = items.length;
    // IDs returned by the planner follow the order of the operations which allocate them.
    const allocates = items.filter(item => item.kind === "addElement" || item.kind === "copyElement" || item.kind === "addDefinition").length;
    const selected = allocates ? plan.targets.at(-allocates) : count === 1 && items[0]?.kind === "moveElement" ? target(items[0].target) : undefined;
    await this.install(base, steps, steps.length, plan, selected);
    return selected;
  }

  private async save(): Promise<void> {
    const base = this.writable(), plan = this.plan;
    if (!plan || !this.dirty) return;
    const { tree, entry } = base.context;
    await this.checkBase(base, plan.inputs);
    let end = 0;
    const steps = this.steps.slice(0, this.cursor).map(step => (end += step.operations.length));
    this.saving = true;
    this.notice = "";
    this.changed(false);
    try {
      const result = await tree.request(entry.project, "metadata/applyFormEdit", { prepared: plan.prepared, steps });
      if (result.schemaVersion !== 1 || result.form !== base.form || result.changed !== true || result.snapshot !== plan.prepared.expectedOutputSnapshot)
        throw new ExplorerError("protocolInvalid");
      this.reset();
      this.base = undefined;
      this.notice = "editSaved";
      await this.persist(undefined);
    } catch (error) {
      this.notice = this.message(error, true);
      this.conflict = true;
      throw error;
    } finally {
      this.saving = false;
      this.changed(true);
    }
  }

  private async replay(action: "undo" | "redo"): Promise<void> {
    const base = this.writable();
    if (this.steps.length) {
      const cursor = this.cursor + (action === "undo" ? -1 : 1);
      if (cursor < 0 || cursor > this.steps.length) return;
      const plan = cursor ? await this.prepare(base, this.steps.slice(0, cursor)) : undefined;
      await this.install(base, this.steps, cursor, plan);
      return;
    }
    if (!this.history[action]) return;
    const { tree, entry, path } = base.context;
    await this.checkBase(base, [join(dirname(path), "Form", "Module.bsl")]);
    const result = await tree.request(entry.project, "metadata/replayFormEdit", { form: base.form, snapshot: base.snapshot, undo: action === "undo" });
    if (result.schemaVersion !== 1 || result.form !== base.form || result.changed !== true || !hash(result.snapshot))
      throw new ExplorerError("protocolInvalid");
    this.base = undefined;
    this.history = { undo: false, redo: false };
    this.notice = action === "undo" ? "editUndone" : "editRedone";
    this.changed(true);
  }

  private fail(error: unknown, checkOnly: boolean): void {
    const message = this.message(error);
    if (this.dirty && (message === "editConflict" || message === "editDirty" || message === "editLocked")) this.conflict = true;
    if (checkOnly && this.notice === message) return;
    this.notice = message;
    this.changed(false);
  }

  private message(error: unknown, committing = false): string {
    if (error instanceof ExplorerError) {
      switch (error.domain) {
        case "creation_dirty_source": return "editDirty";
        case "property_history_unavailable": return "editHistoryUnavailable";
        case "property_read_only": case "property_edit_busy": return "editLocked";
        case "creation_invalid_name": case "form_name_collision": return "editInvalidName";
        case "form_references": return "editReferences";
        case "form_invalid_xml": return "editInvalidXml";
        case "form_invalid":
          if (error.details?.reason === "used_standard_commands") return "editCommandInUse";
          if (error.details?.field === "form") return "editUnavailable";
          return error.details?.field === "conditionalAppearance" ? "editInvalidRule" : "editInvalid";
        case "property_conflict": case "stale_generation": return "editConflict";
        case "form_committed_refresh_required": return "editSavedRefresh";
      }
      if (["sourceChanged", "obsolete", "cancelled"].includes(error.code)) return "editConflict";
    }
    return committing ? "editUnknownWrite" : "editFailed";
  }
}
